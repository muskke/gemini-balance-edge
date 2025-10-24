/**
 * 增强的重试处理器
 * 专门处理 503 错误和其他临时性错误
 */

import { logger } from './logger.mjs';
import { getConfig } from './key_manager_config.js';

export class RetryHandler {
  constructor(keyManager) {
    this.keyManager = keyManager;
    this.config = getConfig();
  }

  /**
   * 计算重试延迟时间
   * @param {number} attempt - 当前重试次数
   * @param {number} errorCode - 错误码
   * @returns {number} 延迟时间（毫秒）
   */
  calculateDelay(attempt, errorCode) {
    const config = errorCode === 503 ? this.config.serviceUnavailable : this.config.retry;
    
    let delay = config.baseDelay * Math.pow(config.backoffMultiplier || 2, attempt - 1);
    delay = Math.min(delay, config.maxDelay);

    // 添加随机抖动
    if (config.jitter || config.jitterRange) {
      const jitterRange = config.jitterRange || 0.1;
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      delay = delay * (1 + jitter);
    }

    return Math.max(0, Math.floor(delay));
  }

  /**
   * 检查是否应该重试
   * @param {number} errorCode - 错误码
   * @param {number} attempt - 当前重试次数
   * @returns {boolean}
   */
  shouldRetry(errorCode, attempt) {
    const config = errorCode === 503 ? this.config.serviceUnavailable : this.config.retry;
    const maxAttempts = config.maxRetries || config.maxAttempts;

    // 对于 503 和 429 错误，使用特殊配置
    if (errorCode === 503 || errorCode === 429) {
      return attempt <= maxAttempts;
    }

    // 对于其他错误，使用通用配置
    const retryableErrors = [500, 502, 504]; // 可重试的通用错误
    return retryableErrors.includes(errorCode) && attempt <= maxAttempts;
  }

  /**
   * 执行带重试的 API 调用
   * @param {Function} apiCall - API 调用函数
   * @param {string} selectedKey - 当前使用的密钥
   * @param {Object} options - 选项
   * @returns {Promise}
   */
  async executeWithRetry(apiCall, selectedKey, options = {}) {
    const { maxAttempts = 3, errorCode = null } = options;
    let attempt = 1;
    let lastError = null;

    while (attempt <= maxAttempts) {
      try {
        logger.info(`API 调用尝试 ${attempt}/${maxAttempts}，使用密钥 ...${selectedKey.slice(-4)}`);
        
        const response = await apiCall();
        
        if (response.ok) {
          logger.info(`API 调用成功，尝试次数: ${attempt}`);
          return response;
        }

        const statusCode = response.status;
        const errorText = await response.text().catch(() => 'Unknown error');
        
        logger.warn(`API 调用失败，状态码: ${statusCode}，尝试次数: ${attempt}`, {
          key: `...${selectedKey.slice(-4)}`,
          status: statusCode,
          error: errorText
        });

        // 处理密钥错误
        this.keyManager.handleKeyError(selectedKey, statusCode, errorText);

        // 检查是否应该重试
        if (!this.shouldRetry(statusCode, attempt)) {
          throw new Error(`API 调用失败，已达到最大重试次数: ${statusCode} - ${errorText}`);
        }

        // 对于 400/401/403 错误，不重试
        if ([400, 401, 403].includes(statusCode)) {
          throw new Error(`不可重试的客户端错误: ${statusCode} - ${errorText}`);
        }

        // 计算延迟时间
        const delay = this.calculateDelay(attempt, statusCode);
        
        if (attempt < maxAttempts) {
          logger.info(`等待 ${delay}ms 后重试...`);
          await this.sleep(delay);
        }

        attempt++;
        lastError = new Error(`API 调用失败: ${statusCode} - ${errorText}`);

      } catch (error) {
        logger.error(`API 调用异常，尝试次数: ${attempt}`, error);
        
        if (attempt >= maxAttempts) {
          throw error;
        }

        const delay = this.calculateDelay(attempt, errorCode || 500);
        logger.info(`等待 ${delay}ms 后重试...`);
        await this.sleep(delay);
        
        attempt++;
        lastError = error;
      }
    }

    throw lastError || new Error('API 调用失败，已达到最大重试次数');
  }

  /**
   * 智能重试机制 - 针对 503 错误优化
   * @param {Function} apiCall - API 调用函数
   * @param {string} selectedKey - 当前使用的密钥
   * @returns {Promise}
   */
  async smartRetry(apiCall, selectedKey) {
    let attempt = 1;
    const maxAttempts = this.config.serviceUnavailable.maxRetries;
    let lastError = null;

    while (attempt <= maxAttempts) {
      try {
        logger.info(`智能重试 ${attempt}/${maxAttempts}，使用密钥 ...${selectedKey.slice(-4)}`);
        
        const response = await apiCall();
        
        if (response.ok) {
          logger.info(`智能重试成功，尝试次数: ${attempt}`);
          return response;
        }

        const statusCode = response.status;
        const errorText = await response.text().catch(() => 'Unknown error');
        
        // 处理 503 错误
        if (statusCode === 503) {
          logger.warn(`遇到 503 服务不可用错误，尝试次数: ${attempt}`, {
            key: `...${selectedKey.slice(-4)}`,
            error: errorText
          });

          // 对 503 错误进行特殊处理
          this.keyManager.handleKeyError(selectedKey, statusCode, errorText);

          if (attempt < maxAttempts) {
            const delay = this.calculateDelay(attempt, 503);
            logger.info(`503 错误，等待 ${delay}ms 后重试...`);
            await this.sleep(delay);
          }
        } else {
          // 其他错误直接抛出
          this.keyManager.handleKeyError(selectedKey, statusCode, errorText);
          throw new Error(`API 调用失败: ${statusCode} - ${errorText}`);
        }

        attempt++;
        lastError = new Error(`503 服务不可用: ${errorText}`);

      } catch (error) {
        if (error.message.includes('503')) {
          // 503 错误继续重试
          if (attempt >= maxAttempts) {
            throw error;
          }
          attempt++;
          lastError = error;
        } else {
          // 其他错误直接抛出
          throw error;
        }
      }
    }

    throw lastError || new Error('智能重试失败，已达到最大重试次数');
  }

  /**
   * 睡眠函数
   * @param {number} ms - 毫秒数
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取重试统计信息
   * @returns {Object}
   */
  getRetryStats() {
    return {
      config: {
        general: this.config.retry,
        serviceUnavailable: this.config.serviceUnavailable
      },
      keyManagerStats: this.keyManager.getStats()
    };
  }
}
