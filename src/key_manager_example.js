/**
 * KeyManager 使用示例
 * 展示如何在 Gemini API 调用中使用优化后的密钥管理器
 */

import { KeyManager } from './utils.js';
import { logger } from './logger.mjs';

// 示例：在 API 调用中使用 KeyManager
export async function callGeminiAPI(prompt, keysString) {
  const keyManager = KeyManager.getInstance(keysString, logger);
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const apiKey = keyManager.selectKey();
    
    if (!apiKey) {
      logger.error('没有可用的 API 密钥');
      throw new Error('所有 API 密钥都不可用');
    }

    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (response.ok) {
        const result = await response.json();
        logger.info(`API 调用成功，使用密钥 ...${apiKey.slice(-4)}`);
        return result;
      } else {
        // 处理不同的错误码
        const errorCode = response.status;
        const errorText = await response.text();
        
        logger.warn(`API 调用失败，错误码: ${errorCode}, 密钥: ...${apiKey.slice(-4)}`);
        
        // 智能处理错误
        keyManager.handleKeyError(apiKey, errorCode, errorText);
        
        // 对于某些错误，不需要重试
        if (errorCode === 400) {
          throw new Error(`请求参数错误: ${errorText}`);
        }
        
        attempts++;
        
        // 短暂延迟后重试
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        }
      }
    } catch (error) {
      logger.error(`API 调用异常，密钥: ...${apiKey.slice(-4)}`, error);
      
      // 网络错误等异常情况
      keyManager.handleKeyError(apiKey, 500, error.message);
      attempts++;
      
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }
  }

  throw new Error(`API 调用失败，已重试 ${maxAttempts} 次`);
}

// 示例：监控和管理密钥状态
export function monitorKeyManager(keysString) {
  const keyManager = KeyManager.getInstance(keysString, logger);
  
  // 定期打印状态
  setInterval(() => {
    const stats = keyManager.getStats();
    logger.info('KeyManager 状态:', JSON.stringify(stats, null, 2));
  }, 60000); // 每分钟打印一次状态

  // 定期执行健康检查
  setInterval(async () => {
    try {
      await keyManager.healthCheck();
      logger.debug('健康检查完成');
    } catch (error) {
      logger.error('健康检查失败:', error);
    }
  }, 300000); // 每5分钟执行一次健康检查
}

// 示例：手动管理密钥
export function manualKeyManagement(keysString) {
  const keyManager = KeyManager.getInstance(keysString, logger);
  
  return {
    // 获取当前状态
    getStatus: () => keyManager.getStats(),
    
    // 手动恢复密钥
    recoverKey: (apiKey) => keyManager.recoverKey(apiKey),
    
    // 手动标记密钥错误
    reportError: (apiKey, errorCode, message) => 
      keyManager.handleKeyError(apiKey, errorCode, message),
    
    // 执行健康检查
    healthCheck: () => keyManager.healthCheck()
  };
}

// 使用示例
/*
const keysString = "key1:10,key2:5,key3:3";

// 启动监控
monitorKeyManager(keysString);

// 调用 API
try {
  const result = await callGeminiAPI("Hello, world!", keysString);
  console.log(result);
} catch (error) {
  console.error("API 调用失败:", error);
}

// 手动管理
const manager = manualKeyManagement(keysString);
console.log("当前状态:", manager.getStatus());
*/