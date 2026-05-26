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
