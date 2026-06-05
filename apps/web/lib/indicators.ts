export interface OHLCV {
  close: number;
  high: number;
  low: number;
  open: number;
  volume: number;
}

export function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

export function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[j];
      result.push(sum / period);
      continue;
    }
    const prev = result[i - 1]!;
    result.push(data[i] * k + prev * (1 - k));
  }
  return result;
}

export interface BollingerResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}

export function bollinger(
  data: number[],
  period = 20,
  stdDev = 2
): BollingerResult {
  const mid = sma(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (mid[i] === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (data[j] - mid[i]!) ** 2;
    }
    const std = Math.sqrt(variance / period);
    upper.push(mid[i]! + stdDev * std);
    lower.push(mid[i]! - stdDev * std);
  }
  return { upper, middle: mid, lower };
}

export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(
  data: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): MACDResult {
  const emaFast = ema(data, fast);
  const emaSlow = ema(data, slow);

  const macdLine: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (emaFast[i] === null || emaSlow[i] === null) {
      macdLine.push(null);
    } else {
      macdLine.push(emaFast[i]! - emaSlow[i]!);
    }
  }

  const validMacd = macdLine.filter((v): v is number => v !== null);
  const signalLine = ema(validMacd, signalPeriod);

  const signal: (number | null)[] = [];
  const histogram: (number | null)[] = [];
  let validIdx = 0;

  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] === null) {
      signal.push(null);
      histogram.push(null);
    } else {
      const s = signalLine[validIdx] ?? null;
      signal.push(s);
      histogram.push(s !== null ? macdLine[i]! - s : null);
      validIdx++;
    }
  }

  return { macd: macdLine, signal, histogram };
}

export interface RSIResult {
  values: (number | null)[];
}

export function rsi(data: number[], period = 14): RSIResult {
  const values: (number | null)[] = [null];

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  for (let i = 0; i < gains.length; i++) {
    if (i < period - 1) {
      values.push(null);
      continue;
    }
    if (i === period - 1) {
      let avgGain = 0,
        avgLoss = 0;
      for (let j = 0; j < period; j++) {
        avgGain += gains[j];
        avgLoss += losses[j];
      }
      avgGain /= period;
      avgLoss /= period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      values.push(100 - 100 / (1 + rs));
      continue;
    }
    const prevRsi = values[values.length - 1];
    if (prevRsi === null) {
      values.push(null);
      continue;
    }
    const prevAvgLoss =
      prevRsi === 100 ? 0 : (100 - prevRsi) / prevRsi * (100 / (100 - prevRsi) - 1) ? 0 : 0;
    let avgGain = 0,
      avgLoss = 0;
    for (let j = i - period + 1; j <= i; j++) {
      avgGain += gains[j];
      avgLoss += losses[j];
    }
    avgGain /= period;
    avgLoss /= period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    values.push(100 - 100 / (1 + rs));
  }

  return { values };
}

// ── VWAP (成交量加權平均價) ────────────────────────────────────────────────────
/**
 * period = 0 時做累積 VWAP（適合盤中分K，整個 session 累積）
 * period > 0 時做滾動 VWAP（適合日K，預設 period=20）
 */
export function vwap(bars: OHLCV[], period = 20): (number | null)[] {
  const result: (number | null)[] = [];
  let cumTPV = 0;
  let cumV = 0;
  for (let i = 0; i < bars.length; i++) {
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    if (period === 0) {
      // 累積模式（分K session VWAP）
      cumTPV += tp * bars[i].volume;
      cumV   += bars[i].volume;
      result.push(cumV > 0 ? cumTPV / cumV : null);
    } else {
      // 滾動模式（日K rolling VWAP）
      const start = Math.max(0, i - period + 1);
      let sumTPV = 0, sumV = 0;
      for (let j = start; j <= i; j++) {
        const tpj = (bars[j].high + bars[j].low + bars[j].close) / 3;
        sumTPV += tpj * bars[j].volume;
        sumV   += bars[j].volume;
      }
      result.push(sumV > 0 ? sumTPV / sumV : null);
    }
  }
  return result;
}

// ── Williams %R ───────────────────────────────────────────────────────────────
export interface WRResult {
  values: (number | null)[];
}

export function wr(bars: OHLCV[], period = 14): WRResult {
  const values: (number | null)[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) { values.push(null); continue; }
    let highest = -Infinity, lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > highest) highest = bars[j].high;
      if (bars[j].low  < lowest)  lowest  = bars[j].low;
    }
    values.push(
      highest === lowest ? -50 : ((highest - bars[i].close) / (highest - lowest)) * -100
    );
  }
  return { values };
}

// ── OBV (能量潮) ──────────────────────────────────────────────────────────────
export interface OBVResult {
  values: number[];
}

export function obv(bars: OHLCV[]): OBVResult {
  const values: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const prev = values[values.length - 1];
    if (bars[i].close > bars[i - 1].close) {
      values.push(prev + bars[i].volume);
    } else if (bars[i].close < bars[i - 1].close) {
      values.push(prev - bars[i].volume);
    } else {
      values.push(prev);
    }
  }
  return { values };
}

export interface KDResult {
  k: (number | null)[];
  d: (number | null)[];
}

export function kd(bars: OHLCV[], kPeriod = 9, dPeriod = 3): KDResult {
  const kValues: (number | null)[] = [];
  const dValues: (number | null)[] = [];

  let prevK = 50;
  let prevD = 50;

  for (let i = 0; i < bars.length; i++) {
    if (i < kPeriod - 1) {
      kValues.push(null);
      dValues.push(null);
      continue;
    }

    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].high > highest) highest = bars[j].high;
      if (bars[j].low < lowest) lowest = bars[j].low;
    }

    const rsv =
      highest === lowest
        ? 50
        : ((bars[i].close - lowest) / (highest - lowest)) * 100;

    const currentK = (2 / 3) * prevK + (1 / 3) * rsv;
    const currentD = (2 / 3) * prevD + (1 / 3) * currentK;

    kValues.push(currentK);
    dValues.push(currentD);
    prevK = currentK;
    prevD = currentD;
  }

  return { k: kValues, d: dValues };
}

// ── ATR (Average True Range) ──────────────────────────────────────────────────
export interface ATRResult {
  values: (number | null)[];
}

export function atr(bars: OHLCV[], period = 14): ATRResult {
  const values: (number | null)[] = [null];
  const trs: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    trs.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low  - bars[i - 1].close),
    ));
  }

  for (let i = 0; i < trs.length; i++) {
    if (i < period - 1) { values.push(null); continue; }
    if (i === period - 1) {
      values.push(trs.slice(0, period).reduce((s, v) => s + v, 0) / period);
      continue;
    }
    values.push(((values[values.length - 1] as number) * (period - 1) + trs[i]) / period);
  }

  return { values };
}

// ── ADX (Average Directional Index) ──────────────────────────────────────────
export interface ADXResult {
  adx:     (number | null)[];
  diPlus:  (number | null)[];
  diMinus: (number | null)[];
}

export function adx(bars: OHLCV[], period = 14): ADXResult {
  const n = bars.length;
  const adxArr:     (number | null)[] = new Array(n).fill(null);
  const diPlusArr:  (number | null)[] = new Array(n).fill(null);
  const diMinusArr: (number | null)[] = new Array(n).fill(null);

  if (n <= period) return { adx: adxArr, diPlus: diPlusArr, diMinus: diMinusArr };

  const dmP: number[] = new Array(n).fill(0);
  const dmM: number[] = new Array(n).fill(0);
  const tr:  number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up   = bars[i].high  - bars[i - 1].high;
    const down = bars[i - 1].low - bars[i].low;
    dmP[i] = (up   > down && up   > 0) ? up   : 0;
    dmM[i] = (down > up   && down > 0) ? down : 0;
    tr[i]  = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low  - bars[i - 1].close),
    );
  }

  // Wilder seed: simple sum of first `period` true range bars (indices 1..period)
  let smTR = 0, smDMP = 0, smDMM = 0;
  for (let i = 1; i <= period; i++) { smTR += tr[i]; smDMP += dmP[i]; smDMM += dmM[i]; }

  const dxArr: (number | null)[] = new Array(n).fill(null);

  const setDI = (i: number) => {
    const dp = smTR > 0 ? 100 * smDMP / smTR : 0;
    const dm = smTR > 0 ? 100 * smDMM / smTR : 0;
    diPlusArr[i]  = dp;
    diMinusArr[i] = dm;
    dxArr[i]      = dp + dm > 0 ? 100 * Math.abs(dp - dm) / (dp + dm) : 0;
  };

  setDI(period);
  for (let i = period + 1; i < n; i++) {
    smTR  = smTR  - smTR  / period + tr[i];
    smDMP = smDMP - smDMP / period + dmP[i];
    smDMM = smDMM - smDMM / period + dmM[i];
    setDI(i);
  }

  // ADX = Wilder smooth of DX; needs `period` valid DX values to seed (starts at 2*period-1)
  const adxSeedEnd = period * 2 - 1;
  if (adxSeedEnd < n) {
    let seed = 0;
    for (let i = period; i <= adxSeedEnd; i++) seed += dxArr[i] as number;
    adxArr[adxSeedEnd] = seed / period;
    for (let i = adxSeedEnd + 1; i < n; i++) {
      if (dxArr[i] === null || adxArr[i - 1] === null) continue;
      adxArr[i] = ((adxArr[i - 1] as number) * (period - 1) + (dxArr[i] as number)) / period;
    }
  }

  return { adx: adxArr, diPlus: diPlusArr, diMinus: diMinusArr };
}

// ── Stochastic RSI ────────────────────────────────────────────────────────────
export interface StochRSIResult {
  k: (number | null)[];
  d: (number | null)[];
}

export function stochRsi(
  data: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): StochRSIResult {
  const n = data.length;
  const kArr: (number | null)[] = new Array(n).fill(null);
  const dArr: (number | null)[] = new Array(n).fill(null);
  const rsiVals = rsi(data, rsiPeriod).values;

  // Raw stochastic of RSI (0–100)
  const stoch: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (rsiVals[i] === null) continue;
    let count = 0, minR = Infinity, maxR = -Infinity;
    for (let j = i; j >= 0 && count < stochPeriod; j--) {
      const rv = rsiVals[j];
      if (rv === null) continue;
      if (rv < minR) minR = rv;
      if (rv > maxR) maxR = rv;
      count++;
    }
    if (count < stochPeriod) continue;
    const cur = rsiVals[i] as number;
    stoch[i] = maxR === minR ? 0 : (cur - minR) / (maxR - minR) * 100;
  }

  // %K = rolling SMA(stoch, kSmooth)
  for (let i = 0; i < n; i++) {
    let count = 0, sum = 0;
    for (let j = i; j >= 0 && count < kSmooth; j--) {
      if (stoch[j] === null) continue;
      sum += stoch[j] as number;
      count++;
    }
    if (count === kSmooth) kArr[i] = sum / kSmooth;
  }

  // %D = rolling SMA(%K, dSmooth)
  for (let i = 0; i < n; i++) {
    let count = 0, sum = 0;
    for (let j = i; j >= 0 && count < dSmooth; j--) {
      if (kArr[j] === null) continue;
      sum += kArr[j] as number;
      count++;
    }
    if (count === dSmooth) dArr[i] = sum / dSmooth;
  }

  return { k: kArr, d: dArr };
}

// ── Ichimoku Cloud (一目均衡表) ───────────────────────────────────────────────
export interface IchimokuResult {
  tenkan:  (number | null)[];
  kijun:   (number | null)[];
  senkouA: (number | null)[];
  senkouB: (number | null)[];
  chikou:  (number | null)[];
}

function periodRange(bars: OHLCV[], i: number, period: number): [number, number] {
  let h = -Infinity, l = Infinity;
  for (let j = i - period + 1; j <= i; j++) {
    if (bars[j].high > h) h = bars[j].high;
    if (bars[j].low  < l) l = bars[j].low;
  }
  return [h, l];
}

export function ichimoku(
  bars: OHLCV[],
  tenkanPeriod = 9,
  kijunPeriod = 26,
  senkouBPeriod = 52,
): IchimokuResult {
  const n = bars.length;
  const tenkan:  (number | null)[] = new Array(n).fill(null);
  const kijun:   (number | null)[] = new Array(n).fill(null);
  const senkouA: (number | null)[] = new Array(n).fill(null);
  const senkouB: (number | null)[] = new Array(n).fill(null);
  const chikou:  (number | null)[] = bars.map(b => b.close);

  for (let i = 0; i < n; i++) {
    if (i >= tenkanPeriod - 1) {
      const [h, l] = periodRange(bars, i, tenkanPeriod);
      tenkan[i] = (h + l) / 2;
    }
    if (i >= kijunPeriod - 1) {
      const [h, l] = periodRange(bars, i, kijunPeriod);
      kijun[i] = (h + l) / 2;
    }
    if (i >= senkouBPeriod - 1) {
      const [h, l] = periodRange(bars, i, senkouBPeriod);
      senkouB[i] = (h + l) / 2;
    }
    if (tenkan[i] !== null && kijun[i] !== null) {
      senkouA[i] = ((tenkan[i] as number) + (kijun[i] as number)) / 2;
    }
  }

  return { tenkan, kijun, senkouA, senkouB, chikou };
}
