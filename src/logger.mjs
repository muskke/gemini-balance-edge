// 添加日志系统
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LOG_LEVEL =
  LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

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