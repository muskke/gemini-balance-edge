//Author: PublicAffairs
//Project: https://github.com/PublicAffairs/openai-gemini
//MIT License : https://github.com/PublicAffairs/openai-gemini/blob/main/LICENSE

import { selectApiKey } from './utils.js';

// 日志级别配置
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

// 优化的日志函数
const logger = {
  error: (msg, ...args) => LOG_LEVEL >= LOG_LEVELS.ERROR && console.error(`[ERROR] ${msg}`, ...args),
  warn: (msg, ...args) => LOG_LEVEL >= LOG_LEVELS.WARN && console.warn(`[WARN] ${msg}`, ...args),
  info: (msg, ...args) => LOG_LEVEL >= LOG_LEVELS.INFO && console.info(`[INFO] ${msg}`, ...args),
  debug: (msg, ...args) => LOG_LEVEL >= LOG_LEVELS.DEBUG && console.debug(`[DEBUG] ${msg}`, ...args)
};

// 添加请求ID生成
const generateRequestId = () => {
  return 'req_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
};

export default {
  async fetch (request) {
    const requestId = generateRequestId();
    
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }
    
    const errHandler = (err) => {
      logger.error(`[${requestId}] Request failed:`, err.message);
      return new Response(err.message, fixCors({ status: err.status ?? 500 }));
    };
    
    const authHeader = request.headers.get("Authorization");
    const apiKey = authHeader?.split(" ")[1];

    if (!apiKey) {
      return errHandler(new HttpError('No valid API keys found after processing.', 401));
    }
    
    // 只记录API密钥的前4位和后4位，避免泄漏
    logger.debug(`[${requestId}] API Key: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`);

    try {
      const { pathname } = new URL(request.url);
      logger.info(`[${requestId}] Processing ${request.method} ${pathname}`);
      
      // 优化路由匹配逻辑
      if (pathname.endsWith("/chat/completions")) {
        if (request.method !== "POST") {
          throw new HttpError("Method not allowed", 405);
        }
        return handleCompletions(await request.json(), apiKey, requestId);
      }
      
      if (pathname.endsWith("/embeddings")) {
        if (request.method !== "POST") {
          throw new HttpError("Method not allowed", 405);
        }
        return handleEmbeddings(await request.json(), apiKey, requestId);
      }
      
      if (pathname.endsWith("/models")) {
        if (request.method !== "GET") {
          throw new HttpError("Method not allowed", 405);
        }
        return handleModels(apiKey, requestId);
      }
      
      throw new HttpError("404 Not Found", 404);
    } catch (err) {
      return errHandler(err);
    }
  }
};

// ... 保持现有的 HttpError, fixCors, handleOPTIONS 等函数不变 ...

// 修复后的函数，添加requestId参数
async function handleModels (apiKey, requestId) {
  logger.debug(`[${requestId}] Fetching models list`);
  try {
    const response = await fetch(`${BASE_URL}/${API_VERSION}/models`, {
      headers: makeHeaders(apiKey),
    });
    
    if (!response.ok) {
      logger.error(`[${requestId}] Models API failed: ${response.status} ${response.statusText}`);
      return new Response(response.body, fixCors(response));
    }
    
    const responseText = await response.text();
    const { models } = JSON.parse(responseText);
    
    const body = JSON.stringify({
      object: "list",
      data: models.map(({ name }) => ({
        id: name.replace("models/", ""),
        object: "model",
        created: 0,
        owned_by: "",
      })),
    }, null, 2);
    
    logger.debug(`[${requestId}] Found ${models.length} models`);
    return new Response(body, fixCors(response));
  } catch (error) {
    logger.error(`[${requestId}] Error in handleModels:`, error.message);
    throw new HttpError('Failed to fetch models', 500);
  }
}

// 修复函数中的日志调用
const transformFnResponse = ({ content, tool_call_id }, parts) => {
  if (!parts.calls) {
    throw new HttpError("No function calls found in the previous message", 400);
  }
  let response;
  try {
    response = JSON.parse(content);
  } catch (err) {
    logger.error("Error parsing function response content:", err.message); // 修复：使用logger
    throw new HttpError("Invalid function response: " + content, 400);
  }
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    response = { result: response };
  }
  if (!tool_call_id) {
    throw new HttpError("tool_call_id not specified", 400);
  }
  const { i, name } = parts.calls[tool_call_id] ?? {};
  if (!name) {
    throw new HttpError("Unknown tool_call_id: " + tool_call_id, 400);
  }
  if (parts[i]) {
    throw new HttpError("Duplicated tool_call_id: " + tool_call_id, 400);
  }
  parts[i] = {
    functionResponse: {
      id: tool_call_id.startsWith("call_") ? null : tool_call_id,
      name,
      response,
    }
  };
};

const transformFnCalls = ({ tool_calls }) => {
  const calls = {};
  const parts = tool_calls.map(({ function: { arguments: argstr, name }, id, type }, i) => {
    if (type !== "function") {
      throw new HttpError(`Unsupported tool_call type: "${type}"`, 400);
    }
    let args;
    try {
      args = JSON.parse(argstr);
    } catch (err) {
      logger.error("Error parsing function arguments:", err.message); // 修复：使用logger
      throw new HttpError("Invalid function arguments: " + argstr, 400);
    }
    calls[id] = {i, name};
    return {
      functionCall: {
        id: id.startsWith("call_") ? null : id,
        name,
        args,
      }
    };
  });
  parts.calls = calls;
  return parts;
};

const checkPromptBlock = (choices, promptFeedback, key) => {
  if (choices.length) { return; }
  if (promptFeedback?.blockReason) {
    logger.info("Prompt block reason:", promptFeedback.blockReason); // 修复：使用logger
    if (promptFeedback.blockReason === "SAFETY") {
      promptFeedback.safetyRatings
        .filter(r => r.blocked)
        .forEach(r => logger.info(r)); // 修复：使用logger
    }
    choices.push({
      index: 0,
      [key]: null,
      finish_reason: "content_filter",
    });
  }
  return true;
};

function parseStreamFlush (controller) {
  if (this.buffer) {
    logger.error("Invalid data:", this.buffer); // 修复：使用logger
    controller.enqueue(this.buffer);
    this.shared.is_buffers_rest = true;
  }
}

// 优化 ID 生成性能
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_CHARS_LENGTH = ID_CHARS.length;

const generateId = () => {
  let result = '';
  for (let i = 0; i < 29; i++) {
    result += ID_CHARS[Math.floor(Math.random() * ID_CHARS_LENGTH)];
  }
  return result;
};

// 保留最终版本的流处理函数（删除重复定义）
function toOpenAiStream (line, controller) {
  let data;
  try {
    data = JSON.parse(line);
    
    // 检查错误响应
    if (data.error) {
      logger.error("Gemini API streaming error:", data.error);
      
      const errorResponse = {
        id: this.id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: this.model,
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            content: `Error: ${data.error.message || 'Internal server error'}`
          },
          finish_reason: "stop"
        }]
      };
      
      controller.enqueue(sseline(errorResponse));
      controller.enqueue(sseline({
        id: this.id,
        object: "chat.completion.chunk", 
        created: Math.floor(Date.now() / 1000),
        model: this.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
      }));
      controller.enqueue("data: [DONE]" + delimiter);
      return;
    }
    
    if (!data.candidates) {
      throw new Error("Invalid completion chunk object");
    }
  } catch (err) {
    logger.error("Error parsing streaming response:", err.message);
    if (!this.shared.is_buffers_rest) { 
      line += delimiter; 
    }
    controller.enqueue(line);
    return;
  }
  
  const obj = {
    id: this.id,
    choices: data.candidates.map(transformCandidatesDelta),
    model: data.modelVersion ?? this.model,
    object: "chat.completion.chunk",
    usage: data.usageMetadata && this.streamIncludeUsage ? null : undefined,
  };
  
  if (checkPromptBlock(obj.choices, data.promptFeedback, "delta")) {
    controller.enqueue(sseline(obj));
    return;
  }
  
  if (data.candidates.length !== 1) {
    logger.warn(`Unexpected candidates count: ${data.candidates.length}`);
  }
  
  const cand = obj.choices[0];
  cand.index = cand.index || 0;
  const finish_reason = cand.finish_reason;
  cand.finish_reason = null;
  
  if (!this.last[cand.index]) {
    controller.enqueue(sseline({
      ...obj,
      choices: [{ ...cand, tool_calls: undefined, delta: { role: "assistant", content: "" } }],
    }));
  }
  
  delete cand.delta.role;
  if ("content" in cand.delta) {
    controller.enqueue(sseline(obj));
  }
  
  cand.finish_reason = finish_reason;
  if (data.usageMetadata && this.streamIncludeUsage) {
    obj.usage = transformUsage(data.usageMetadata);
  }
  cand.delta = {};
  this.last[cand.index] = obj;
}

function toOpenAiStreamFlush (controller) {
  if (this.last.length > 0) {
    for (const obj of this.last) {
      controller.enqueue(sseline(obj));
    }
    controller.enqueue("data: [DONE]" + delimiter);
  }
}