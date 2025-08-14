let keyIndex = 0;

/**
 * 从 API Key 列表中选择一个 Key。
 * 采用轮询（Round-Robin）策略来确保均匀使用。
 * @param {string[]} apiKeys - API Key 列表。
 * @returns {string|null} - 返回选中的 API Key，如果没有可用的 Key 则返回 null。
 */
export function selectApiKey(apiKeys) {
  if (!apiKeys || apiKeys.length === 0) {
    return null;
  }

  // 使用轮询策略选择 key
  const selectedKey = apiKeys[keyIndex];
  
  // 更新索引以便下次调用
  keyIndex = (keyIndex + 1) % apiKeys.length;
  
  return selectedKey;
}