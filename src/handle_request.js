// import { handleVerification } from "./verify_keys.js";
import openai from "./openai.mjs";
import { KeyManager } from "./utils.js";
import { logger, redactHeaders } from "./logger.mjs";
import { StreamHandler } from "./stream_handler.js";
import { MonitoringSystem } from "./monitoring.js";
import { MonitorEndpoint } from "./monitor_endpoint.js";
import { PerformanceOptimizer } from "./performance_optimizer.js";

// 在模块级别获取服务器 KeyManager 的单例
const serverApiKey = process.env.GEMINI_API_KEY;
const keyManager = KeyManager.getInstance(serverApiKey, logger);
const streamHandler = new StreamHandler();
const monitoringSystem = new MonitoringSystem();
const monitorEndpoint = new MonitorEndpoint(monitoringSystem, keyManager, streamHandler);
const performanceOptimizer = new PerformanceOptimizer({
  enableCaching: true,
  maxConcurrentRequests: 20,
  requestTimeout: 30000
});

// 最近成功密钥复用缓存（模块级，短暂生存）
let lastSuccessfulKey = null;
let lastKeyTimestamp = 0;
const LAST_KEY_TTL_MS = 60000; // 60s 有效期
const REUSE_PROBABILITY = 0.8; // 80% 概率优先复用

if (serverApiKey) {
  // 首次初始化后，立即触发一次健康检查，之后每次请求也触发
  setTimeout(() => keyManager.healthCheck().catch(logger.error), 0);
}

export async function handleRequest(request) {
  const startTime = performance.now();
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  logger.info(`Request started: ${request.method} ${pathname}`, {
    userAgent: request.headers.get('user-agent'),
    timestamp: new Date().toISOString()
  });

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (pathname === "/" || pathname === "/index.html") {
    return new Response(
      "Proxy is Running!  More Details: https://github.com/muskke/gemini-balance-edge",
      {
        status: 200,
        headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" },
      }
    );
  }

  if (pathname === "/favicon.ico" || pathname === "/favicon.png") {
    return new Response(null, { status: 204 });
  }

  // 监控端点
  if (pathname.startsWith("/monitor")) {
    return monitorEndpoint.handleMonitorRequest(request);
  }

  const serverAuthToken = process.env.AUTH_TOKEN;

  // 以 1% 的概率异步触发健康检查，以减少高并发下的开销
  if (serverApiKey && Math.random() < 0.01) {
    setTimeout(() => {
      logger.info("Performing probabilistic health check.");
      keyManager.healthCheck().catch(logger.error);
    }, 0);
  }

  // 克隆请求头，以便修改
  let newHeaders = new Headers(request.headers);
  let selectedKey = "";
  let clientTokenStr = "";

  // 确定使用服务器密钥还是客户端密钥
  const authHeader = newHeaders.get("Authorization");
  const clientApiKey_OpenAI = authHeader?.split(" ")[1];
  const clientApiKey_Gemini = newHeaders.get("x-goog-api-key");

  const usingServerKeys = !!(serverAuthToken && (clientApiKey_OpenAI === serverAuthToken || clientApiKey_Gemini === serverAuthToken));
  if (usingServerKeys) {
    logger.info("Using server-provided Gemini API Keys.");
    // KeyManager 已用 serverApiKey 初始化
  } else {
    clientTokenStr = clientApiKey_OpenAI || clientApiKey_Gemini || "";
    logger.info("Using client-provided Gemini API Keys.");
    // 为客户端密钥使用临时 KeyManager（避免注册全局缓存）
    const clientKeyManager = KeyManager.createEphemeral(clientTokenStr, logger);
    selectedKey = clientKeyManager.selectKey();
  }

  if (!selectedKey) {
    // 优先复用最近成功密钥（限时+概率），再回退至选择器
    const nowTs = Date.now();
    if (usingServerKeys && lastSuccessfulKey && (nowTs - lastKeyTimestamp) <= LAST_KEY_TTL_MS) {
      const preferReuse = Math.random() < REUSE_PROBABILITY;
      const isHealthy = keyManager.state?.keys?.find(k => k.key === lastSuccessfulKey)?.healthy ?? true;
      if (preferReuse && isHealthy) {
        selectedKey = lastSuccessfulKey;
        logger.debug(`Reusing last successful key ...${selectedKey.slice(-4)}`);
      }
    }

    if (!selectedKey) {
      // 使用性能优化器优化密钥选择
      const availableKeys = keyManager.state ? keyManager.state.keys.map(k => k.key) : [];
      selectedKey = performanceOptimizer.optimizeKeySelection(availableKeys) || keyManager.selectKey();
    }
  }

  if (!selectedKey) {
    return new Response(
      JSON.stringify({ error: { message: "No available API keys." } }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
   logger.info(`Selected API Key ending with ...${selectedKey.slice(-4)}`);

  // 根据请求类型设置头部
  const baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
  const apiVersion = process.env.GEMINI_API_VERSION || "v1beta";
  const isOpenAIRequest =
    url.pathname.endsWith("/chat/completions") ||
    url.pathname.endsWith("/embeddings");
  const isOpenAIModelList = (
    url.pathname.endsWith(`/${apiVersion}/openai/models`) ||
    url.pathname.endsWith("/openai/models") ||
    url.pathname.endsWith("/v1/models") ||
    url.pathname.endsWith("/models")
  );
  const isNativeModelList = url.pathname.endsWith(`/${apiVersion}/models`);

  if (isOpenAIRequest || isOpenAIModelList) {
    // OpenAI 格式
    newHeaders.set("Authorization", `Bearer ${selectedKey}`);
    newHeaders.delete("x-goog-api-key");
  } else {
    // 默认为 Gemini 格式
    newHeaders.set("x-goog-api-key", selectedKey);
    newHeaders.delete("Authorization");
  }

  // OpenAI 路由转换
  if (isOpenAIRequest) {
    const openAIRequestStartTime = performance.now();
    const newRequest = new Request(request.url, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
    });
    logger.debug("Forwarding to OpenAI compatible endpoint.");
    
    // 使用性能优化器处理请求
    const response = await performanceOptimizer.optimizeRequest(newRequest, async (req) => {
      return await openai.fetch(req);
    });

    if (response.status === 200 && usingServerKeys && selectedKey) {
      lastSuccessfulKey = selectedKey;
      lastKeyTimestamp = Date.now();
      logger.debug(`Cached last successful key ...${selectedKey.slice(-4)}`);
    }

    const openAIRequestEndTime = performance.now();
    logger.info(`OpenAI compatible endpoint request took ${ (openAIRequestEndTime - openAIRequestStartTime).toFixed(2) }ms`);
    return response;
  }

  const geminiRequestStartTime = performance.now();
  logger.info("Request Sending to Gemini");

  // 检查是否为流式请求
  const isStream = url.searchParams.has('alt') || (request.headers.get("accept") || "").toLowerCase().includes("text/event-stream");
  let targetUrl = `${baseUrl}${pathname}${search}`;
  if (isOpenAIModelList) {
    targetUrl = `${baseUrl}/${apiVersion}/openai/models${search}`;
  } else if (isNativeModelList) {
    targetUrl = `${baseUrl}/${apiVersion}/models${search}`;
  }


  try {
    const geminiRequest = new Request(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: request.body
    });

    let response;
    try {
      response = await performanceOptimizer.optimizeRequest(geminiRequest, async (req) => {
        return await fetch(req);
      });
    } catch (fetchError) {
      // 处理请求被取消的情况
      if (fetchError.name === 'AbortError' || fetchError.message.includes('aborted')) {
        logger.warn(`Request aborted for key ...${selectedKey.slice(-4)}`);
        return new Response(
          JSON.stringify({ error: { message: "Request was cancelled" } }),
          { status: 499, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      }
      throw fetchError;
    }

    // 成功（200）则更新复用缓存
    if (response.status === 200 && usingServerKeys && selectedKey) {
      lastSuccessfulKey = selectedKey;
      lastKeyTimestamp = Date.now();
      logger.debug(`Cached last successful key ...${selectedKey.slice(-4)}`);
    }

    // 对于流式响应，使用优化的流式处理器
    if (isStream && response.ok) {
      logger.info("Streaming response started.");
      return streamHandler.createStreamResponse(response, selectedKey);
    }

    // 对于非流式响应或错误响应，立即返回流式响应
    if (!response.ok) {
      logger.warn(
        `API call failed with status ${response.status} for key ...${selectedKey.slice(-4)}`,
        {
          request: {
            url: targetUrl,
            method: request.method,
            headers: redactHeaders(Object.fromEntries(newHeaders.entries())),
          },
          response: {
            status: response.status,
            headers: redactHeaders(Object.fromEntries(response.headers.entries())),
          },
        }
      );
      if (response.status === 401 || response.status === 403) {
        await keyManager.handleKeyError(selectedKey, response.status, "Auth/Permission error");
      }
    } else {
      logger.info("Call Gemini Success");
    }

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Referrer-Policy", "no-referrer");

    // 直接使用 response.body 实现流式响应，消除阻塞
    const geminiRequestEndTime = performance.now();
    logger.info(`Gemini request took ${(geminiRequestEndTime - geminiRequestStartTime).toFixed(2)}ms`);
    const totalTime = performance.now() - startTime;

    // 记录监控指标
    monitoringSystem.recordRequest({
      statusCode: response.status,
      responseTime: totalTime,
      keyUsed: selectedKey,
      isStream: isStream
    });

    logger.info(`Request completed successfully: ${request.method} ${pathname} - ${totalTime.toFixed(2)}ms`, {
      status: response.status,
      totalTime: `${totalTime.toFixed(2)}ms`,
      keyUsed: `...${selectedKey.slice(-4)}`
    });

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const totalTime = performance.now() - startTime;

    // 记录错误监控指标
    monitoringSystem.recordError(error, selectedKey);
    monitoringSystem.recordRequest({
      statusCode: 500,
      responseTime: totalTime,
      keyUsed: selectedKey,
      error: error
    });

    logger.error("Failed to fetch:", error.message);
    logger.info(`Request completed with error: ${request.method} ${pathname} - ${totalTime.toFixed(2)}ms`, {
      error: error.message,
      totalTime: `${totalTime.toFixed(2)}ms`
    });

    return new Response(
      JSON.stringify({
        error: {
          message:
            "An unexpected error occurred while fetching the upstream API.",
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
}
