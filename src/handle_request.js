import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';
import { KeyManager } from './utils.js';

// 添加日志系统
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

const logger = {
  error: (msg, ...args) => LOG_LEVEL >= LOG_LEVELS.ERROR && console.error(`[ERROR] ${msg}`, ...args),
  warn: (msg, ...args) => LOG_LEVEL >= LOG_LEVELS.WARN && console.warn(`[WARN] ${msg}`, ...args),
  info: (msg, ...args) => LOG_LEVEL >= LOG_LEVELS.INFO && console.info(`[INFO] ${msg}`, ...args),
  debug: (msg, ...args) => LOG_LEVEL >= LOG_LEVELS.DEBUG && console.debug(`[DEBUG] ${msg}`, ...args)
};

// 在模块级别获取服务器 KeyManager 的单例
const serverApiKey = process.env.GEMINI_API_KEY;
const keyManager = KeyManager.getInstance(serverApiKey, logger);
if (serverApiKey) {
  // 首次初始化后，立即触发一次健康检查，之后每次请求也触发
  setTimeout(() => keyManager.healthCheck().catch(logger.error), 0);
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  if (pathname === '/' || pathname === '/index.html') {
    return new Response('Proxy is Running!  More Details: https://github.com/muskke/gemini-balance-edge', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  if (pathname === '/favicon.ico' || pathname === '/favicon.png') {
    return new Response(null, { status: 204 });
  }

  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  if (pathname === "/models" && request.method === 'GET') {
    logger.info("返回固定的 Gemini 模型列表");
    
    const modelsResponse = {
      object: "list",
      data: [
        {
          id: "gemini-2.5-flash",
          object: "model",
          created: 0,
          owned_by: "google",
          displayName: "Gemini 2.5 Flash",
          description: "Fast and efficient model for most tasks"
        },
        {
          id: "gemini-2.5-pro",
          object: "model",
          created: 0,
          owned_by: "google",
          displayName: "Gemini 2.5 Pro",
          description: "Advanced model for complex reasoning tasks"
        }
      ]
    };
    
    return new Response(JSON.stringify(modelsResponse, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  const serverAuthToken = process.env.AUTH_TOKEN;

  // 异步触发健康检查，不阻塞主流程
  // 使用 setTimeout 确保它在当前事件循环之后运行，避免阻塞响应
  if (serverApiKey) {
    setTimeout(() => {
      keyManager.healthCheck().catch(logger.error);
    }, 0);
  }

  // 克隆请求头，以便修改
  let newHeaders = new Headers(request.headers);
  let selectedKey = '';
  let clientTokenStr = '';

  // 确定使用服务器密钥还是客户端密钥
  const authHeader = newHeaders.get("Authorization");
  const clientApiKey_OpenAI = authHeader?.split(" ")[1];
  const clientApiKey_Gemini = newHeaders.get("x-goog-api-key");

  if (serverAuthToken && (clientApiKey_OpenAI === serverAuthToken || clientApiKey_Gemini === serverAuthToken)) {
    logger.info("Using server-provided Gemini API Keys.");
    // KeyManager 已用 serverApiKey 初始化
  } else {
    clientTokenStr = clientApiKey_OpenAI || clientApiKey_Gemini || '';
    logger.info("Using client-provided Gemini API Keys.");
    // 为客户端密钥获取 KeyManager 实例
    const clientKeyManager = KeyManager.getInstance(clientTokenStr, logger);
    selectedKey = clientKeyManager.selectKey();
  }

  if (!selectedKey) {
    selectedKey = keyManager.selectKey();
  }
  
  if (!selectedKey) {
    return new Response(JSON.stringify({ error: { message: 'No available API keys.' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  logger.info(`Selected API Key ending with ...${selectedKey.slice(-4)}`);

  // 根据请求类型设置头部
  const isGeminıRequest = url.pathname.includes("generativelanguage.googleapis.com") || clientApiKey_Gemini;
  if (isGeminıRequest) {
      newHeaders.set("x-goog-api-key", selectedKey);
  } else { // 默认为 OpenAI 格式
      newHeaders.set("Authorization", `Bearer ${selectedKey}`);
  }

  // OpenAI 路由转换
  if (url.pathname.endsWith("/chat/completions") || url.pathname.endsWith("/completions") || url.pathname.endsWith("/embeddings") || url.pathname.endsWith("/models")) {
    const newRequest = new Request(request.url, {
      method: request.method,
      headers: newHeaders,
      body: request.body
    });
    logger.debug("Forwarding to OpenAI compatible endpoint.");
    return openai.fetch(newRequest);
  }

  logger.info("Request Sending to Gemini");

  const baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
  // 检查是否为流式请求
  const isStream = search.includes("alt=sse");
  const targetUrl = `${baseUrl}${pathname}${search}`;
  
  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: request.body, // 直接传递请求体，支持流式
      duplex: 'half' // 允许在请求发送时接收响应
    });

    // 对于流式响应，立即返回，不等待完整内容
    if (isStream && response.ok) {
      logger.info("Streaming response started.");
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Content-Type', 'text/event-stream; charset=utf-8');
      responseHeaders.set('Cache-Control', 'no-cache');
      responseHeaders.set('Connection', 'keep-alive');
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    // 对于非流式响应或错误响应
    const responseBody = await response.text();
    if (!response.ok) {
      logger.warn(`API call failed with status ${response.status} for key ...${selectedKey.slice(-4)}`);
      logger.warn("--- Full Request and Response Log ---");
      logger.warn('Request URL:', targetUrl);
      logger.warn('Request Method:', request.method);
      logger.warn('Request Headers:', JSON.stringify(Object.fromEntries(newHeaders.entries())));
      logger.warn('Request Body:', await request.clone().text()); // 克隆后读取
      logger.warn('Response Status:', response.status);
      logger.warn('Response Headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));
      logger.warn('Response Body:', responseBody);
      logger.warn('------------------------------------');
      await keyManager.markAsUnhealthy(selectedKey);
    } else {
      logger.info("Call Gemini Success (non-stream)");
    }

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('connection');
    responseHeaders.delete('keep-alive');
    responseHeaders.delete('content-encoding');
    responseHeaders.set('Referrer-Policy', 'no-referrer');

    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    logger.error('Failed to fetch:', error.message);
    // 网络错误或其他 fetch 异常，也将密钥标记为不健康
    await keyManager.markAsUnhealthy(selectedKey);
    return new Response(
      JSON.stringify({
        error: {
          message:
            "An unexpected error occurred while fetching the upstream API.\n" + error?.stack,
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
