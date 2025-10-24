import { logger } from "../src/logger.mjs";

const baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const apiVersion = process.env.GEMINI_API_VERSION || "v1beta";

export default function onRequest(context) {
  const request = context.request;
  
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const url = `${baseUrl}/${apiVersion}/openai/models`;
  return fetch(url, {
    headers: {
      Authorization: request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
  }).then(response => {
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Referrer-Policy", "no-referrer");
    responseHeaders.set("Content-Type", "application/json");

    // 使用流式响应提高性能
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  });
}
