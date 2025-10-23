/**
 * KeyManager 配置文件
 * 可以根据实际需求调整这些参数
 */

export const KEY_MANAGER_CONFIG = {
  // 错误码到权重惩罚的映射
  errorPenalties: {
    429: 0.5,    // 速率限制，中等惩罚
    503: 0.3,    // 服务不可用，重度惩罚
    500: 0.7,    // 服务器错误，轻度惩罚
    502: 0.6,    // 网关错误，中度惩罚
    504: 0.6,    // 网关超时，中度惩罚
    401: 0.1,    // 认证错误，极重惩罚
    403: 0.1,    // 权限错误，极重惩罚
    default: 0.8 // 其他错误，轻微惩罚
  },

  // 权重恢复配置
  recovery: {
    minWeight: 0.1,           // 最小权重（10%）
    recoveryRate: 0.1,        // 每次恢复的权重增量（10%）
    recoveryInterval: 60000,  // 恢复检查间隔（1分钟）
    maxRecoveryAttempts: 10,  // 最大恢复尝试次数
    healthThreshold: 0.5      // 重新标记为健康的权重阈值（50%）
  },

  // 健康检查配置
  healthCheck: {
    interval: 300000,         // 健康检查间隔（5分钟）
    timeout: 10000,           // 请求超时时间（10秒）
    retryDelay: 5000,         // 重试延迟（5秒）
    testEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models'
  },

  // 重试配置
  retry: {
    maxAttempts: 3,           // 最大重试次数
    baseDelay: 1000,          // 基础延迟时间（1秒）
    exponentialBackoff: true, // 是否使用指数退避
    maxDelay: 10000          // 最大延迟时间（10秒）
  },

  // 日志配置
  logging: {
    logLevel: 'info',         // 日志级别
    logKeyDetails: false,     // 是否记录密钥详细信息
    logStats: true           // 是否记录统计信息
  }
};

// 根据环境变量覆盖配置
export function getConfig() {
  const config = { ...KEY_MANAGER_CONFIG };
  
  // 从环境变量读取配置
  if (process.env.KEY_MANAGER_MIN_WEIGHT) {
    config.recovery.minWeight = parseFloat(process.env.KEY_MANAGER_MIN_WEIGHT);
  }
  
  if (process.env.KEY_MANAGER_RECOVERY_RATE) {
    config.recovery.recoveryRate = parseFloat(process.env.KEY_MANAGER_RECOVERY_RATE);
  }
  
  if (process.env.KEY_MANAGER_RECOVERY_INTERVAL) {
    config.recovery.recoveryInterval = parseInt(process.env.KEY_MANAGER_RECOVERY_INTERVAL);
  }
  
  if (process.env.KEY_MANAGER_MAX_ATTEMPTS) {
    config.retry.maxAttempts = parseInt(process.env.KEY_MANAGER_MAX_ATTEMPTS);
  }
  
  return config;
}