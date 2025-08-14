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

  const serverAuthToken = process.env.AUTH_TOKEN;
  const serverApiKey = process.env.GEMINI_API_KEY;

  // 克隆请求头，以便修改
  const newHeaders = new Headers(request.headers);
  const selectedKey = '';

  // OpenAI 格式请求处理
  if (url.pathname.endsWith("/chat/completions") || url.pathname.endsWith("/completions") || url.pathname.endsWith("/embeddings") || url.pathname.endsWith("/models")) {
    console.info("进入openai兼容分支");
    const authHeader = newHeaders.get("Authorization");
    const clientToken = authHeader?.split(" ")[1];

    if (serverAuthToken && clientToken === serverAuthToken) {
      console.info("服务端模式");
      if (!serverApiKey) {
        return new Response(JSON.stringify({ error: { message: 'Server authentication successful, but no GEMINI_API_KEY is configured on the server.' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      const selectedKey = selectApiKey(serverApiKey.split(',').map(k => k.trim()).filter(k => k));
      console.info("Using server-provided Gemini API Key for OpenAI request.");
    } else {
      console.info("客户端模式");
      selectedKey = selectApiKey(clientToken.split(',').map(k => k.trim()).filter(k => k));
      console.info("Using client-provided Gemini API Key for OpenAI request.");
    }
    newHeaders.set("Authorization", `Bearer ${selectedKey}`);
    
    const newRequest = new Request(request, { headers: newHeaders });
    console.info("newHeaders:" + newHeaders);
    return openai.fetch(newRequest);
  }

  console.info("进入gemini原生分支");

  // Gemini 原生格式请求处理
  const clientToken = newHeaders.get('x-goog-api-key');
  if (serverAuthToken && clientToken === serverAuthToken) {
    console.info("服务端模式");
    if (!serverApiKey) {
      return new Response(JSON.stringify({ error: { message: 'Server authentication successful, but no GEMINI_API_KEY is configured on the server.' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    selectedKey = selectApiKey(serverApiKey.split(',').map(k => k.trim()).filter(k => k));
    newHeaders.set('x-goog-api-key', selectedKey);
    console.debug("Using server-provided Gemini API Key for Gemini request.");
  } else if (clientToken) {
    console.info("客户端模式");
    selectedKey = selectApiKey(clientToken.split(',').map(k => k.trim()).filter(k => k));
    newHeaders.set('x-goog-api-key', selectedKey);
    console.debug("Using client-provided Gemini API Key for Gemini request.");
  } else {
     return new Response(JSON.stringify({ error: { message: 'Authentication failed. Please provide a valid Gemini API key in the `x-goog-api-key` header.' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const targetUrl = `${GEMINI_BASE_URL}${pathname}${search}`;

  console.info("newHeaders:" + newHeaders);
  try {
    let requestBody;
    if (request.method === 'POST') {
      try {
        const originalBody = await request.json();
        const sanitizedBody = {
          ...(originalBody.contents && { contents: originalBody.contents }),
          ...(originalBody.generationConfig && { generationConfig: originalBody.generationConfig }),
          ...(originalBody.safetySettings && { safetySettings: originalBody.safetySettings }),
          ...(originalBody.tools && { tools: originalBody.tools }),
        };
        requestBody = JSON.stringify(sanitizedBody);
        console.debug("Sanitized request body for Gemini API.");
      } catch (e) {
        console.error("Could not parse request body:", e);
        return new Response(JSON.stringify({ error: { message: 'Invalid JSON in request body.' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    }
    console.info("API Key:", newHeaders.get('x-goog-api-key'));

    console.info("Request Sending to Gemini");
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: newHeaders, // 使用修改后的请求头
      body: requestBody
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
