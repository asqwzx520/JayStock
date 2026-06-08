/**
 * 輕量前端 Map 快取
 * 避免 tab 切換時重複呼叫 API，相同 key 在 TTL 內直接回傳快取資料。
 * 無外部依賴，module-level 單例（整個 SPA 生命週期有效）。
 */

interface CacheEntry {
  data: unknown;
  ts:   number;
}

const _cache = new Map<string, CacheEntry>();

/** 取得快取，若不存在或已過期回傳 null */
export function cacheGet<T>(key: string, ttlMs: number): T | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) {
    _cache.delete(key);
    return null;
  }
  return entry.data as T;
}

/** 寫入快取 */
export function cacheSet<T>(key: string, data: T): T {
  _cache.set(key, { data, ts: Date.now() });
  return data;
}

/**
 * 包裝非同步 fetcher，命中快取直接回傳，否則執行 fetch 後寫入快取。
 * @param key    唯一識別鍵，建議格式：`資源類型:參數1:參數2`
 * @param fetcher 原始非同步 fetch 函式
 * @param ttlMs  快取存活毫秒數（預設 5 分鐘）
 */
export function withCache<T>(
  key:     string,
  fetcher: () => Promise<T>,
  ttlMs:   number = 5 * 60_000,
): Promise<T> {
  const hit = cacheGet<T>(key, ttlMs);
  if (hit !== null) return Promise.resolve(hit);
  return fetcher().then(data => cacheSet(key, data));
}

/** 手動清除特定 key（如換股票時可選擇性清除） */
export function cacheDelete(key: string): void {
  _cache.delete(key);
}

/** 清空全部快取 */
export function cacheClear(): void {
  _cache.clear();
}
