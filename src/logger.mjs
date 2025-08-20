/**
 * 日志系统与敏感头脱敏工具
 */
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LOG_LEVEL =
  LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "x-goog-api-key",
  "cookie",
  "set-cookie",
]);

/**
 * 对请求/响应头进行脱敏
 * @param {Headers|Record<string,string>} input
 * @returns {Record<string,string>}
 */
export function redactHeaders(input) {
  try {
    const obj =
      input instanceof Headers
        ? Object.fromEntries(input.entries())
        : { ...input };
    for (const k of Object.keys(obj)) {
      if (SENSITIVE_HEADER_KEYS.has(k.toLowerCase())) {
        const v = String(obj[k] ?? "");
        obj[k] =
          v.length <= 8 ? "***" : `${v.slice(0, 4)}...REDACTED...${v.slice(-4)}`;
      }
    }
    return obj;
  } catch {
    return {};
  }
}

export const logger = {
  error: (msg, ...args) =>
    LOG_LEVEL >= LOG_LEVELS.ERROR && console.error(`[ERROR] ${msg}`, ...args),
  warn: (msg, ...args) =>
    LOG_LEVEL >= LOG_LEVELS.WARN && console.warn(`[WARN] ${msg}`, ...args),
  info: (msg, ...args) =>
    LOG_LEVEL >= LOG_LEVELS.INFO && console.info(`[INFO] ${msg}`, ...args),
  debug: (msg, ...args) =>
    LOG_LEVEL >= LOG_LEVELS.DEBUG && console.debug(`[DEBUG] ${msg}`, ...args),
};
