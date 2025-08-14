import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';
import { KeyManager } from './utils.js';
import { kv } from '@vercel/kv';

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

export async function handleRequest(request) {
  // @vercel/kv 会自动从环境变量中读取配置，无需手动创建客户端
  const kvClient = kv;

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
  const serverApiKey = process.env.GEMINI_API_KEY;

  // 初始化 KeyManager
  const keyManager = new KeyManager(serverApiKey, kvClient, logger);
  await keyManager.initState();

  // 异步触发健康检查，不阻塞主流程
  keyManager.healthCheck().catch(logger.error);

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
    // 为客户端密钥创建临时的 KeyManager
    const clientKeyManager = new KeyManager(clientTokenStr, null, logger); // 客户端密钥不使用 KV
    await clientKeyManager.initState();
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
  const targetUrl = `${baseUrl}${pathname}${search}`;
  
  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
    });

    // 如果 API 调用失败，则将密钥标记为不健康
    if (!response.ok) {
      logger.warn(`API call failed with status ${response.status} for key ...${selectedKey.slice(-4)}`);
      await keyManager.markAsUnhealthy(selectedKey);
    } else {
      logger.info("Call Gemini Success");
    }
    
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('connection');
    responseHeaders.delete('keep-alive');
    responseHeaders.delete('content-encoding');
    responseHeaders.set('Referrer-Policy', 'no-referrer');

    return new Response(response.body, {
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
