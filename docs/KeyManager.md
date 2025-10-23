# KeyManager 优化版本

## 概述

优化后的 KeyManager 提供了智能的 API 密钥管理功能，包括：

- **动态权重调整**：根据错误码智能调整密钥权重
- **自动恢复机制**：不健康的密钥会逐步恢复权重
- **全局重置保护**：当所有密钥都不可用时自动重置
- **详细的状态监控**：提供完整的密钥状态统计

## 主要改进

### 1. 智能错误处理

不同错误码对应不同的权重惩罚：

```javascript
const errorPenalties = {
  429: 0.5,    // 速率限制，中等惩罚
  503: 0.3,    // 服务不可用，重度惩罚
  500: 0.7,    // 服务器错误，轻度惩罚
  401: 0.1,    // 认证错误，极重惩罚
  403: 0.1,    // 权限错误，极重惩罚
  default: 0.8 // 其他错误，轻微惩罚
};
```

### 2. 权重恢复机制

- **最小权重保护**：密钥权重不会低于 10%
- **逐步恢复**：每分钟恢复 10% 的原始权重
- **健康阈值**：权重恢复到 50% 时重新标记为健康

### 3. 全局重置策略

当所有密钥都不可用时：
1. 自动重置所有密钥状态
2. 恢复原始权重
3. 重新标记为健康状态

## 使用方法

### 基本用法

```javascript
import { KeyManager } from './utils.js';

// 创建密钥管理器
const keysString = "key1:10,key2:5,key3:3";
const keyManager = KeyManager.getInstance(keysString);

// 选择密钥
const apiKey = keyManager.selectKey();

// 处理错误
keyManager.handleKeyError(apiKey, 429, 'Rate limit exceeded');
```

### 在 API 调用中使用

```javascript
import { callGeminiAPI } from './key_manager_example.js';

try {
  const result = await callGeminiAPI("Hello, world!", keysString);
  console.log(result);
} catch (error) {
  console.error("API 调用失败:", error);
}
```

### 监控密钥状态

```javascript
// 获取状态统计
const stats = keyManager.getStats();
console.log(stats);

// 输出示例：
{
  "totalKeys": 3,
  "healthyKeys": 2,
  "unhealthyKeys": 1,
  "averageWeight": "6.67",
  "totalResets": 0,
  "lastGlobalReset": "2024-01-01T00:00:00.000Z",
  "keyDetails": [
    {
      "key": "...key1",
      "healthy": true,
      "originalWeight": 10,
      "currentWeight": "10.00",
      "errorCount": 0,
      "lastErrorCode": null
    }
  ]
}
```

## 配置选项

可以通过 `key_manager_config.js` 调整各种参数：

```javascript
export const KEY_MANAGER_CONFIG = {
  recovery: {
    minWeight: 0.1,           // 最小权重（10%）
    recoveryRate: 0.1,        // 恢复速率（10%）
    recoveryInterval: 60000,  // 恢复间隔（1分钟）
    healthThreshold: 0.5      // 健康阈值（50%）
  },
  
  retry: {
    maxAttempts: 3,           // 最大重试次数
    baseDelay: 1000,          // 基础延迟
    exponentialBackoff: true  // 指数退避
  }
};
```

## 环境变量配置

支持通过环境变量覆盖配置：

```bash
KEY_MANAGER_MIN_WEIGHT=0.05
KEY_MANAGER_RECOVERY_RATE=0.15
KEY_MANAGER_RECOVERY_INTERVAL=30000
KEY_MANAGER_MAX_ATTEMPTS=5
```

## API 参考

### KeyManager 类

#### 方法

- `selectKey()`: 选择一个可用的 API 密钥
- `handleKeyError(apiKey, errorCode, message)`: 处理密钥错误
- `getStats()`: 获取状态统计
- `recoverKey(apiKey)`: 手动恢复密钥
- `healthCheck()`: 执行健康检查

#### 静态方法

- `getInstance(keysString, logger)`: 获取单例实例
- `createEphemeral(keysString, logger)`: 创建临时实例

## 最佳实践

### 1. 错误处理

```javascript
try {
  const response = await fetch(url, { headers: { 'x-goog-api-key': apiKey } });
  
  if (!response.ok) {
    keyManager.handleKeyError(apiKey, response.status);
    // 处理错误...
  }
} catch (error) {
  keyManager.handleKeyError(apiKey, 500, error.message);
  // 处理异常...
}
```

### 2. 监控和维护

```javascript
// 定期监控
setInterval(() => {
  const stats = keyManager.getStats();
  if (stats.healthyKeys === 0) {
    console.warn('所有密钥都不健康！');
  }
}, 60000);

// 定期健康检查
setInterval(() => {
  keyManager.healthCheck();
}, 300000);
```

### 3. 密钥权重配置

- 高质量密钥设置更高权重
- 为不同用途的密钥设置不同权重
- 根据实际使用情况调整权重比例

## 测试

运行测试验证功能：

```bash
node src/test_key_manager.js
```

## 更好的做法建议

1. **分层密钥管理**：为不同服务或用户组使用不同的密钥池
2. **实时监控**：集成到监控系统，及时发现密钥问题
3. **自动轮换**：定期轮换 API 密钥，提高安全性
4. **负载均衡**：结合地理位置和服务质量进行智能路由
5. **缓存策略**：对成功的请求进行适当缓存，减少 API 调用