/**
 * KeyManager 类负责管理、选择和健康检查 API 密钥。
 * 支持加权轮询和从 Vercel KV 中同步状态。
 */
export class KeyManager {
  /**
   * @param {string} keysString - 带权重的密钥字符串，例如 "key1:10,key2:5,key3"
   * @param {object} kvClient - Vercel KV 客户端实例
   * @param {object} logger - 日志记录器
   */
  constructor(keysString, kvClient, logger = console) {
    this.initialKeys = this._parseKeys(keysString);
    this.kv = kvClient;
    this.logger = logger;
    this.state = null; // 状态将从 KV 加载
    this.logger.info(`KeyManager created. Vercel KV client is ${this.kv ? 'present' : 'absent'}.`);
  }

  /**
   * 从 Vercel KV 加载和初始化状态。
   * 如果 KV 中没有状态，则使用初始密钥状态。
   */
  async initState() {
    if (this.state) return;
    this.logger.info('Initializing KeyManager state...');

    try {
      const storedState = await this.kv?.get('gemini_keys_status');
      this.logger.info(`State read from Vercel KV: ${storedState ? 'found' : 'not found'}.`);

      if (storedState && storedState.keys && storedState.keys.length === this.initialKeys.length) {
        this.state = storedState;
      } else {
        this.logger.warn('No valid state in Vercel KV or key mismatch. Initializing with default state.');
        this.state = {
          keys: this.initialKeys.map(k => ({ ...k })),
          currentIndex: 0,
        };
        // 首次初始化时，异步保存状态，不阻塞主流程
        this.saveState(this.state);
      }
      this.logger.info('KeyManager state initialized successfully.');
    } catch (error) {
      this.logger.error('Error during initState with Vercel KV:', error);
      // 如果初始化失败，则使用内存中的状态作为后备
      this.state = {
        keys: this.initialKeys.map(k => ({ ...k })),
        currentIndex: 0,
      };
    }
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
      throw new Error("KeyManager state is not initialized. Call initState() first.");
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

    // 使用“即发即忘”模式，不阻塞关键路径
    this.saveState(this.state);

    return selected.key;
  }

  /**
   * 将指定的密钥标记为不健康。
   * @param {string} apiKey
   */
  async markAsUnhealthy(apiKey) {
    if (!this.state) await this.initState();
    
    const keyToUpdate = this.state.keys.find(k => k.key === apiKey);
    if (keyToUpdate) {
      keyToUpdate.healthy = false;
      keyToUpdate.last_checked = Date.now();
      this.saveState(this.state);
    }
  }

  /**
   * 异步执行健康检查。
   */
  async healthCheck() {
    if (!this.state) await this.initState();

    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    let stateChanged = false;

    for (const key of this.state.keys) {
      if (!key.healthy && (now - key.last_checked > fiveMinutes)) {
        const isNowHealthy = await this._testApiKey(key.key);
        if (isNowHealthy) {
          key.healthy = true;
          stateChanged = true;
        }
        key.last_checked = now;
      }
    }

    if (stateChanged) {
      this.saveState(this.state);
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

  /**
   * 将当前状态保存到 Vercel KV。
   * @param {object} stateToSave
   */
  async saveState(stateToSave) {
    // 立即更新内存中的状态引用
    this.state = stateToSave;

    if (!this.kv) {
      this.logger.warn('No Vercel KV client, skipping saveState.');
      return;
    }

    // 使用“即发即忘”模式，但返回 promise 以便捕获后台错误
    try {
      this.logger.info('Attempting to save state to Vercel KV...');
      await this.kv.set('gemini_keys_status', stateToSave);
      this.logger.info('State successfully saved to Vercel KV.');
    } catch (error) {
      this.logger.error('Background state save to Vercel KV failed:', error);
      // 重新抛出错误，以便调用者可以捕获它
      throw error;
    }
  }
}