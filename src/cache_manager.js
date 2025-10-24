/**
 * 缓存管理器
 * 提供智能缓存策略以提高性能
 */

import { logger } from './logger.mjs';

export class CacheManager {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.ttl = options.ttl || 300000; // 5分钟
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0
    };
    
    // 启动清理任务
    this.startCleanupTask();
  }

  /**
   * 生成缓存键
   * @param {string} key - 基础键
   * @param {Object} params - 参数
   * @returns {string}
   */
  generateCacheKey(key, params = {}) {
    const sortedParams = Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&');
    
    return sortedParams ? `${key}?${sortedParams}` : key;
  }

  /**
   * 获取缓存项
   * @param {string} key - 缓存键
   * @returns {any|null}
   */
  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      return null;
    }

    // 检查是否过期
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      return null;
    }

    this.stats.hits++;
    item.lastAccessed = Date.now();
    return item.value;
  }

  /**
   * 设置缓存项
   * @param {string} key - 缓存键
   * @param {any} value - 缓存值
   * @param {number} ttl - 生存时间（毫秒）
   */
  set(key, value, ttl = this.ttl) {
    // 如果缓存已满，清理最旧的项
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const now = Date.now();
    this.cache.set(key, {
      value,
      createdAt: now,
      lastAccessed: now,
      expiresAt: now + ttl
    });

    this.stats.size = this.cache.size;
  }

  /**
   * 删除缓存项
   * @param {string} key - 缓存键
   */
  delete(key) {
    this.cache.delete(key);
    this.stats.size = this.cache.size;
  }

  /**
   * 清理最旧的缓存项
   */
  evictOldest() {
    let oldestKey = null;
    let oldestTime = Date.now();

    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * 清理过期项
   */
  cleanup() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => {
      this.cache.delete(key);
      this.stats.evictions++;
    });

    this.stats.size = this.cache.size;
    
    if (expiredKeys.length > 0) {
      logger.debug(`清理了 ${expiredKeys.length} 个过期缓存项`);
    }
  }

  /**
   * 启动清理任务
   */
  startCleanupTask() {
    setInterval(() => {
      this.cleanup();
    }, 60000); // 每分钟清理一次
  }

  /**
   * 获取缓存统计信息
   * @returns {Object}
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      totalRequests: total
    };
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear();
    this.stats.size = 0;
    logger.info('缓存已清空');
  }
}

/**
 * API 响应缓存
 */
export class APIResponseCache extends CacheManager {
  constructor(options = {}) {
    super({
      maxSize: options.maxSize || 500,
      ttl: options.ttl || 300000 // 5分钟
    });
  }

  /**
   * 缓存 API 响应
   * @param {string} endpoint - API 端点
   * @param {Object} params - 请求参数
   * @param {Response} response - 响应对象
   */
  async cacheResponse(endpoint, params, response) {
    // 只缓存成功的响应
    if (!response.ok) {
      return;
    }

    // 只缓存非流式响应
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
      return;
    }

    try {
      const responseText = await response.clone().text();
      const cacheKey = this.generateCacheKey(endpoint, params);
      
      this.set(cacheKey, {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseText
      });

      logger.debug(`API 响应已缓存: ${cacheKey}`);
    } catch (error) {
      logger.warn('缓存 API 响应失败:', error);
    }
  }

  /**
   * 获取缓存的响应
   * @param {string} endpoint - API 端点
   * @param {Object} params - 请求参数
   * @returns {Response|null}
   */
  getCachedResponse(endpoint, params) {
    const cacheKey = this.generateCacheKey(endpoint, params);
    const cached = this.get(cacheKey);

    if (!cached) {
      return null;
    }

    logger.debug(`返回缓存响应: ${cacheKey}`);
    return new Response(cached.body, {
      status: cached.status,
      headers: cached.headers
    });
  }
}

/**
 * 密钥状态缓存
 */
export class KeyStatusCache extends CacheManager {
  constructor(options = {}) {
    super({
      maxSize: options.maxSize || 100,
      ttl: options.ttl || 60000 // 1分钟
    });
  }

  /**
   * 缓存密钥状态
   * @param {string} key - 密钥
   * @param {Object} status - 状态信息
   */
  cacheKeyStatus(key, status) {
    const cacheKey = `key_status_${key}`;
    this.set(cacheKey, status, 60000); // 1分钟缓存
  }

  /**
   * 获取密钥状态
   * @param {string} key - 密钥
   * @returns {Object|null}
   */
  getKeyStatus(key) {
    const cacheKey = `key_status_${key}`;
    return this.get(cacheKey);
  }
}
