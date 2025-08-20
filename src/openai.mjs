//Author: muskke
//Project: https://github.com/muskke/gemini-balance-edge
//MIT License : https://github.com/muskke/gemini-balance-edge/blob/main/LICENSE
import { logger, redactHeaders } from "./logger.mjs";

export default {
  async fetch (request) {
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }
    const errHandler = (err) => {
      logger.error(err);
      return new Response(err.message, fixCors({ status: err.status ?? 500 }));
    };
    try {
      const assert = (success) => {
        if (!success) {
          throw new HttpError("The specified HTTP method is not allowed for the requested resource", 400);
        }
      };

       logger.info("Forwarding to OpenAI compatible endpoint", {
         url: request.url,
         method: request.method,
         headers: redactHeaders(Object.fromEntries(request.headers.entries())),
        //  body: await request.clone().text(),
       });
      
      const { pathname } = new URL(request.url);
      switch (true) {
        case pathname.endsWith("/chat/completions"):
          assert(request.method === "POST");
          return handleCompletions(request)
            .catch(errHandler);
        case pathname.endsWith("/embeddings"):
          assert(request.method === "POST");
          return handleEmbeddings(request).catch(errHandler);
        case pathname.endsWith("/models"):
          assert(request.method === "GET");
          return handleModels(request)
            .catch(errHandler);
        default:
          throw new HttpError("404 Not Found", 404);
      }
    } catch (err) {
      return errHandler(err);
    }
  }
};

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

const fixCors = ({ headers, status, statusText }) => {
  headers = new Headers(headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return { headers, status, statusText };
};

const handleOPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    }
  });
};


const baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const apiVersion = process.env.GEMINI_API_VERSION || "v1beta";

/**
 * 规范化非流响应为标准 OpenAI Chat 格式
 * 1) 若已符合（choices[0].message.content 存在）则原样返回
 * 2) 若存在 choices[0].text 或 output_text，则组装为 assistant message
 */
function normalizeOpenAIChatResponse(data, model) {
  try {
    if (Array.isArray(data?.choices) && data.choices.length > 0 && data.choices[0]?.message?.content != null) {
      return { ok: true, data };
    }
    const text = data?.choices?.[0]?.text ?? data?.output_text ?? null;
    if (typeof text === "string" && text.length > 0) {
      const now = Math.floor(Date.now() / 1000);
      const normalized = {
        id: data.id ?? `chatcmpl_${now}`,
        object: "chat.completion",
        created: data.created ?? now,
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: data?.choices?.[0]?.finish_reason ?? "stop",
          },
        ],
        usage: data.usage,
      };
      return { ok: true, data: normalized };
    }
    return { ok: false, reason: "missing_assistant_message" };
  } catch (_e) {
    return { ok: false, reason: "normalize_exception" };
  }
}

async function handleModels(request) {
  let url = `${baseUrl}/${apiVersion}/openai/models`;
  const response = await fetch(url, {
    headers: {
      Authorization: request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
  });
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

async function handleEmbeddings(request) {
  let url = `${baseUrl}/${apiVersion}/openai/embeddings`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
    body: request.body,
  });
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

async function handleCompletions(request) {
  const requestBody = await request.json();
  const stream = requestBody.stream || false;

  let url = `${baseUrl}/${apiVersion}/openai/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (stream) {
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Referrer-Policy", "no-referrer");
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  }

  const raw = await response.text();

  logger.info("Received response from OpenAI compatible endpoint", {
    status: response.status,
    headers: redactHeaders(Object.fromEntries(response.headers.entries())),
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Referrer-Policy", "no-referrer");

  // 上游非 2xx：原样透传（保持调试信息）
  if (!response.ok) {
    return new Response(raw, {
      status: response.status,
      headers: responseHeaders,
    });
  }

  // 上游 2xx：尽量规范化为标准 OpenAI Chat 格式
  let bodyToSend = raw;
  try {
    const data = JSON.parse(raw);
    const norm = normalizeOpenAIChatResponse(data, requestBody.model);
    if (norm.ok) {
      bodyToSend = JSON.stringify(norm.data);
      responseHeaders.set("Content-Type", "application/json");
    } // 否则保留上游原文，便于客户端诊断
  } catch (_e) {
    // 非 JSON 保持原样
  }

  return new Response(bodyToSend, {
    status: response.status,
    headers: responseHeaders,
  });
}
