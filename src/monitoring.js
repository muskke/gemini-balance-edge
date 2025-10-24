/**
 * 增强的监控系统
 * 提供详细的性能监控和统计信息
 */

import { logger } from './logger.mjs';

export class MonitoringSystem {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        byStatusCode: {},
        byKey: {},
        averageResponseTime: 0,
        responseTimeHistory: []
      },
      keys: {
        total: 0,
        healthy: 0,
        unhealthy: 0,
        byErrorCode: {},
        weightDistribution: {}
      },
      streams: {
        total: 0,
        active: 0,
        completed: 0,
        failed: 0,
        averageDuration: 0
      },
      errors: {
        total: 0,
        byType: {},
        byKey: {},
        recent: []
      },
      performance: {
        memoryUsage: 0,
        cpuUsage: 0,
        uptime: 0,
        lastHealthCheck: 0
      }
    };

    this.startTime = Date.now();
    this.healthCheckInterval = null;
    this.startHealthCheck();
  }

  /**
   * 记录请求指标
   * @param {Object} requestInfo - 请求信息
   */
  recordRequest(requestInfo) {
    const {
      statusCode,
      responseTime,
      keyUsed,
      isStream = false,
      error = null
    } = requestInfo;

    this.metrics.requests.total++;
    
    if (statusCode >= 200 && statusCode < 300) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }

    // 记录状态码分布
    this.metrics.requests.byStatusCode[statusCode] = 
      (this.metrics.requests.byStatusCode[statusCode] || 0) + 1;

    // 记录密钥使用情况
    if (keyUsed) {
      this.metrics.requests.byKey[keyUsed] = 
        (this.metrics.requests.byKey[keyUsed] || 0) + 1;
    }

    // 记录响应时间
    if (responseTime) {
      this.metrics.requests.responseTimeHistory.push({
        timestamp: Date.now(),
        responseTime,
        statusCode,
        keyUsed
      });

      // 保持最近1000个记录
      if (this.metrics.requests.responseTimeHistory.length > 1000) {
        this.metrics.requests.responseTimeHistory.shift();
      }

      // 计算平均响应时间
      this.calculateAverageResponseTime();
    }

    // 记录流式响应
    if (isStream) {
      this.metrics.streams.total++;
      this.metrics.streams.active++;
    }

    // 记录错误
    if (error) {
      this.recordError(error, keyUsed);
    }

    logger.debug('请求指标已记录', {
      statusCode,
      responseTime,
      keyUsed: keyUsed ? `...${keyUsed.slice(-4)}` : null,
      isStream
    });
  }

  /**
   * 记录密钥状态
   * @param {Object} keyInfo - 密钥信息
   */
  recordKeyStatus(keyInfo) {
    const {
      key,
      healthy,
      weight,
      errorCode,
      errorCount
    } = keyInfo;

    this.metrics.keys.total++;
    
    if (healthy) {
      this.metrics.keys.healthy++;
    } else {
      this.metrics.keys.unhealthy++;
    }

    // 记录错误码分布
    if (errorCode) {
      this.metrics.keys.byErrorCode[errorCode] = 
        (this.metrics.keys.byErrorCode[errorCode] || 0) + 1;
    }

    // 记录权重分布
    if (weight !== undefined) {
      const weightRange = this.getWeightRange(weight);
      this.metrics.keys.weightDistribution[weightRange] = 
        (this.metrics.keys.weightDistribution[weightRange] || 0) + 1;
    }

    logger.debug('密钥状态已记录', {
      key: key ? `...${key.slice(-4)}` : null,
      healthy,
      weight,
      errorCode
    });
  }

  /**
   * 记录错误
   * @param {Error|Object} error - 错误信息
   * @param {string} keyUsed - 使用的密钥
   */
  recordError(error, keyUsed = null) {
    this.metrics.errors.total++;

    const errorType = error.name || error.constructor.name || 'UnknownError';
    this.metrics.errors.byType[errorType] = 
      (this.metrics.errors.byType[errorType] || 0) + 1;

    if (keyUsed) {
      this.metrics.errors.byKey[keyUsed] = 
        (this.metrics.errors.byKey[keyUsed] || 0) + 1;
    }

    // 记录最近错误
    this.metrics.errors.recent.push({
      timestamp: Date.now(),
      type: errorType,
      message: error.message || error.toString(),
      keyUsed: keyUsed ? `...${keyUsed.slice(-4)}` : null
    });

    // 保持最近100个错误记录
    if (this.metrics.errors.recent.length > 100) {
      this.metrics.errors.recent.shift();
    }

    logger.warn('错误已记录', {
      type: errorType,
      message: error.message || error.toString(),
      keyUsed: keyUsed ? `...${keyUsed.slice(-4)}` : null
    });
  }

  /**
   * 记录流式响应结束
   * @param {Object} streamInfo - 流信息
   */
  recordStreamEnd(streamInfo) {
    const { duration, status, keyUsed } = streamInfo;

    if (status === 'completed') {
      this.metrics.streams.completed++;
    } else if (status === 'error' || status === 'timeout') {
      this.metrics.streams.failed++;
    }

    this.metrics.streams.active = Math.max(0, this.metrics.streams.active - 1);

    // 计算平均持续时间
    if (duration) {
      this.calculateAverageStreamDuration();
    }

    logger.debug('流式响应结束已记录', {
      duration,
      status,
      keyUsed: keyUsed ? `...${keyUsed.slice(-4)}` : null
    });
  }

  /**
   * 计算平均响应时间
   */
  calculateAverageResponseTime() {
    const history = this.metrics.requests.responseTimeHistory;
    if (history.length === 0) return;

    const total = history.reduce((sum, record) => sum + record.responseTime, 0);
    this.metrics.requests.averageResponseTime = total / history.length;
  }

  /**
   * 计算平均流持续时间
   */
  calculateAverageStreamDuration() {
    // 这里需要从流处理器获取数据
    // 暂时使用占位符
    this.metrics.streams.averageDuration = 0;
  }

  /**
   * 获取权重范围
   * @param {number} weight - 权重值
   * @returns {string}
   */
  getWeightRange(weight) {
    if (weight >= 0.8) return 'high';
    if (weight >= 0.5) return 'medium';
    if (weight >= 0.2) return 'low';
    return 'very_low';
  }

  /**
   * 获取系统性能信息
   * @returns {Object}
   */
  getPerformanceInfo() {
    const now = Date.now();
    this.metrics.performance.uptime = now - this.startTime;
    this.metrics.performance.lastHealthCheck = now;

    // 获取内存使用情况（如果可用）
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memUsage = process.memoryUsage();
      this.metrics.performance.memoryUsage = memUsage.heapUsed;
    }

    return this.metrics.performance;
  }

  /**
   * 获取完整监控报告
   * @returns {Object}
   */
  getFullReport() {
    return {
      ...this.metrics,
      performance: this.getPerformanceInfo(),
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * 获取健康状态
   * @returns {Object}
   */
  getHealthStatus() {
    const now = Date.now();
    const uptime = now - this.startTime;
    
    const successRate = this.metrics.requests.total > 0 
      ? (this.metrics.requests.successful / this.metrics.requests.total) * 100 
      : 0;

    const keyHealthRate = this.metrics.keys.total > 0 
      ? (this.metrics.keys.healthy / this.metrics.keys.total) * 100 
      : 0;

    return {
      status: successRate > 80 && keyHealthRate > 50 ? 'healthy' : 'degraded',
      successRate: successRate.toFixed(2),
      keyHealthRate: keyHealthRate.toFixed(2),
      uptime: uptime,
      totalRequests: this.metrics.requests.total,
      totalErrors: this.metrics.errors.total,
      activeStreams: this.metrics.streams.active
    };
  }

  /**
   * 开始健康检查
   */
  startHealthCheck() {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 60000); // 每分钟检查一次
  }

  /**
   * 执行健康检查
   */
  performHealthCheck() {
    const health = this.getHealthStatus();
    
    if (health.status === 'degraded') {
      logger.warn('系统健康状态降级', health);
    } else {
      logger.info('系统健康检查通过', health);
    }

    // 清理过期数据
    this.cleanupOldData();
  }

  /**
   * 清理过期数据
   */
  cleanupOldData() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24小时

    // 清理响应时间历史
    this.metrics.requests.responseTimeHistory = 
      this.metrics.requests.responseTimeHistory.filter(
        record => now - record.timestamp < maxAge
      );

    // 清理错误记录
    this.metrics.errors.recent = 
      this.metrics.errors.recent.filter(
        record => now - record.timestamp < maxAge
      );
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}
