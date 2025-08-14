import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';
import { selectApiKey } from './utils.js';

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

  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // 处理OpenAI格式请求
  if (url.pathname.endsWith("/chat/completions") || url.pathname.endsWith("/completions") || url.pathname.endsWith("/embeddings") || url.pathname.endsWith("/models")) {
    return openai.fetch(request);
  }

  const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const targetUrl = `${GEMINI_BASE_URL}${pathname}${search}`;

  try {
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      if (key.trim().toLowerCase() === "content-type") {
        headers.set(key, value);
      } else if (key.trim().toLowerCase() === 'x-goog-api-key') {
        const serverAuthToken = process.env.AUTH_TOKEN;
        const serverApiKey = process.env.GEMINI_API_KEY;

        let finalApiKey = "";

        clientToken = value;
        if (serverAuthToken && clientToken === serverAuthToken) {
          // 模式1：客户端提供正确的 Auth Token，使用服务端的 Gemini Key
          if (!serverApiKey) {
            throw new HttpError(
              "Server authentication successful, but no GEMINI_API_KEY is configured on the server.",
              500
            );
          }
          finalApiKey = serverApiKey;
          console.debug(
            "Using server-provided Gemini API Key via Auth Token for Gemini request."
          );
        } else if (clientToken) {
          // 模式2：客户端提供的 token 被视为 Gemini Key
          finalApiKey = clientToken;
          console.debug(
            "Using client-provided Gemini API Key for Gemini request."
          );
        } else {
          // 凭证无效或未提供
          return new Response(
            JSON.stringify({
              error: {
                message:
                  "Authentication failed. Please provide a valid Gemini API key or a valid authentication token in the `x-goog-api-key` header.",
                type: "authentication_error",
              },
            }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          );
        } 
    }

    const apiKeys = finalApiKey.split(',').map(k => k.trim()).filter(k => k);
    const selectedKey = selectApiKey(apiKeys);

    if (selectedKey) {
      headers.set('x-goog-api-key', selectedKey);
    } else {
      // 如果分割后没有有效的key
      throw new Error('No valid API keys found after processing.');
    }
  }

    console.info("Request Sending to Gemini");
    console.debug('targetUrl:'+targetUrl)
    console.debug(headers);

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body
    });

    console.info("Call Gemini Success");

    const responseHeaders = new Headers(response.headers);

    console.debug('Header from Gemini:')
    console.debug(responseHeaders)

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
    console.error('Failed to fetch:', error);
   return new Response('Internal Server Error\n' + error?.stack, {
      status: 500,
    headers: { 'Content-Type': 'text/plain' }
    });
  }
};
