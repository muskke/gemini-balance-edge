/**
 * KeyManager 测试文件
 * 用于验证优化后的密钥管理功能
 */

import { KeyManager } from './utils.js';
import { logger } from './logger.mjs';

// 模拟测试
async function testKeyManager() {
  console.log('=== KeyManager 功能测试 ===\n');
  
  // 创建测试用的密钥管理器
  const keysString = "test_key_1:10,test_key_2:5,test_key_3:3";
  const keyManager = KeyManager.getInstance(keysString, logger);
  
  console.log('1. 初始状态:');
  console.log(JSON.stringify(keyManager.getStats(), null, 2));
  
  // 测试密钥选择
  console.log('\n2. 测试密钥选择:');
  for (let i = 0; i < 5; i++) {
    const selectedKey = keyManager.selectKey();
    console.log(`选择的密钥: ${selectedKey}`);
  }
  
  // 模拟错误处理
  console.log('\n3. 模拟 429 错误:');
  keyManager.handleKeyError('test_key_1', 429, 'Rate limit exceeded');
  console.log('处理错误后的状态:');
  console.log(JSON.stringify(keyManager.getStats(), null, 2));
  
  // 模拟更严重的错误
  console.log('\n4. 模拟 503 错误:');
  keyManager.handleKeyError('test_key_2', 503, 'Service unavailable');
  console.log('处理错误后的状态:');
  console.log(JSON.stringify(keyManager.getStats(), null, 2));
  
  // 测试权重恢复
  console.log('\n5. 等待权重恢复...');
  // 模拟时间流逝
  const keys = keyManager.state.keys;
  keys.forEach(key => {
    key.lastRecoveryAttempt = Date.now() - 61000; // 模拟1分钟前
  });
  
  // 触发权重恢复
  const selectedAfterRecovery = keyManager.selectKey();
  console.log(`恢复后选择的密钥: ${selectedAfterRecovery}`);
  console.log('恢复后的状态:');
  console.log(JSON.stringify(keyManager.getStats(), null, 2));
  
  // 测试全局重置
  console.log('\n6. 测试全局重置:');
  // 将所有密钥标记为不健康
  keys.forEach(key => {
    key.healthy = false;
    key.dynamicWeight = 0.05; // 低于最小权重
  });
  
  const selectedAfterReset = keyManager.selectKey();
  console.log(`重置后选择的密钥: ${selectedAfterReset}`);
  console.log('重置后的状态:');
  console.log(JSON.stringify(keyManager.getStats(), null, 2));
  
  console.log('\n=== 测试完成 ===');
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  testKeyManager().catch(console.error);
}

export { testKeyManager };