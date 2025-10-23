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
      lastGlobalReset: Date.now()
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
    return keysString.split(',').map(item => {
      const parts = item.trim().split(':');
      const key = parts[0];
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
        lastRecoveryAttempt: Date.now()
      };
    });
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

    // 尝试权重恢复
    this._attemptWeightRecovery();

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
   * 从可用密钥列表中使用加权轮询选择密钥
   * @private
   */
  _selectFromAvailable(keys) {
    if (keys.length === 0) return null;

    const totalWeight = keys.reduce((sum, k) => sum + k.dynamicWeight, 0);
    if (totalWeight <= 0) return keys[0].key; // 如果总权重为0，返回第一个

    let selected = null;
    for (const k of keys) {
      k.currentWeight += k.dynamicWeight;
      if (!selected || k.currentWeight > selected.currentWeight) {
        selected = k;
      }
    }

    if (selected) {
      selected.currentWeight -= totalWeight;
      return selected.key;
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

    // 严重错误直接标记为不健康
    if (errorCode === 401 || errorCode === 403) {
      keyToUpdate.healthy = false;
      this.logger.warn(`密钥 ...${apiKey.slice(-4)} 因认证/权限错误被标记为不健康`);
    } else if (keyToUpdate.dynamicWeight <= this.config.recovery.minWeight) {
      keyToUpdate.healthy = false;
      this.logger.warn(`密钥 ...${apiKey.slice(-4)} 因权重过低被标记为不健康`);
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
    const fiveMinutes = 5 * 60 * 1000;

    for (const key of this.state.keys) {
      if (!key.healthy && (now - key.last_checked > fiveMinutes)) {
        const isNowHealthy = await this._testApiKey(key.key);
        if (isNowHealthy) {
          key.healthy = true;
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
    }

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
    const avgWeight = this.state.keys.reduce((sum, k) => sum + k.dynamicWeight, 0) / totalKeys;

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
        currentWeight: k.dynamicWeight.toFixed(2),
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