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

export default {
  async fetch (request) {
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }
    
    const errHandler = (err) => {
      logger.error('Request failed:', err.message);
      return new Response(err.message, fixCors({ status: err.status ?? 500 }));
    };
    
    const authHeader = request.headers.get("Authorization");
    const apiKey = authHeader?.split(" ")[1];

    if (!apiKey) {
      return errHandler(new HttpError('No valid API keys found after processing.', 401));
    }
    
    // 只记录API密钥的前4位和后4位，避免泄漏
    logger.debug(`API Key: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`);

    try {
      const { pathname } = new URL(request.url);
      
      // 优化路由匹配逻辑
      if (pathname.endsWith("/chat/completions")) {
        if (request.method !== "POST") {
          throw new HttpError("Method not allowed", 405);
        }
        return handleCompletions(await request.json(), apiKey);
      }
      
      if (pathname.endsWith("/embeddings")) {
        if (request.method !== "POST") {
          throw new HttpError("Method not allowed", 405);
        }
        return handleEmbeddings(await request.json(), apiKey);
      }
      
      if (pathname.endsWith("/models")) {
        if (request.method !== "GET") {
          throw new HttpError("Method not allowed", 405);
        }
        return handleModels(apiKey);
      }
      
      throw new HttpError("404 Not Found", 404);
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

// 缓存CORS头以提高性能
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "*",
  "Access-Control-Allow-Headers": "*",
};

const fixCors = ({ headers, status, statusText }) => {
  const newHeaders = new Headers(headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  return { headers: newHeaders, status, statusText };
};

const handleOPTIONS = () => new Response(null, { headers: CORS_HEADERS });

const BASE_URL = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const API_VERSION = process.env.GEMINI_API_VERSION || "v1beta";
const API_CLIENT = "genai-js/0.24.1";

// 缓存请求头模板
const makeHeaders = (apiKey, more = {}) => ({
  "x-goog-api-client": API_CLIENT,
  ...(apiKey && { "x-goog-api-key": apiKey }),
  ...more
});

async function handleModels (apiKey) {
  logger.debug('Fetching models list');
  try {
    const response = await fetch(`${BASE_URL}/${API_VERSION}/models`, {
      headers: makeHeaders(apiKey),
    });
    
    if (!response.ok) {
      logger.error(`Models API failed: ${response.status} ${response.statusText}`);
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
    
    logger.debug(`Found ${models.length} models`);
    return new Response(body, fixCors(response));
  } catch (error) {
    logger.error('Error in handleModels:', error.message);
    throw new HttpError('Failed to fetch models', 500);
  }
}

const DEFAULT_EMBEDDINGS_MODEL = "text-embedding-004";

async function handleEmbeddings (req, apiKey) {
  if (typeof req.model !== "string") {
    throw new HttpError("model is not specified", 400);
  }
  
  // 优化模型名称处理
  const model = req.model.startsWith("models/") 
    ? req.model 
    : `models/${req.model.startsWith("gemini-") ? req.model : DEFAULT_EMBEDDINGS_MODEL}`;
  
  const input = Array.isArray(req.input) ? req.input : [req.input];
  
  logger.debug(`Processing ${input.length} embeddings with model: ${model}`);
  
  try {
    const response = await fetch(`${BASE_URL}/${API_VERSION}/${model}:batchEmbedContents`, {
      method: "POST",
      headers: makeHeaders(apiKey, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        requests: input.map(text => ({
          model,
          content: { parts: { text } },
          outputDimensionality: req.dimensions,
        }))
      })
    });

    if (!response.ok) {
      logger.error(`Embeddings API failed: ${response.status} ${response.statusText}`);
      return new Response(response.body, fixCors(response));
    }
    
    const responseText = await response.text();
    const { embeddings } = JSON.parse(responseText);
    
    const body = JSON.stringify({
      object: "list",
      data: embeddings.map(({ values }, index) => ({
        object: "embedding",
        index,
        embedding: values,
      })),
      model: req.model,
    }, null, 2);
    
    logger.debug('Embeddings generated successfully');
    return new Response(body, fixCors(response));
  } catch (error) {
    logger.error('Error in handleEmbeddings:', error.message);
    throw new HttpError('Failed to generate embeddings', 500);
  }
}

const DEFAULT_MODEL = "gemini-2.5-flash";

async function handleCompletions (req, apiKey) {
  // 优化模型名称处理逻辑
  let model = DEFAULT_MODEL;
  if (typeof req.model === "string") {
    if (req.model.startsWith("models/")) {
      model = req.model.substring(7);
    } else if (req.model.match(/^(gemini-|gemma-|learnlm-)/)) {
      model = req.model;
    }
  }
  
  logger.debug(`Processing completion request with model: ${model}, stream: ${!!req.stream}`);
  
  try {
    let body = await transformRequest(req);
    
    // 处理额外的 Google 配置
    const extra = req.extra_body?.google;
    if (extra) {
      if (extra.safety_settings) body.safetySettings = extra.safety_settings;
      if (extra.cached_content) body.cachedContent = extra.cached_content;
      if (extra.thinking_config) body.generationConfig.thinkingConfig = extra.thinking_config;
    }
    
    // 处理搜索功能
    const needsSearch = model.endsWith(":search") || 
                       req.model?.endsWith("-search-preview") || 
                       req.tools?.some(tool => tool.function?.name === 'googleSearch');
                       
    if (needsSearch) {
      if (model.endsWith(":search")) {
        model = model.slice(0, -7);
      }
      body.tools = body.tools || [];
      body.tools.push({googleSearch: {}});
      logger.debug('Added Google Search tool');
    }
    
    const TASK = req.stream ? "streamGenerateContent" : "generateContent";
    const url = `${BASE_URL}/${API_VERSION}/models/${model}:${TASK}${req.stream ? "?alt=sse" : ""}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: makeHeaders(apiKey, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      logger.error(`Completion API failed: ${response.status} ${response.statusText}`);
      return new Response(response.body, fixCors(response));
    }

    const id = "chatcmpl-" + generateId();
    const shared = {};
    
    if (req.stream) {
      logger.debug('Setting up streaming response');
      const streamBody = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TransformStream({
          transform: parseStream,
          flush: parseStreamFlush,
          buffer: "",
          shared,
        }))
        .pipeThrough(new TransformStream({
          transform: toOpenAiStream,
          flush: toOpenAiStreamFlush,
          streamIncludeUsage: req.stream_options?.include_usage,
          model, id, last: [],
          shared,
        }))
        .pipeThrough(new TextEncoderStream());
        
      return new Response(streamBody, fixCors(response));
    } else {
      const responseText = await response.text();
      let parsedBody;
      
      try {
        parsedBody = JSON.parse(responseText);
        if (!parsedBody.candidates && !parsedBody.error) {
          throw new Error("Invalid completion object");
        }
      } catch (err) {
        logger.error("Error parsing response:", err.message);
        return new Response(responseText, fixCors(response));
      }
      
      if (parsedBody.error) {
        logger.error("Gemini API error:", parsedBody.error);
        return new Response(responseText, fixCors(response));
      }
      
      const processedBody = processCompletionsResponse(parsedBody, model, id);
      logger.debug('Non-streaming completion processed successfully');
      return new Response(processedBody, fixCors(response));
    }
  } catch (error) {
    logger.error('Error in handleCompletions:', error.message);
    throw new HttpError('Failed to process completion', 500);
  }
}

const adjustProps = (schemaPart) => {
  if (typeof schemaPart !== "object" || schemaPart === null) {
    return;
  }
  if (Array.isArray(schemaPart)) {
    schemaPart.forEach(adjustProps);
  } else {
    if (schemaPart.type === "object" && schemaPart.properties && schemaPart.additionalProperties === false) {
      delete schemaPart.additionalProperties;
    }
    Object.values(schemaPart).forEach(adjustProps);
  }
};
const adjustSchema = (schema) => {
  const obj = schema[schema.type];
  delete obj.strict;
  return adjustProps(schema);
};

const harmCategory = [
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
];
const safetySettings = harmCategory.map(category => ({
  category,
  threshold: "BLOCK_NONE",
}));
const fieldsMap = {
  frequency_penalty: "frequencyPenalty",
  max_completion_tokens: "maxOutputTokens",
  max_tokens: "maxOutputTokens",
  n: "candidateCount", // not for streaming
  presence_penalty: "presencePenalty",
  seed: "seed",
  stop: "stopSequences",
  temperature: "temperature",
  top_k: "topK", // non-standard
  top_p: "topP",
};
const thinkingBudgetMap = {
  low: 1024,
  medium: 8192,
  high: 24576,
};
const transformConfig = (req) => {
  let cfg = {};
  //if (typeof req.stop === "string") { req.stop = [req.stop]; } // no need
  for (let key in req) {
    const matchedKey = fieldsMap[key];
    if (matchedKey) {
      cfg[matchedKey] = req[key];
    }
  }
  if (req.response_format) {
    switch (req.response_format.type) {
      case "json_schema":
        adjustSchema(req.response_format);
        cfg.responseSchema = req.response_format.json_schema?.schema;
        if (cfg.responseSchema && "enum" in cfg.responseSchema) {
          cfg.responseMimeType = "text/x.enum";
          break;
        }
        // eslint-disable-next-line no-fallthrough
      case "json_object":
        cfg.responseMimeType = "application/json";
        break;
      case "text":
        cfg.responseMimeType = "text/plain";
        break;
      default:
        throw new HttpError("Unsupported response_format.type", 400);
    }
  }
  if (req.reasoning_effort) {
    cfg.thinkingConfig = { thinkingBudget: thinkingBudgetMap[req.reasoning_effort] };
  }
  return cfg;
};

const parseImg = async (url) => {
  let mimeType, data;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} (${url})`);
      }
      mimeType = response.headers.get("content-type");
      // 使用 Web 标准 API 将 ArrayBuffer 转换为 Base64
      const ab = await response.arrayBuffer();
      const u8a = new Uint8Array(ab);
      data = btoa(String.fromCharCode.apply(null, u8a));
    } catch (err) {
      throw new Error("Error fetching image: " + err.toString());
    }
  } else {
    const match = url.match(/^data:(?<mimeType>.*?)(;base64)?,(?<data>.*)$/);
    if (!match) {
      throw new HttpError("Invalid image data: " + url, 400);
    }
    ({ mimeType, data } = match.groups);
  }
  return {
    inlineData: {
      mimeType,
      data,
    },
  };
};

const transformFnResponse = ({ content, tool_call_id }, parts) => {
  if (!parts.calls) {
    throw new HttpError("No function calls found in the previous message", 400);
  }
  let response;
  try {
    response = JSON.parse(content);
  } catch (err) {
    console.error("Error parsing function response content:", err);
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
      console.error("Error parsing function arguments:", err);
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

const transformMsg = async ({ content }) => {
  const parts = [];
  if (!Array.isArray(content)) {
    // system, user: string
    // assistant: string or null (Required unless tool_calls is specified.)
    parts.push({ text: content });
    return parts;
  }
  // user:
  // An array of content parts with a defined type.
  // Supported options differ based on the model being used to generate the response.
  // Can contain text, image, or audio inputs.
  for (const item of content) {
    switch (item.type) {
      case "text":
        parts.push({ text: item.text });
        break;
      case "image_url":
        parts.push(await parseImg(item.image_url.url));
        break;
      case "input_audio":
        parts.push({
          inlineData: {
            mimeType: "audio/" + item.input_audio.format,
            data: item.input_audio.data,
          }
        });
        break;
      default:
        throw new HttpError(`Unknown "content" item type: "${item.type}"`, 400);
    }
  }
  if (content.every(item => item.type === "image_url")) {
    parts.push({ text: "" }); // to avoid "Unable to submit request because it must have a text parameter"
  }
  return parts;
};

const transformMessages = async (messages) => {
  if (!messages) { return; }
  const contents = [];
  let system_instruction;
  for (const item of messages) {
    switch (item.role) {
      case "system":
        system_instruction = { parts: await transformMsg(item) };
        continue;
      case "tool":
        // eslint-disable-next-line no-case-declarations
        let { role, parts } = contents[contents.length - 1] ?? {};
        if (role !== "function") {
          const calls = parts?.calls;
          parts = []; parts.calls = calls;
          contents.push({
            role: "function", // ignored
            parts
          });
        }
        transformFnResponse(item, parts);
        continue;
      case "assistant":
        item.role = "model";
        break;
      case "user":
        break;
      default:
        throw new HttpError(`Unknown message role: "${item.role}"`, 400);
    }
    contents.push({
      role: item.role,
      parts: item.tool_calls ? transformFnCalls(item) : await transformMsg(item)
    });
  }
  if (system_instruction) {
    if (!contents[0]?.parts.some(part => part.text)) {
      contents.unshift({ role: "user", parts: { text: " " } });
    }
  }
  //console.info(JSON.stringify(contents, 2));
  return { system_instruction, contents };
};

const transformTools = (req) => {
  let tools, tool_config;
  if (req.tools) {
    const funcs = req.tools.filter(tool => tool.type === "function" && tool.function?.name !== 'googleSearch');
    if (funcs.length > 0) {
      funcs.forEach(adjustSchema);
      tools = [{ function_declarations: funcs.map(schema => schema.function) }];
    }
  }
  if (req.tool_choice) {
    const allowed_function_names = req.tool_choice?.type === "function" ? [ req.tool_choice?.function?.name ] : undefined;
    if (allowed_function_names || typeof req.tool_choice === "string") {
      tool_config = {
        function_calling_config: {
          mode: allowed_function_names ? "ANY" : req.tool_choice.toUpperCase(),
          allowed_function_names
        }
      };
    }
  }
  return { tools, tool_config };
};

const transformRequest = async (req) => ({
  ...await transformMessages(req.messages),
  safetySettings,
  generationConfig: transformConfig(req),
  ...transformTools(req),
});

const reasonsMap = { //https://ai.google.dev/api/rest/v1/GenerateContentResponse#finishreason
  //"FINISH_REASON_UNSPECIFIED": // Default value. This value is unused.
  "STOP": "stop",
  "MAX_TOKENS": "length",
  "SAFETY": "content_filter",
  "RECITATION": "content_filter",
  //"OTHER": "OTHER",
};
const SEP = "\n\n|>";
const transformCandidates = (key, cand) => {
  const message = { role: "assistant", content: [] };
  for (const part of cand.content?.parts ?? []) {
    if (part.functionCall) {
      const fc = part.functionCall;
      message.tool_calls = message.tool_calls ?? [];
      message.tool_calls.push({
        id: fc.id ?? "call_" + generateId(),
        type: "function",
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args),
        }
      });
    } else {
      message.content.push(part.text);
    }
  }
  message.content = message.content.join(SEP) || null;
  return {
    index: cand.index || 0, // 0-index is absent in new -002 models response
    [key]: message,
    logprobs: null,
    finish_reason: message.tool_calls ? "tool_calls" : reasonsMap[cand.finishReason] || cand.finishReason,
    //original_finish_reason: cand.finishReason,
  };
};
const transformCandidatesMessage = transformCandidates.bind(null, "message");
const transformCandidatesDelta = transformCandidates.bind(null, "delta");

const transformUsage = (data) => ({
  completion_tokens: data.candidatesTokenCount,
  prompt_tokens: data.promptTokenCount,
  total_tokens: data.totalTokenCount
});

const checkPromptBlock = (choices, promptFeedback, key) => {
  if (choices.length) { return; }
  if (promptFeedback?.blockReason) {
    console.info("Prompt block reason:", promptFeedback.blockReason);
    if (promptFeedback.blockReason === "SAFETY") {
      promptFeedback.safetyRatings
        .filter(r => r.blocked)
        .forEach(r => console.info(r));
    }
    choices.push({
      index: 0,
      [key]: null,
      finish_reason: "content_filter",
      //original_finish_reason: data.promptFeedback.blockReason,
    });
  }
  return true;
};

const processCompletionsResponse = (data, model, id) => {
  const obj = {
    id,
    choices: data.candidates.map(transformCandidatesMessage),
    created: Math.floor(Date.now()/1000),
    model: data.modelVersion ?? model,
    //system_fingerprint: "fp_69829325d0",
    object: "chat.completion",
    usage: data.usageMetadata && transformUsage(data.usageMetadata),
  };
  if (obj.choices.length === 0 ) {
    checkPromptBlock(obj.choices, data.promptFeedback, "message");
  }
  return JSON.stringify(obj);
};

const responseLineRE = /^data: (.*)(?:\n\n|\r\r|\r\n\r\n)/;
function parseStream (chunk, controller) {
  this.buffer += chunk;
  do {
    const match = this.buffer.match(responseLineRE);
    if (!match) { break; }
    controller.enqueue(match[1]);
    this.buffer = this.buffer.substring(match[0].length);
  } while (true); // eslint-disable-line no-constant-condition
}
function parseStreamFlush (controller) {
  if (this.buffer) {
    console.error("Invalid data:", this.buffer);
    controller.enqueue(this.buffer);
    this.shared.is_buffers_rest = true;
  }
}

const delimiter = "\n\n";
const sseline = (obj) => {
  obj.created = Math.floor(Date.now()/1000);
  return "data: " + JSON.stringify(obj) + delimiter;
};

// 优化流处理函数
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
  
  // ... 保持现有的流处理逻辑 ...
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

// ... existing code for parseImg, transformFnResponse, etc. ...

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

// ... existing code for parseImg, transformFnResponse, etc. ...

// 优化流处理函数
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
  
  // ... 保持现有的流处理逻辑 ...
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

// ... 保持其他现有函数不变 ...
