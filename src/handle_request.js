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

  const headers = new Headers();
  if (request.headers.has('content-type')) {
    headers.set('content-type', request.headers.get('content-type'));
  }

  const clientToken = request.headers.get('x-goog-api-key');
  const serverAuthToken = process.env.AUTH_TOKEN;
  const serverApiKey = process.env.GEMINI_API_KEY;

  let finalApiKey = '';

  if (!clientToken) {
    return new Response(JSON.stringify({ error: { message: 'Authentication failed. Please provide a valid Gemini API key or authentication token in the `x-goog-api-key` header.' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  if (serverAuthToken && clientToken === serverAuthToken) {
    // 模式1：客户端提供 Auth Token，使用服务端的 Gemini Key
    if (!serverApiKey) {
      return new Response(JSON.stringify({ error: { message: 'Server authentication successful, but no GEMINI_API_KEY is configured on the server.' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    finalApiKey = serverApiKey;
    console.debug("Using server-provided Gemini API Key via Auth Token.");
  } else {
    // 模式2：客户端提供的 token 被视为 Gemini Key
    finalApiKey = clientToken;
    console.debug("Using client-provided Gemini API Key.");
  }

  const apiKeys = finalApiKey.split(',').map(k => k.trim()).filter(k => k);
  const selectedKey = selectApiKey(apiKeys);

  if (!selectedKey) {
    return new Response(JSON.stringify({ error: { message: 'No valid API keys found after processing.' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  
  headers.set('x-goog-api-key', selectedKey);

  try {
    console.info("Request Sending to Gemini");
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body
    });

    console.info("Call Gemini Success");
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
    console.error('Failed to fetch:', error);
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
