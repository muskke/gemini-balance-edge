/**
 * EdgeOne Pages Function 入口文件
 * 简化版 - 先测试基本功能
 */

export default async function onRequest(context) {
  const startTime = Date.now();

  try {
    const { request, env } = context || {};

    // 记录请求
    console.log(`[${new Date().toISOString()}] ${request.method} ${request.url}`);

    // 处理 OPTIONS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "*",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // 根路径
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(
        "✅ Gemini Balance Edge is running on EdgeOne Pages!\n\n" +
        "Environment: " + JSON.stringify({
          hasGeminiKey: !!env.GEMINI_API_KEY,
          hasAuthToken: !!env.AUTH_TOKEN
        }, null, 2),
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
          },
        }
      );
    }

    // 简单测试端点
    if (pathname === "/test") {
      return new Response(
        JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
          method: request.method,
          url: request.url
        }, null, 2),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          },
        }
      );
    }

    // 代理到 Gemini API
    if (pathname.startsWith("/v1beta")) {
      return await proxyToGemini(request, env);
    }

    // 默认响应
    return new Response(
      JSON.stringify({
        error: "Not found",
        path: pathname,
        availablePaths: ["/", "/test", "/v1beta/*"]
      }, null, 2),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
      }
    );

  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error.message,
        stack: error.stack
      }, null, 2),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
}

/**
 * 代理请求到 Gemini API
 */
async function proxyToGemini(request, env) {
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }

  const url = new URL(request.url);
  const targetUrl = `https://generativelanguage.googleapis.com${url.pathname}${url.search}`;

  const headers = new Headers(request.headers);
  headers.set("x-goog-api-key", apiKey);
  headers.delete("authorization");
  headers.delete("Authorization");

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.body
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });

  } catch (error) {
    console.error("Proxy error:", error);
    return new Response(
      JSON.stringify({
        error: "Proxy failed",
        message: error.message
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
}
