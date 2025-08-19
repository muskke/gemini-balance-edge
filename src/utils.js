import { logger as defaultLogger } from "./logger.mjs";

/**
 * KeyManager 类负责管理、选择和健康检查 API 密钥。
 * 支持加权轮询和内存状态管理。
 * 采用多例模式，确保每个 keysString 只有一个实例。
 */

const managerRegistry = new Map();

export class KeyManager {
  /**
   * @private constructor - Please use KeyManager.getInstance() instead.
   * @param {string} keysString - 带权重的密钥字符串，例如 "key1:10,key2:5,key3"
   * @param {object} logger - 日志记录器
   */
  constructor(keysString, logger = defaultLogger) {
    if (managerRegistry.has(keysString)) {
      // This check prevents direct instantiation, guiding users to the factory.
      throw new Error("KeyManager instance for this keysString already exists. Use KeyManager.getInstance().");
    }
    this.initialKeys = this._parseKeys(keysString);
    this.logger = logger;
    this.state = null; // 状态将在 initState 中初始化
    this.logger.info(`KeyManager created for keys: "${keysString}"`);
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
   * 初始化内存中的状态。
   */
  initState() {
    if (this.state) return;
    this.logger.info('Initializing KeyManager state in memory...');
    
    this.state = {
      keys: this.initialKeys.map(k => ({ ...k })),
      currentIndex: 0,
    };
    
    this.logger.info('KeyManager state initialized successfully.');
  }

  /**
   * 解析带权重的密钥字符串。
   * @param {string} keysString
   * @returns {Array<{key: string, weight: number, healthy: boolean, last_checked: number}>}
   */
  _parseKeys(keysString) {
    if (!keysString) return [];
    return keysString.split(',').map(item => {
      const parts = item.trim().split(':');
      const key = parts[0];
      const weight = parts.length > 1 ? parseInt(parts[1], 10) : 1;
      return { key, weight: isNaN(weight) ? 1 : weight, healthy: true, last_checked: Date.now() };
    });
  }

  /**
   * 使用加权轮询算法选择一个健康的 API 密钥。
   * @returns {string|null}
   */
  selectKey() {
    if (!this.state) {
      this.initState();
    }

    const healthyKeys = this.state.keys.filter(k => k.healthy);
    if (healthyKeys.length === 0) {
      return null;
    }

    const weightedList = [];
    for (const key of healthyKeys) {
      for (let i = 0; i < key.weight; i++) {
        weightedList.push(key);
      }
    }

    if (weightedList.length === 0) return null;

    this.state.currentIndex = (this.state.currentIndex || 0) % weightedList.length;
    const selected = weightedList[this.state.currentIndex];
    
    this.state.currentIndex = (this.state.currentIndex + 1) % weightedList.length;

    return selected.key;
  }

  /**
   * 将指定的密钥标记为不健康。
   * @param {string} apiKey
   */
  markAsUnhealthy(apiKey) {
    if (!this.state) this.initState();
    
    const keyToUpdate = this.state.keys.find(k => k.key === apiKey);
    if (keyToUpdate) {
      keyToUpdate.healthy = false;
      keyToUpdate.last_checked = Date.now();
    }
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
   * 测试单个 API 密钥的有效性。
   * @param {string} apiKey
   * @returns {Promise<boolean>}
   */
  async _testApiKey(apiKey) {
    try {
      const testUrl = "https://generativelanguage.googleapis.com/v1beta/models";
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
      });
      return response.ok;
    } catch (error) {
      this.logger.error(`Health check failed for key ending with ...${apiKey.slice(-4)}:`, error);
      return false;
    }
  }

}