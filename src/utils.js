import { logger as defaultLogger } from "./logger.mjs";
import { getConfig } from "./key_manager_config.js";

/**
 * KeyManager 类负责管理、选择和健康检查 API 密钥。
 * 支持加权轮询、动态权重调整和智能错误处理。
 * 采用多例模式，确保每个 keysString 只有一个实例。
 */

const managerRegistry = new Map();

export class KeyManager {
  /**
   * @private constructor - Please use KeyManager.getInstance() instead.
   * @param {string} keysString - 带权重的密钥字符串，例如 "key1:10,key2:5,key3"
   * @param {object} logger - 日志记录器
   */
  constructor(keysString, logger = defaultLogger, options = {}) {
    const { skipRegistryCheck = false } = options;
    if (!skipRegistryCheck && managerRegistry.has(keysString)) {
      // This check prevents direct instantiation, guiding users to the factory.
      throw new Error("KeyManager instance for this keysString already exists. Use KeyManager.getInstance().");
    }
    this.config = getConfig();
    this.initialKeys = this._parseKeys(keysString);
    this.logger = logger;
    this.state = null; // 状态将在 initState 中初始化
    this.logger.debug(`KeyManager created for keys: "${keysString}"`);
  }

  /**
   * 获取或创建 KeyManager 的单例实例。
   * @param {string} keysString - The key string used to identify the manager instance.
   * @param {object} logger - The logger instance.
   * @returns {KeyManager} The singleton instance for the given keysString.
   */
  static getInstance(keysString, logger = defaultLogger) {
    if (!keysString) {
      // Handle cases where keysString might be empty or null
      keysString = '';
    }

    if (!managerRegistry.has(keysString)) {
      const newInstance = new KeyManager(keysString, logger);
      managerRegistry.set(keysString, newInstance);
    }

    const instance = managerRegistry.get(keysString);
    // 如果实例尚未初始化状态，则进行初始化
    if (!instance.state) {
      instance.initState();
    }

    return instance;
  }

  /**
   * 创建临时 KeyManager，不注册到全局缓存，适用于客户端密钥。
   */
  static createEphemeral(keysString, logger = defaultLogger) {
    return new KeyManager(keysString || '', logger, { skipRegistryCheck: true });
  }

  /**
   * 初始化内存中的状态。
   */
  initState() {
    if (this.state) return;
    this.logger.debug('Initializing KeyManager state in memory...');

    this.state = {
      keys: this.initialKeys.map(k => ({ ...k })),
      currentIndex: 0,
      totalResetCount: 0,
      lastGlobalReset: Date.now(),
      // 优先级队列状态
      priorityQueues: null,
      priorityList: [],
      currentPriorityIndex: 0,
      currentQueueIndex: 0,
      lastSelectedKey: null
    };

    this.logger.debug('KeyManager state initialized successfully.');
  }

  /**
   * 解析带权重的密钥字符串。
   * @param {string} keysString
   * @returns {Array<{key: string, originalWeight: number, currentWeight: number, dynamicWeight: number, healthy: boolean, last_checked: number, errorCount: number, recoveryAttempts: number}>}
   */
  _parseKeys(keysString) {
    if (!keysString) return [];
    const parsed = keysString.split(',').map(item => {
      const parts = item.trim().split(':');
      const key = (parts[0] || '').trim();
      const weight = parts.length > 1 ? parseInt(parts[1], 10) : 1;
      const normalizedWeight = isNaN(weight) ? 1 : weight;
      return {
        key,
        originalWeight: normalizedWeight,
        currentWeight: 0,
        dynamicWeight: normalizedWeight,
        healthy: true,
        last_checked: Date.now(),
        errorCount: 0,
        recoveryAttempts: 0,
        lastErrorCode: null,
        last_error_at: undefined, // 初始化 last_error_at
        last_error_message: undefined,
        lastRecoveryAttempt: Date.now(),
        temporaryUnhealthy: false,
        temporaryUnhealthyUntil: null
      };
    }).filter(k => k.key && k.key.length > 0);
    return parsed;
  }

  /**
   * 使用平滑加权轮询（SWRR）选择一个 API 密钥。
   * 优先选择健康的密钥，如果所有密钥都不健康则重置并选择权重最高的。
   * @returns {string|null}
   */
  selectKey() {
    if (!this.state) {
      this.initState();
    }
    if (this.state.keys.length === 0) {
      this.logger.warn('KeyManager has no keys to select');
      return null;
    }

    // 尝试权重恢复
    this._attemptWeightRecovery();

    // 检查临时不健康的密钥是否应该恢复
    this._checkTemporaryRecovery();

    // 获取可用的密钥（健康的或动态权重大于最小值的）
    const available = this.state.keys.filter(k =>
      k.healthy || k.dynamicWeight >= this.config.recovery.minWeight
    );

    if (available.length === 0) {
      this.logger.warn('所有 API 密钥都不可用，执行全局重置');
      this._resetAllKeys();
      return this._selectFromAvailable(this.state.keys);
    }

    // 优先从健康的密钥中选择
    const healthy = available.filter(k => k.healthy);
    if (healthy.length > 0) {
      return this._selectFromAvailable(healthy);
    }

    // 如果没有健康的密钥，从有最小权重的密钥中选择
    this.logger.info('没有健康的密钥，从降权密钥中选择');
    return this._selectFromAvailable(available);
  }

  /**
   * 智能密钥选择 - 考虑最近错误和性能
   * @param {Object} context - 选择上下文
   * @returns {string|null}
   */
  selectKeySmart(context = {}) {
    if (!this.state) {
      this.initState();
    }
    if (this.state.keys.length === 0) {
      this.logger.warn('KeyManager has no keys to select');
      return null;
    }

    const { avoidRecentErrors = true, preferStableKeys = true } = context;
    
    // 尝试权重恢复
    this._attemptWeightRecovery();
    this._checkTemporaryRecovery();

    // 获取可用的密钥
    let available = this.state.keys.filter(k =>
      k.healthy || k.dynamicWeight >= this.config.recovery.minWeight
    );

    if (available.length === 0) {
      this.logger.warn('所有 API 密钥都不可用，执行全局重置');
      this._resetAllKeys();
      return this._selectFromAvailable(this.state.keys);
    }

    // 如果避免最近错误，过滤掉最近出错的密钥
    if (avoidRecentErrors) {
      const recentErrorThreshold = Date.now() - 300000; // 5分钟内
      available = available.filter(k => 
        !k.lastErrorCode || ((k.last_error_at ?? k.last_checked) < recentErrorThreshold)
      );
    }

    // 如果偏好稳定密钥，优先选择错误次数少的
    if (preferStableKeys && available.length > 1) {
      available.sort((a, b) => a.errorCount - b.errorCount);
    }

    return this._selectFromAvailable(available);
  }

  /**
   * 使用 O(1) 优先级队列算法选择密钥
   * 保证连续两次请求不会使用同一个 KEY
   * @private
   */
  _selectFromAvailable(keys) {
    if (keys.length === 0) return null;

    // 初始化优先级队列数据结构（O(1) 操作）
    this._initPriorityQueueIfNeeded();

    // 将密钥按权重分组到对应队列（只在初始化时执行）
    this._rebuildPriorityQueues(keys);

    // 使用优先级队列选择算法（O(1)）
    return this._selectFromPriorityQueue();
  }

  /**
   * 初始化优先级队列数据结构
   * @private
   */
  _initPriorityQueueIfNeeded() {
    if (!this.state.priorityQueues) {
      this.state.priorityQueues = new Map(); // 优先级 -> 队列的映射
      this.state.priorityList = []; // 优先级列表（按优先级降序排序）
      this.state.currentPriorityIndex = 0; // 当前优先级索引
      this.state.currentQueueIndex = 0; // 当前队列中的索引
      this.state.lastSelectedKey = null; // 记录最后一次选择的密钥
    }
  }

  /**
   * 重建优先级队列（只在密钥状态改变时执行）
   * @private
   */
  _rebuildPriorityQueues(keys) {
    const { priorityQueues } = this.state;

    // 收集所有唯一优先级
    const uniquePriorities = new Set();
    for (const keyObj of keys) {
      const weight = keyObj.dynamicWeight;
      // 将权重转换为整数优先级（权重越大优先级越高）
      const priority = Math.max(1, Math.round(weight * 10));
      uniquePriorities.add(priority);
    }

    // 如果优先级列表发生变化，重建
    const newPriorityList = Array.from(uniquePriorities).sort((a, b) => b - a);
    const needRebuild = newPriorityList.join(',') !== this.state.priorityList.join(',');

    if (needRebuild) {
      // 清空现有队列
      priorityQueues.clear();

      // 为每个优先级创建新队列
      for (const priority of newPriorityList) {
        priorityQueues.set(priority, []);
      }

      // 将密钥分配到对应队列
      for (const keyObj of keys) {
        const weight = keyObj.dynamicWeight;
        const priority = Math.max(1, Math.round(weight * 10));
        const queue = priorityQueues.get(priority);
        if (queue) {
          queue.push(keyObj);
        }
      }

      this.state.priorityList = newPriorityList;
      this.state.currentPriorityIndex = 0;
      this.state.currentQueueIndex = 0;
    }
  }

  /**
   * 从优先级队列中选择密钥（O(1) 操作）
   * @private
   */
  _selectFromPriorityQueue() {
    const { priorityQueues, priorityList, currentPriorityIndex, currentQueueIndex } = this.state;
    const priorities = priorityList;

    if (priorities.length === 0) return null;

    let priIndex = currentPriorityIndex;
    let queueIndex = currentQueueIndex;

    // 尝试从当前优先级队列选择
    for (let i = 0; i < priorities.length; i++) {
      const currentPriIndex = (priIndex + i) % priorities.length;
      const priority = priorities[currentPriIndex];
      const queue = priorityQueues.get(priority);

      if (!queue || queue.length === 0) continue;

      // 避免连续选择同一个密钥
      if (queue.length === 1 && queue[0].key === this.state.lastSelectedKey) {
        continue;
      }

      // 从队列中取出密钥
      const selectedKeyObj = queue[queueIndex % queue.length];

      // 将密钥移至队列尾部（循环移位）
      if (queue.length > 1) {
        queue.push(queue.shift());
      }

      // 更新状态
      this.state.currentPriorityIndex = currentPriIndex;
      this.state.currentQueueIndex = (queueIndex + 1) % queue.length;
      this.state.lastSelectedKey = selectedKeyObj.key;

      return selectedKeyObj.key;
    }

    // 如果所有队列都只有一个密钥且是上次使用的，放宽限制
    const firstPriority = priorities[0];
    const queue = priorityQueues.get(firstPriority);
    if (queue && queue.length > 0) {
      const selectedKeyObj = queue[queueIndex % queue.length];
      this.state.currentPriorityIndex = 0;
      this.state.currentQueueIndex = (queueIndex + 1) % queue.length;
      this.state.lastSelectedKey = selectedKeyObj.key;
      return selectedKeyObj.key;
    }

    return null;
  }

  /**
   * 根据错误码智能调整密钥权重和健康状态。
   * @param {string} apiKey - API 密钥
   * @param {number} errorCode - HTTP 错误码
   * @param {string} errorMessage - 错误信息（可选）
   */
  handleKeyError(apiKey, errorCode, errorMessage = '') {
    if (!this.state) this.initState();

    const keyToUpdate = this.state.keys.find(k => k.key === apiKey);
    if (!keyToUpdate) {
      this.logger.warn(`尝试更新不存在的密钥: ${apiKey.slice(-4)}`);
      return;
    }

    keyToUpdate.errorCount++;
    keyToUpdate.lastErrorCode = errorCode;
    keyToUpdate.last_checked = Date.now();
    keyToUpdate.last_error_at = Date.now();
    keyToUpdate.last_error_message = errorMessage;

    // 根据错误码获取权重惩罚
    const penalty = this.config.errorPenalties[errorCode] || this.config.errorPenalties.default;
    const newWeight = Math.max(
      keyToUpdate.dynamicWeight * penalty,
      this.config.recovery.minWeight
    );

    this.logger.info(
      `密钥 ...${apiKey.slice(-4)} 遇到错误 ${errorCode}，权重从 ${keyToUpdate.dynamicWeight.toFixed(2)} 调整为 ${newWeight.toFixed(2)}`
    );

    keyToUpdate.dynamicWeight = newWeight;

    // 智能健康状态管理
    this._updateKeyHealthStatus(keyToUpdate, errorCode);
  }

  /**
   * 更新密钥健康状态
   * @private
   */
  _updateKeyHealthStatus(keyToUpdate, errorCode) {
    const wasHealthy = keyToUpdate.healthy;
    
    // 严重错误直接标记为不健康
    if (errorCode === 401 || errorCode === 403) {
      keyToUpdate.healthy = false;
      this.logger.warn(`密钥 ...${keyToUpdate.key.slice(-4)} 因认证/权限错误被标记为不健康`);
    } 
    // 503 错误特殊处理 - 临时标记为不健康，但快速恢复
    else if (errorCode === 503) {
      keyToUpdate.healthy = false;
      keyToUpdate.temporaryUnhealthy = true; // 标记为临时不健康
      keyToUpdate.temporaryUnhealthyUntil = Date.now() + 60000; // 1分钟后恢复
      this.logger.warn(`密钥 ...${keyToUpdate.key.slice(-4)} 因 503 错误被临时标记为不健康`);
    }
    // 权重过低时标记为不健康
    else if (keyToUpdate.dynamicWeight <= this.config.recovery.minWeight) {
      keyToUpdate.healthy = false;
      this.logger.warn(`密钥 ...${keyToUpdate.key.slice(-4)} 因权重过低被标记为不健康`);
    }

    // 记录健康状态变化
    if (wasHealthy && !keyToUpdate.healthy) {
      this.logger.info(`密钥 ...${keyToUpdate.key.slice(-4)} 健康状态: 健康 -> 不健康`);
    }
  }

  /**
   * 将指定的密钥标记为不健康（保持向后兼容）。
   * @param {string} apiKey
   * @deprecated 建议使用 handleKeyError 方法
   */
  markAsUnhealthy(apiKey) {
    this.handleKeyError(apiKey, 500, 'Manual mark as unhealthy');
  }

  /**
   * 异步执行健康检查。
   */
  async healthCheck() {
    if (!this.state) this.initState();

    const now = Date.now();
    const checkInterval = this.config.healthCheck.interval;

    for (const key of this.state.keys) {
      if (!key.healthy && (now - key.last_checked > checkInterval)) {
        this.logger.info(`Performing health check for key ...${key.key.slice(-4)}`);
        const isNowHealthy = await this._testApiKey(key.key);
        if (isNowHealthy) {
          this.recoverKey(key.key);
          this.logger.info(`Key ...${key.key.slice(-4)} recovered and is now healthy.`);
        }
        key.last_checked = now;
      }
    }
  }

  /**
   * 尝试恢复密钥权重
   * @private
   */
  _attemptWeightRecovery() {
    const now = Date.now();

    for (const key of this.state.keys) {
      // 检查是否需要尝试恢复
      if (key.dynamicWeight < key.originalWeight &&
        now - key.lastRecoveryAttempt >= this.config.recovery.recoveryInterval &&
        key.recoveryAttempts < this.config.recovery.maxRecoveryAttempts) {

        // 逐步恢复权重
        const recoveryAmount = key.originalWeight * this.config.recovery.recoveryRate;
        key.dynamicWeight = Math.min(
          key.dynamicWeight + recoveryAmount,
          key.originalWeight
        );

        key.lastRecoveryAttempt = now;
        key.recoveryAttempts++;

        // 如果权重恢复到足够高，重新标记为健康
        if (key.dynamicWeight >= key.originalWeight * this.config.recovery.healthThreshold) {
          key.healthy = true;
          this.logger.info(`密钥 ...${key.key.slice(-4)} 权重恢复到 ${key.dynamicWeight.toFixed(2)}，重新标记为健康`);
        }
      }
    }
  }

  /**
   * 检查临时不健康的密钥是否应该恢复
   * @private
   */
  _checkTemporaryRecovery() {
    const now = Date.now();

    for (const key of this.state.keys) {
      if (key.temporaryUnhealthy && key.temporaryUnhealthyUntil && now >= key.temporaryUnhealthyUntil) {
        key.healthy = true;
        key.temporaryUnhealthy = false;
        key.temporaryUnhealthyUntil = null;
        this.logger.info(`密钥 ...${key.key.slice(-4)} 临时不健康状态已恢复`);
      }
    }
  }

  /**
   * 重置所有密钥状态
   * @private
   */
  _resetAllKeys() {
    this.logger.warn('执行全局密钥重置');

    for (const key of this.state.keys) {
      key.healthy = true;
      key.dynamicWeight = key.originalWeight;
      key.currentWeight = 0;
      key.errorCount = 0;
      key.recoveryAttempts = 0;
      key.lastRecoveryAttempt = Date.now();
      key.inQueue = false; // 重置队列标记
      key.currentPriority = undefined;
    }

    // 重置优先级队列状态
    this.state.priorityQueues = null;
    this.state.priorityList = [];
    this.state.currentPriorityIndex = 0;
    this.state.currentQueueIndex = 0;
    this.state.lastSelectedKey = null;

    this.state.totalResetCount++;
    this.state.lastGlobalReset = Date.now();

    this.logger.info(`全局重置完成，这是第 ${this.state.totalResetCount} 次重置`);
  }

  /**
   * 获取密钥管理器状态统计
   * @returns {object} 状态统计信息
   */
  getStats() {
    if (!this.state) this.initState();

    const healthyCount = this.state.keys.filter(k => k.healthy).length;
    const totalKeys = this.state.keys.length;
    const totalWeightSum = this.state.keys.reduce((sum, k) => sum + k.dynamicWeight, 0);
    const avgWeight = totalKeys > 0 ? (totalWeightSum / totalKeys) : 0;

    return {
      totalKeys,
      healthyKeys: healthyCount,
      unhealthyKeys: totalKeys - healthyCount,
      averageWeight: avgWeight.toFixed(2),
      totalResets: this.state.totalResetCount,
      lastGlobalReset: new Date(this.state.lastGlobalReset).toISOString(),
      keyDetails: this.state.keys.map(k => ({
        key: `...${k.key.slice(-4)}`,
        healthy: k.healthy,
        originalWeight: k.originalWeight,
        currentWeight: parseFloat(k.dynamicWeight.toFixed(2)),
        errorCount: k.errorCount,
        lastErrorCode: k.lastErrorCode
      }))
    };
  }

  /**
   * 手动恢复指定密钥
   * @param {string} apiKey - 要恢复的密钥
   */
  recoverKey(apiKey) {
    if (!this.state) this.initState();

    const keyToRecover = this.state.keys.find(k => k.key === apiKey);
    if (keyToRecover) {
      keyToRecover.healthy = true;
      keyToRecover.dynamicWeight = keyToRecover.originalWeight;
      keyToRecover.errorCount = 0;
      keyToRecover.recoveryAttempts = 0;
      keyToRecover.lastRecoveryAttempt = Date.now();
      keyToRecover.temporaryUnhealthy = false;
      keyToRecover.temporaryUnhealthyUntil = null;
      keyToRecover.lastErrorCode = null;
      keyToRecover.last_error_at = undefined;
      keyToRecover.last_error_message = undefined;

      this.logger.info(`手动恢复密钥 ...${apiKey.slice(-4)}`);
    }
  }

  /**
   * 测试单个 API 密钥的有效性。
   * @param {string} apiKey
   * @returns {Promise<boolean>}
   */
  async _testApiKey(apiKey) {
    try {
      const testUrl = this.config.healthCheck.testEndpoint;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.healthCheck.timeout);

      const response = await fetch(testUrl, {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        // 如果测试成功，恢复该密钥
        const keyToUpdate = this.state.keys.find(k => k.key === apiKey);
        if (keyToUpdate && !keyToUpdate.healthy) {
          this.recoverKey(apiKey);
        }
        return true;
      } else {
        // 如果测试失败，记录错误
        this.handleKeyError(apiKey, response.status, `Health check failed`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Health check failed for key ending with ...${apiKey.slice(-4)}:`, error);
      this.handleKeyError(apiKey, 500, error.message);
      return false;
    }
  }

}