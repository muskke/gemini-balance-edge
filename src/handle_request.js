import { handleVerification } from "./verify_keys.js";
import openai from "./openai.mjs";
import { KeyManager } from "./utils.js";
import { logger, redactHeaders } from "./logger.mjs";

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

  if (pathname === "/verify" && request.method === "POST") {
    const serverAuthToken = process.env.AUTH_TOKEN;
    if (serverAuthToken) {
      const authHeader = request.headers.get("Authorization");
      const bearer = authHeader?.split(" ")[1];
      if (bearer !== serverAuthToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }
    return handleVerification(request);
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
  let selectedKey = "";
  let clientTokenStr = "";

  // 确定使用服务器密钥还是客户端密钥
  const authHeader = newHeaders.get("Authorization");
  const clientApiKey_OpenAI = authHeader?.split(" ")[1];
  const clientApiKey_Gemini = newHeaders.get("x-goog-api-key");

  if (
    serverAuthToken &&
    (clientApiKey_OpenAI === serverAuthToken ||
      clientApiKey_Gemini === serverAuthToken)
  ) {
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
    selectedKey = keyManager.selectKey();
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
  const isOpenAIRequest =
    url.pathname.endsWith("/chat/completions") ||
    url.pathname.endsWith("/embeddings") ||
    url.pathname.endsWith("/models");

  if (isOpenAIRequest) {
    // OpenAI 格式
    newHeaders.set("Authorization", `Bearer ${selectedKey}`);
  } else {
    // 默认为 Gemini 格式
    newHeaders.set("x-goog-api-key", selectedKey);
    newHeaders.delete("Authorization");
  }

  // OpenAI 路由转换
  if (isOpenAIRequest) {
    const newRequest = new Request(request.url, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
    });
    logger.debug("Forwarding to OpenAI compatible endpoint.");
    return openai.fetch(newRequest);
  }

  logger.info("Request Sending to Gemini");

  // 检查是否为流式请求
  const isStream = search.includes("alt=sse");
  const targetUrl = `${baseUrl}${pathname}${search}`;


  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: request.body // 直接传递请求体，遵循标准 Web Fetch
    });

    // 对于流式响应，立即返回，不等待完整内容
    if (isStream && response.ok) {
      logger.info("Streaming response started.");
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("Connection", "keep-alive");
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Referrer-Policy", "no-referrer");
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    // 对于非流式响应或错误响应
    const responseBody = await response.text();
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
        await keyManager.markAsUnhealthy(selectedKey);
      }
    } else {
      logger.info("Call Gemini Success (non-stream)");
    }

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Referrer-Policy", "no-referrer");

    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    logger.error("Failed to fetch:", error.message);
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
