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
         timestamp: new Date().toISOString()
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
          return handleModels(request).catch(errHandler);
        case pathname.match(/\/models\/[^\/]+$/):
          assert(request.method === "GET");
          return handleModelRetrieve(request).catch(errHandler);
        case pathname.endsWith("/batches"):
          assert(request.method === "POST");
          return handleBatches(request).catch(errHandler);
        case pathname.match(/\/batches\/[^\/]+$/):
          assert(request.method === "GET");
          return handleBatchRetrieve(request).catch(errHandler);
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

// 性能统计
const performanceStats = {
  requests: 0,
  errors: 0,
  avgResponseTime: 0,
  startTime: Date.now()
};

/**
 * 处理请求参数，包括 reasoning_effort 和 extra_body 字段
 * 将 OpenAI 格式参数转换为 Gemini API 格式
 */
function processRequestParameters(requestBody) {
  const { reasoning_effort, extra_body, ...restBody } = requestBody;
  
  let processedBody = { ...restBody };
  
  // 处理 reasoning_effort 参数
  if (reasoning_effort) {
    const validEfforts = ['low', 'medium', 'high', 'none'];
    if (validEfforts.includes(reasoning_effort)) {
      processedBody.thinking_config = {
        reasoning_effort: reasoning_effort
      };
      logger.info("Processed reasoning_effort", { 
        original: reasoning_effort,
        processed: processedBody.thinking_config 
      });
    } else {
      logger.warn(`Invalid reasoning_effort value: ${reasoning_effort}. Ignoring.`);
    }
  }
  
  // 处理 extra_body 字段
  if (extra_body && typeof extra_body === 'object') {
    // 支持 cached_content
    if (extra_body.cached_content) {
      processedBody.cached_content = extra_body.cached_content;
      logger.info("Processed cached_content", { 
        cached_content: extra_body.cached_content 
      });
    }
    
    // 支持 thinking_config（如果与 reasoning_effort 冲突，extra_body 优先）
    if (extra_body.thinking_config) {
      processedBody.thinking_config = extra_body.thinking_config;
      logger.info("Processed thinking_config from extra_body", { 
        thinking_config: extra_body.thinking_config 
      });
    }
    
    // 支持其他 Gemini 特定参数
    const geminiSpecificParams = ['safety_settings', 'generation_config', 'tools'];
    for (const param of geminiSpecificParams) {
      if (extra_body[param]) {
        processedBody[param] = extra_body[param];
        logger.info(`Processed ${param} from extra_body`, { 
          [param]: extra_body[param] 
        });
      }
    }
  }
  
  return processedBody;
}

/**
 * 处理 Batch API 请求参数
 */
function processBatchRequest(requestBody) {
  const { input_file_id, endpoint, completion_window, ...restBody } = requestBody;
  
  const processedBody = {
    input_file_id,
    endpoint: endpoint || "/v1/chat/completions",
    completion_window: completion_window || "24h",
    ...restBody
  };
  
  // 验证必需参数
  if (!input_file_id) {
    throw new HttpError("input_file_id is required for batch requests", 400);
  }
  
  // 验证 endpoint 格式
  const validEndpoints = ["/v1/chat/completions", "/v1/embeddings"];
  if (!validEndpoints.includes(processedBody.endpoint)) {
    logger.warn(`Invalid endpoint: ${processedBody.endpoint}. Using default.`);
    processedBody.endpoint = "/v1/chat/completions";
  }
  
  // 验证 completion_window
  const validWindows = ["24h"];
  if (!validWindows.includes(processedBody.completion_window)) {
    logger.warn(`Invalid completion_window: ${processedBody.completion_window}. Using default.`);
    processedBody.completion_window = "24h";
  }
  
  logger.info("Processed batch request", processedBody);
  
  return processedBody;
}

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

  // 立即发起请求，不等待响应
  const fetchPromise = fetch(url, {
    method: "POST",
    headers: {
      Authorization: request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
    body: request.body,
  });

  // 创建一个立即返回的流式响应
  const { readable, writable } = new TransformStream();
  
  fetchPromise.then(async response => {
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Referrer-Policy", "no-referrer");

    // 将上游响应体泵入流中
    if (response.body) {
      await response.body.pipeTo(writable);
    } else {
      writable.getWriter().close();
    }
  }).catch(err => {
    logger.error("Error fetching embeddings:", err);
    writable.getWriter().abort(err);
  });

  // 立即返回响应，其 body 是我们创建的流
  return new Response(readable, {
    status: 200, // 初始状态码为 200
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Referrer-Policy": "no-referrer",
      "Content-Type": "application/json",
    },
  });
}

async function handleCompletions(request) {
  const startTime = Date.now();
  performanceStats.requests++;
  
  const requestBody = await request.json();
  const stream = requestBody.stream || false;

  // 处理 reasoning_effort 参数和 extra_body 字段
  const processedBody = processRequestParameters(requestBody);

  let url = `${baseUrl}/${apiVersion}/openai/chat/completions`;
  
  logger.info("Processing completions request", {
    model: requestBody.model,
    stream,
    hasReasoningEffort: !!requestBody.reasoning_effort,
    hasExtraBody: !!requestBody.extra_body,
    requestId: performanceStats.requests
  });

  // 立即发起请求，不等待响应
  const fetchPromise = fetch(url, {
    method: "POST",
    headers: {
      "Authorization": request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(processedBody),
  });

  const { readable, writable } = new TransformStream();

  fetchPromise.then(async response => {
    const responseTime = Date.now() - startTime;
    performanceStats.avgResponseTime = (performanceStats.avgResponseTime + responseTime) / 2;
    
    logger.info("Received response from OpenAI compatible endpoint", {
      status: response.status,
      responseTime: `${responseTime}ms`,
      headers: redactHeaders(Object.fromEntries(response.headers.entries())),
      requestId: performanceStats.requests
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Referrer-Policy", "no-referrer");

    if (!response.ok) {
      // 处理错误响应
      let errorData;
      try {
        const errorText = await response.text();
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { error: { message: "Unknown error occurred", type: "server_error" } };
      }
      
      // 规范化错误响应格式
      const normalizedError = {
        error: {
          message: errorData.error?.message || "Request failed",
          type: errorData.error?.type || "server_error",
          code: errorData.error?.code || "unknown_error"
        }
      };
      
      const errorResponse = new TextEncoder().encode(JSON.stringify(normalizedError));
      const writer = writable.getWriter();
      await writer.write(errorResponse);
      await writer.close();
      return;
    }

    if (stream) {
      responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("Connection", "keep-alive");
      
      // 创建流式响应转换器
      const streamTransformer = {
        start() {},
        transform(chunk, controller) {
          try {
            const text = new TextDecoder().decode(chunk);
            const lines = text.split('\n');
            
            for (const line of lines) {
              if (line.trim()) {
                // 确保 SSE 格式正确
                if (line.startsWith('data: ')) {
                  controller.enqueue(new TextEncoder().encode(line + '\n'));
                } else if (line.startsWith('{')) {
                  // 处理 JSON 数据
                  controller.enqueue(new TextEncoder().encode(`data: ${line}\n\n`));
                } else {
                  controller.enqueue(new TextEncoder().encode(line + '\n'));
                }
              }
            }
          } catch (e) {
            logger.error("Stream transform error", e);
            controller.enqueue(chunk);
          }
        },
        flush(controller) {
          // 发送结束标记
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        }
      };
      
      const transformStream = new TransformStream(streamTransformer);
      if (response.body) {
        response.body.pipeTo(transformStream.writable);
        await transformStream.readable.pipeTo(writable);
      } else {
        writable.getWriter().close();
      }
    } else {
      const transformer = {
        buffer: '',
        start() {},
        transform(chunk, controller) {
          try {
            const text = new TextDecoder().decode(chunk);
            this.buffer += text;

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
                      controller.enqueue(new TextEncoder().encode(JSON.stringify(normalized.data)));
                    } else {
                      controller.enqueue(new TextEncoder().encode(jsonStr));
                    }
                    this.buffer = this.buffer.substring(i + 1);
                    start = -1;
                    i = -1;
                  } catch (e) {
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
          if (this.buffer.trim()) {
            try {
              const data = JSON.parse(this.buffer);
              const model = requestBody.model || "gemini";
              const normalized = normalizeOpenAIChatResponse(data, model);
              if (normalized.ok) {
                controller.enqueue(new TextEncoder().encode(JSON.stringify(normalized.data)));
              } else {
                controller.enqueue(new TextEncoder().encode(this.buffer));
              }
            } catch (e) {
              logger.warn("Failed to parse remaining buffer as JSON", e);
              controller.enqueue(new TextEncoder().encode(this.buffer));
            }
          }
        }
      };
      
      const transformStream = new TransformStream(transformer);
      if (response.body) {
        response.body.pipeTo(transformStream.writable);
        await transformStream.readable.pipeTo(writable);
      } else {
        writable.getWriter().close();
      }
    }
  }).catch(err => {
    performanceStats.errors++;
    const responseTime = Date.now() - startTime;
    
    logger.error("Error fetching completions:", {
      error: err.message,
      responseTime: `${responseTime}ms`,
      requestId: performanceStats.requests,
      errorRate: `${(performanceStats.errors / performanceStats.requests * 100).toFixed(2)}%`
    });
    
    writable.getWriter().abort(err);
  });

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Referrer-Policy": "no-referrer",
  };
  if (stream) {
    headers["Content-Type"] = "text/event-stream; charset=utf-8";
    headers["Cache-Control"] = "no-cache";
    headers["Connection"] = "keep-alive";
  } else {
    headers["Content-Type"] = "application/json";
  }

  return new Response(readable, { status: 200, headers });
}

// 支持的 Gemini 模型列表
const SUPPORTED_MODELS = [
  {
    id: "gemini-2.0-flash",
    object: "model",
    created: 1700000000,
    owned_by: "google"
  },
  {
    id: "gemini-2.5-flash", 
    object: "model",
    created: 1700000000,
    owned_by: "google"
  },
  {
    id: "gemini-2.5-pro",
    object: "model", 
    created: 1700000000,
    owned_by: "google"
  },
  {
    id: "gemini-1.5-flash",
    object: "model",
    created: 1700000000,
    owned_by: "google"
  },
  {
    id: "gemini-1.5-pro",
    object: "model",
    created: 1700000000,
    owned_by: "google"
  },
  {
    id: "gemini-embedding-001",
    object: "model",
    created: 1700000000,
    owned_by: "google"
  }
];

async function handleModels(request) {
  const response = {
    object: "list",
    data: SUPPORTED_MODELS
  };
  
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Referrer-Policy": "no-referrer"
    }
  });
}

async function handleModelRetrieve(request) {
  const url = new URL(request.url);
  const modelId = url.pathname.split('/').pop();
  
  const model = SUPPORTED_MODELS.find(m => m.id === modelId);
  if (!model) {
    throw new HttpError("Model not found", 404);
  }
  
  return new Response(JSON.stringify(model), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Referrer-Policy": "no-referrer"
    }
  });
}

async function handleBatches(request) {
  const requestBody = await request.json();
  
  // 处理 Batch API 请求参数
  const processedBody = processBatchRequest(requestBody);
  
  let url = `${baseUrl}/${apiVersion}/openai/batches`;
  
  logger.info("Creating batch request", {
    input_file_id: processedBody.input_file_id,
    endpoint: processedBody.endpoint,
    completion_window: processedBody.completion_window
  });
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(processedBody),
  });
  
  const responseData = await response.json();
  
  logger.info("Batch creation response", {
    status: response.status,
    batch_id: responseData.id,
    status: responseData.status
  });
  
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Referrer-Policy": "no-referrer"
    }
  });
}

async function handleBatchRetrieve(request) {
  const url = new URL(request.url);
  const batchId = url.pathname.split('/').pop();
  
  let apiUrl = `${baseUrl}/${apiVersion}/openai/batches/${batchId}`;
  
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      "Authorization": request.headers.get("Authorization"),
      "Content-Type": "application/json",
    }
  });
  
  const responseData = await response.json();
  
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Referrer-Policy": "no-referrer"
    }
  });
}
