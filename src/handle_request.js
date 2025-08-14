import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';
import { selectApiKey } from './utils.js';

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
  const url = new URL(request.url);
  const pathname = url.pathname;

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

  // 克隆请求头，以便修改
  let newHeaders = new Headers(request.headers);
  let selectedKey = '';

  // OpenAI 格式请求处理
  if (url.pathname.endsWith("/chat/completions") || url.pathname.endsWith("/completions") || url.pathname.endsWith("/embeddings") || url.pathname.endsWith("/models")) {
    const authHeader = newHeaders.get("Authorization");
    const clientToken = authHeader?.split(" ")[1];

    if (serverAuthToken && clientToken === serverAuthToken) {
      if (!serverApiKey) {
        return new Response(JSON.stringify({ error: { message: 'Server authentication successful, but no GEMINI_API_KEY is configured on the server.' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      selectedKey = selectApiKey(serverApiKey.split(',').map(k => k.trim()).filter(k => k));
      logger.info("Using server-provided Gemini API Key for OpenAI request.");
    } else {
      selectedKey = selectApiKey(clientToken.split(',').map(k => k.trim()).filter(k => k));
      logger.info("Using client-provided Gemini API Key for OpenAI request.");
    }
    newHeaders.set("Authorization", `Bearer ${selectedKey}`);
    
    // Create a new request with updated headers instead of modifying the original
    const newRequest = new Request(request.url, {
      method: request.method,
      headers: newHeaders,
      body: request.body
    });
    
    logger.debug("Request headers updated with API key");
    
    return openai.fetch(newRequest);
  }

  // Gemini 原生请求处理
  const clientToken = newHeaders.get("x-goog-api-key");
  if (serverAuthToken && clientToken === serverAuthToken) {
    if (!serverApiKey) {
      return new Response(JSON.stringify({ error: { message: 'Server authentication successful, but no GEMINI_API_KEY is configured on the server.' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    selectedKey = selectApiKey(serverApiKey.split(',').map(k => k.trim()).filter(k => k));
    logger.debug("Using server-provided Gemini API Key for Gemini request.");
  } else {
    selectedKey = selectApiKey(clientToken.split(',').map(k => k.trim()).filter(k => k));
    logger.debug("Using client-provided Gemini API Key for Gemini request.");
  }
  newHeaders.set("x-goog-api-key", selectedKey);

  logger.info("Request Sending to Gemini");

  try {
    const response = await fetch(url.href, {
      method: request.method,
      headers: newHeaders,
      body: request.body
    });
    logger.info("Call Gemini Success");
    
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
