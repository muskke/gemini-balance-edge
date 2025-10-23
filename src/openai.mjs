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

async function handleEmbeddings(request) {
  let url = `${baseUrl}/${apiVersion}/openai/embeddings`;

  // 立即发起请求，不等待响应，避免超时
  const fetchPromise = fetch(url, {
    method: "POST",
    headers: {
      Authorization: request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
    body: request.body,
  });

  // 立即返回响应，不等待上游响应完成
  const response = await fetchPromise;

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Referrer-Policy", "no-referrer");

  // 直接使用流式响应，避免阻塞等待
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

async function handleCompletions(request) {
  const requestBody = await request.json();
  const stream = requestBody.stream || false;

  let url = `${baseUrl}/${apiVersion}/openai/chat/completions`;

  // 立即发起请求，不等待响应，避免超时
  const fetchPromise = fetch(url, {
    method: "POST",
    headers: {
      "Authorization": request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  // 立即返回响应，不等待上游响应完成
  const response = await fetchPromise;

  logger.info("Received response from OpenAI compatible endpoint", {
    status: response.status,
    headers: redactHeaders(Object.fromEntries(response.headers.entries())),
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Referrer-Policy", "no-referrer");

  // 如果是错误响应，直接流式透传
  if (!response.ok) {
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  }

  // 统一使用流式响应，避免阻塞等待
  if (stream) {
    // 流式请求：直接透传上游的响应流
    responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
    responseHeaders.set("Cache-Control", "no-cache");
    responseHeaders.set("Connection", "keep-alive");
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } else {
    // 非流式请求：使用 TransformStream 实时组装完整的 JSON
    responseHeaders.set("Content-Type", "application/json");

    const { readable, writable } = new TransformStream({
      start(controller) {
        this.buffer = '';
        this.chunks = [];
      },
      transform(chunk, controller) {
        try {
          const text = new TextDecoder().decode(chunk);
          this.buffer += text;

          // 尝试解析完整的 JSON 对象
          let braceCount = 0;
          let start = -1;
          for (let i = 0; i < this.buffer.length; i++) {
            if (this.buffer[i] === '{') {
              if (start === -1) start = i;
              braceCount++;
            } else if (this.buffer[i] === '}') {
              braceCount--;
              if (braceCount === 0 && start !== -1) {
                try {
                  const jsonStr = this.buffer.substring(start, i + 1);
                  const data = JSON.parse(jsonStr);
                  const model = requestBody.model || "gemini";
                  const normalized = normalizeOpenAIChatResponse(data, model);
                  if (normalized.ok) {
                    controller.enqueue(JSON.stringify(normalized.data));
                  } else {
                    controller.enqueue(jsonStr);
                  }
                  // 重置缓冲区，移除已处理的 JSON
                  this.buffer = this.buffer.substring(i + 1);
                  start = -1;
                  braceCount = 0;
                  i = -1; // 重置循环
                } catch (e) {
                  // JSON 解析失败，继续累积
                  logger.debug("Incomplete JSON, continuing to buffer", e.message);
                }
              }
            }
          }
        } catch (e) {
          logger.error("Transform stream error", e);
          controller.enqueue(chunk);
        }
      },
      flush(controller) {
        // 处理缓冲区中剩余的非完整 JSON（如果有的话）
        if (this.buffer.trim()) {
          try {
            const data = JSON.parse(this.buffer);
            const model = requestBody.model || "gemini";
            const normalized = normalizeOpenAIChatResponse(data, model);
            if (normalized.ok) {
              controller.enqueue(JSON.stringify(normalized.data));
            } else {
              controller.enqueue(this.buffer);
            }
          } catch (e) {
            logger.warn("Failed to parse remaining buffer as JSON", e);
            controller.enqueue(this.buffer);
          }
        }
      }
    });

    // 立即启动流处理，避免阻塞
    response.body.pipeTo(writable).catch(error => {
      logger.error("Error in stream processing:", error);
    });

    return new Response(readable, {
      status: response.status,
      headers: responseHeaders,
    });
  }
}
