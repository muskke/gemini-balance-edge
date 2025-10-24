/**
 * 性能优化器
 * 提供各种性能优化策略
 */

import { logger } from './logger.mjs';
import { APIResponseCache, KeyStatusCache } from './cache_manager.js';

export class PerformanceOptimizer {
  constructor(options = {}) {
    this.options = {
      enableCaching: true,
      enableCompression: true,
      enableConnectionPooling: true,
      maxConcurrentRequests: 10,
      requestTimeout: 30000,
      ...options
    };

    this.cache = new APIResponseCache({
      maxSize: 500,
      ttl: 300000 // 5分钟
    });

    this.keyCache = new KeyStatusCache({
      maxSize: 100,
      ttl: 60000 // 1分钟
    });

    this.activeRequests = new Set();
    this.performanceMetrics = {
      totalRequests: 0,
      cachedRequests: 0,
      averageResponseTime: 0,
      peakConcurrency: 0,
      errorRate: 0
    };

    this.startMetricsCollection();
  }

  /**
   * 优化请求处理
   * @param {Request} request - 请求对象
   * @param {Function} handler - 处理函数
   * @returns {Promise<Response>}
   */
  async optimizeRequest(request, handler) {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
      // 检查并发限制
      if (this.activeRequests.size >= this.options.maxConcurrentRequests) {
        throw new Error('并发请求数超限');
      }

      this.activeRequests.add(requestId);
      this.performanceMetrics.totalRequests++;

      // 检查缓存
      if (this.options.enableCaching) {
        const cachedResponse = this.getCachedResponse(request);
        if (cachedResponse) {
          this.performanceMetrics.cachedRequests++;
          return cachedResponse;
        }
      }

      // 处理请求
      const response = await handler(request);

      // 缓存响应
      if (this.options.enableCaching && response.ok) {
        await this.cacheResponse(request, response);
      }

      // 记录性能指标
      this.recordPerformanceMetrics(startTime, true);

      return response;

    } catch (error) {
      this.recordPerformanceMetrics(startTime, false);
      throw error;
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * 获取缓存的响应
   * @param {Request} request - 请求对象
   * @returns {Response|null}
   */
  getCachedResponse(request) {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    
    return this.cache.getCachedResponse(url.pathname, params);
  }

  /**
   * 缓存响应
   * @param {Request} request - 请求对象
   * @param {Response} response - 响应对象
   */
  async cacheResponse(request, response) {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    
    await this.cache.cacheResponse(url.pathname, params, response);
  }

  /**
   * 记录性能指标
   * @param {number} startTime - 开始时间
   * @param {boolean} success - 是否成功
   */
  recordPerformanceMetrics(startTime, success) {
    const responseTime = performance.now() - startTime;
    
    // 更新平均响应时间
    const total = this.performanceMetrics.totalRequests;
    const currentAvg = this.performanceMetrics.averageResponseTime;
    this.performanceMetrics.averageResponseTime = 
      (currentAvg * (total - 1) + responseTime) / total;

    // 更新峰值并发数
    this.performanceMetrics.peakConcurrency = Math.max(
      this.performanceMetrics.peakConcurrency,
      this.activeRequests.size
    );

    // 更新错误率
    if (!success) {
      const errorCount = this.performanceMetrics.totalRequests - this.performanceMetrics.cachedRequests;
      this.performanceMetrics.errorRate = (errorCount / this.performanceMetrics.totalRequests) * 100;
    }

    logger.debug('性能指标已记录', {
      responseTime: responseTime.toFixed(2),
      success,
      activeRequests: this.activeRequests.size
    });
  }

  /**
   * 生成请求ID
   * @returns {string}
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 启动指标收集
   */
  startMetricsCollection() {
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000); // 每30秒收集一次
  }

  /**
   * 收集系统指标
   */
  collectSystemMetrics() {
    const metrics = {
      activeRequests: this.activeRequests.size,
      cacheStats: this.cache.getStats(),
      keyCacheStats: this.keyCache.getStats(),
      performance: this.performanceMetrics
    };

    logger.info('系统性能指标', metrics);
  }

  /**
   * 获取性能报告
   * @returns {Object}
   */
  getPerformanceReport() {
    return {
      timestamp: new Date().toISOString(),
      options: this.options,
      metrics: this.performanceMetrics,
      cache: this.cache.getStats(),
      keyCache: this.keyCache.getStats(),
      activeRequests: this.activeRequests.size,
      system: this.getSystemMetrics()
    };
  }

  /**
   * 获取系统指标
   * @returns {Object}
   */
  getSystemMetrics() {
    const metrics = {};

    // 内存使用情况
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memUsage = process.memoryUsage();
      metrics.memory = {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      };
    }

    // 运行时间
    metrics.uptime = process.uptime ? process.uptime() : 0;

    return metrics;
  }

  /**
   * 优化密钥选择
   * @param {Array} keys - 密钥列表
   * @param {Object} context - 上下文
   * @returns {string|null}
   */
  optimizeKeySelection(keys, context = {}) {
    if (!keys || keys.length === 0) {
      return null;
    }

    // 使用缓存的状态信息
    const keyStatuses = keys.map(key => {
      const cached = this.keyCache.getKeyStatus(key);
      return {
        key,
        status: cached || { healthy: true, weight: 1, lastUsed: 0 }
      };
    });

    // 按健康状态和权重排序
    const sortedKeys = keyStatuses
      .filter(ks => ks.status.healthy)
      .sort((a, b) => {
        // 优先选择权重高的
        if (b.status.weight !== a.status.weight) {
          return b.status.weight - a.status.weight;
        }
        // 然后选择最近使用时间早的
        return a.status.lastUsed - b.status.lastUsed;
      });

    return sortedKeys.length > 0 ? sortedKeys[0].key : keys[0];
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.cache.clear();
    this.keyCache.clear();
    this.activeRequests.clear();
    logger.info('性能优化器资源已清理');
  }
}
