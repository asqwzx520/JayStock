// ── 指標參數型別定義 + localStorage 持久化 ────────────────────────────────────

export interface IndicatorParams {
  MA:        number[];                                         // e.g. [5, 10, 20, 60]
  EMA:       number[];                                         // e.g. [12, 26]
  BOLL:      { period: number; std: number };                  // 20, 2
  MACD:      { fast: number; slow: number; signal: number };   // 12, 26, 9
  RSI:       { period: number };                               // 14
  KD:        { period: number };                               // 9
  VWAP:      { period: number };                               // 20
  VWAP_BAND: { period: number };                               // 20
  WR:        { period: number };                               // 14
  OBV:       { period: number };                               // (無參數，保留 0)
  ATR:       { period: number };                               // 14
  ADX:       { period: number };                               // 14
  SRSI:      { period: number };                               // 14
}

export const DEFAULT_PARAMS: IndicatorParams = {
  MA:        [5, 10, 20, 60],
  EMA:       [12, 26],
  BOLL:      { period: 20, std: 2 },
  MACD:      { fast: 12, slow: 26, signal: 9 },
  RSI:       { period: 14 },
  KD:        { period: 9 },
  VWAP:      { period: 20 },
  VWAP_BAND: { period: 20 },
  WR:        { period: 14 },
  OBV:       { period: 0 },
  ATR:       { period: 14 },
  ADX:       { period: 14 },
  SRSI:      { period: 14 },
};

const LS_KEY = "stockpulse_indicator_params_v1";

export function loadParams(): IndicatorParams {
  if (typeof window === "undefined") return DEFAULT_PARAMS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PARAMS;
    // 深度合併，確保新增的 key 有預設值
    const saved = JSON.parse(raw) as Partial<IndicatorParams>;
    return { ...DEFAULT_PARAMS, ...saved };
  } catch {
    return DEFAULT_PARAMS;
  }
}

export function saveParams(p: IndicatorParams): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {}
}
