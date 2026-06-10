"""
回測引擎（頂尖版）

技術棧：pandas + numpy + pandas_ta（純 Python，無 C 依賴）
資料來源：yfinance（台股 .TW，美股原代號，免費，最多 20 年日 K）

支援策略：
  ma_cross       — 均線黃金交叉/死亡交叉
  rsi_mean_rev   — RSI 超賣反彈
  macd_signal    — MACD 訊號線黃金叉
  kd_cross       — KD 黃金交叉（低位進、高位出）
  boll_bounce    — 布林通道均值回歸
  custom         — 自訂條件（AND/OR，最多 3 個）

績效指標：總報酬、CAGR、Sharpe、Sortino、Calmar、MaxDD、MaxDD期間、
          勝率、盈虧比、平均持倉天數、對比大盤超額報酬
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd

from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)

# ── 台股交易成本 ──────────────────────────────────────────────────────────────
TW_BUY_COST  = 0.001425   # 0.1425%（手續費）
TW_SELL_COST = 0.001425 + 0.003   # 手續費 + 0.3% 證交稅
US_TRADE_COST = 0.001     # 美股手續費（互動券商約 0.1%）

RISK_FREE_RATE = 0.02     # 年化無風險利率（2%）
TRADING_DAYS   = 252


# ── 歷史 OHLCV 抓取（24h 快取）────────────────────────────────────────────────

def _fetch_ohlcv_httpx(yf_symbol: str, start: str, end: str) -> list[dict]:
    """
    直連 Yahoo Finance v8/chart API（同步 httpx）。
    作為 yfinance 的保底 fallback，不耗 FinMind quota。
    """
    import httpx as _httpx
    from datetime import datetime, timezone, timedelta

    start_dt = datetime.strptime(start, "%Y-%m-%d")
    end_dt   = datetime.strptime(end,   "%Y-%m-%d")
    days     = (end_dt - start_dt).days
    range_str = "2y" if days > 730 else ("1y" if days > 365 else ("6mo" if days > 180 else "3mo"))

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_symbol}"
    params = {"interval": "1d", "range": range_str, "events": ""}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    }
    tz = timezone(timedelta(hours=8))
    try:
        resp = _httpx.get(url, params=params, headers=headers, timeout=20, follow_redirects=True)
        resp.raise_for_status()
        data    = resp.json()
        results = data.get("chart", {}).get("result") or []
        if not results:
            return []
        r          = results[0]
        timestamps = r.get("timestamp") or []
        quote      = (r.get("indicators", {}).get("quote") or [{}])[0]
        opens   = quote.get("open",   [])
        highs   = quote.get("high",   [])
        lows    = quote.get("low",    [])
        closes  = quote.get("close",  [])
        volumes = quote.get("volume", [])
        rows: list[dict] = []
        for i, ts in enumerate(timestamps):
            c = closes[i] if i < len(closes) else None
            if c is None:
                continue
            d = datetime.fromtimestamp(ts, tz=tz).date().isoformat()
            if d < start or d > end:
                continue
            rows.append({
                "date":   d,
                "open":   float(opens[i])   if i < len(opens)   and opens[i]   else float(c),
                "high":   float(highs[i])   if i < len(highs)   and highs[i]   else float(c),
                "low":    float(lows[i])    if i < len(lows)    and lows[i]    else float(c),
                "close":  float(c),
                "volume": int(volumes[i])   if i < len(volumes) and volumes[i] else 0,
            })
        logger.debug("[backtest] httpx fetched %d bars for %s", len(rows), yf_symbol)
        return rows
    except Exception as exc:
        logger.warning("[backtest] httpx fallback %s failed: %s", yf_symbol, exc)
        return []


def _fetch_ohlcv_from_supabase(yf_symbol: str, start: str, end: str) -> list[dict]:
    """從 kline_daily 讀（4 位數台股代號優先；.TW 後綴會 strip）"""
    try:
        from app.core.supabase_client import get_supabase
        db = get_supabase()
        if db is None:
            return []
        # 從 yf_symbol 反推原始 symbol
        bare = yf_symbol.replace(".TW", "").replace(".TWO", "")
        resp = (
            db.table("kline_daily")
            .select("date, open, high, low, close, volume")
            .eq("symbol", bare)
            .gte("date", start)
            .lte("date", end)
            .order("date")
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return []
        return [
            {
                "date":   r["date"],
                "open":   float(r["open"])  if r.get("open")  is not None else 0.0,
                "high":   float(r["high"])  if r.get("high")  is not None else 0.0,
                "low":    float(r["low"])   if r.get("low")   is not None else 0.0,
                "close":  float(r["close"]) if r.get("close") is not None else 0.0,
                "volume": int(r["volume"] or 0),
            }
            for r in rows
        ]
    except Exception as e:
        logger.debug("[backtest] supabase read %s failed: %s", yf_symbol, e)
        return []


@ttl_cache(ttl=86_400)
def _fetch_ohlcv_sync(yf_symbol: str, start: str, end: str) -> list[dict]:
    """
    OHLCV 多源 fallback：
    1. Supabase kline_daily（Tier 1 寫入）
    2. httpx 直連 YF v8/chart
    3. yfinance lib
    """
    # 1. Supabase
    rows = _fetch_ohlcv_from_supabase(yf_symbol, start, end)
    if rows:
        return rows

    # 2. httpx 直連 YF（在 Render 上比 yfinance lib 穩）
    rows = _fetch_ohlcv_httpx(yf_symbol, start, end)
    if rows:
        return rows

    # 3. yfinance lib 保底（本地開發環境通常 OK）
    try:
        import yfinance as yf
        df = yf.download(
            yf_symbol, start=start, end=end,
            auto_adjust=True, progress=False, threads=False,
        )
        if not df.empty:
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df.index = pd.to_datetime(df.index)
            df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
            df.columns = ["open", "high", "low", "close", "volume"]
            return [
                {"date": idx.strftime("%Y-%m-%d"), **row.to_dict()}
                for idx, row in df.iterrows()
            ]
    except Exception as exc:
        logger.warning("[backtest] yfinance %s failed: %s", yf_symbol, exc)

    return []


def _to_df(records: list[dict]) -> pd.DataFrame:
    if not records:
        return pd.DataFrame()
    df = pd.DataFrame(records)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.dropna()


def _yf_symbol(symbol: str) -> str:
    """台股（純數字）補 .TW；美股直接回傳"""
    s = symbol.upper().strip()
    if s.isdigit():
        return f"{s}.TW"
    if s.endswith(".TW") or s.endswith(".TWO"):
        return s
    return s


# ── 指標計算（pandas_ta）──────────────────────────────────────────────────────

def _add_indicators(df: pd.DataFrame, strategy: dict) -> pd.DataFrame:
    """在 df 上計算策略所需指標，回傳同一 df（已加欄位）"""
    import pandas_ta as ta  # noqa: F401 – used via df.ta accessor

    stype = strategy.get("type", "")

    if stype == "ma_cross":
        fast = int(strategy.get("fast", 5))
        slow = int(strategy.get("slow", 20))
        df[f"ma_fast"] = df["close"].rolling(fast).mean()
        df[f"ma_slow"] = df["close"].rolling(slow).mean()

    elif stype == "rsi_mean_rev":
        period = int(strategy.get("period", 14))
        df["rsi"] = df.ta.rsi(length=period)

    elif stype == "macd_signal":
        fast  = int(strategy.get("fast",   12))
        slow  = int(strategy.get("slow",   26))
        sig   = int(strategy.get("signal",  9))
        macd_df = df.ta.macd(fast=fast, slow=slow, signal=sig)
        if macd_df is not None and not macd_df.empty:
            df["macd"]   = macd_df.iloc[:, 0]
            df["macd_s"] = macd_df.iloc[:, 2]

    elif stype == "kd_cross":
        k_period = int(strategy.get("k_period",  9))
        d_period = int(strategy.get("d_period",  3))
        stoch = df.ta.stoch(k=k_period, d=d_period)
        if stoch is not None and not stoch.empty:
            df["k"] = stoch.iloc[:, 0]
            df["d"] = stoch.iloc[:, 1]

    elif stype == "boll_bounce":
        period = int(strategy.get("period", 20))
        std    = float(strategy.get("std",    2.0))
        bb = df.ta.bbands(length=period, std=std)
        if bb is not None and not bb.empty:
            df["bb_upper"] = bb.iloc[:, 2]
            df["bb_lower"] = bb.iloc[:, 0]

    elif stype == "custom":
        # 計算全部指標，讓自訂條件可以引用
        for p in [5, 10, 20, 60]:
            df[f"ma{p}"] = df["close"].rolling(p).mean()
        df["ema12"] = df.ta.ema(length=12)
        df["rsi14"] = df.ta.rsi(length=14)
        macd_df = df.ta.macd(fast=12, slow=26, signal=9)
        if macd_df is not None and not macd_df.empty:
            df["macd"]   = macd_df.iloc[:, 0]
            df["macd_s"] = macd_df.iloc[:, 2]
        stoch = df.ta.stoch(k=9, d=3)
        if stoch is not None and not stoch.empty:
            df["k"] = stoch.iloc[:, 0]
            df["d"] = stoch.iloc[:, 1]

    return df


# ── 訊號生成 ──────────────────────────────────────────────────────────────────

def _gen_signals(df: pd.DataFrame, strategy: dict) -> pd.Series:
    """
    回傳 Series（同 df.index），值為：
      +1 → 進場（買）
      -1 → 出場（賣）
       0 → 持平
    """
    sig = pd.Series(0, index=df.index, dtype=int)
    stype = strategy.get("type", "")

    if stype == "ma_cross":
        if "ma_fast" not in df or "ma_slow" not in df:
            return sig
        cross_up   = (df["ma_fast"] > df["ma_slow"]) & (df["ma_fast"].shift(1) <= df["ma_slow"].shift(1))
        cross_down = (df["ma_fast"] < df["ma_slow"]) & (df["ma_fast"].shift(1) >= df["ma_slow"].shift(1))
        sig[cross_up]   =  1
        sig[cross_down] = -1

    elif stype == "rsi_mean_rev":
        if "rsi" not in df:
            return sig
        oversold  = int(strategy.get("oversold",  30))
        overbought = int(strategy.get("overbought", 70))
        buy  = (df["rsi"] < oversold)  & (df["rsi"].shift(1) >= oversold)
        sell = (df["rsi"] > overbought) & (df["rsi"].shift(1) <= overbought)
        sig[buy]  =  1
        sig[sell] = -1

    elif stype == "macd_signal":
        if "macd" not in df or "macd_s" not in df:
            return sig
        cross_up   = (df["macd"] > df["macd_s"]) & (df["macd"].shift(1) <= df["macd_s"].shift(1))
        cross_down = (df["macd"] < df["macd_s"]) & (df["macd"].shift(1) >= df["macd_s"].shift(1))
        sig[cross_up]   =  1
        sig[cross_down] = -1

    elif stype == "kd_cross":
        if "k" not in df or "d" not in df:
            return sig
        low_zone  = int(strategy.get("buy_zone",  25))
        high_zone = int(strategy.get("sell_zone", 75))
        buy  = (df["k"] > df["d"]) & (df["k"].shift(1) <= df["d"].shift(1)) & (df["k"] < low_zone)
        sell = (df["k"] < df["d"]) & (df["k"].shift(1) >= df["d"].shift(1)) & (df["k"] > high_zone)
        sig[buy]  =  1
        sig[sell] = -1

    elif stype == "boll_bounce":
        if "bb_upper" not in df or "bb_lower" not in df:
            return sig
        buy  = df["close"] <= df["bb_lower"]
        sell = df["close"] >= df["bb_upper"]
        # 只取邊緣（False→True 觸發）
        sig[buy  & ~buy.shift(1).fillna(False)]  =  1
        sig[sell & ~sell.shift(1).fillna(False)] = -1

    elif stype == "custom":
        entry_conds = strategy.get("entry_conditions", [])
        exit_conds  = strategy.get("exit_conditions",  [])
        logic       = strategy.get("logic", "AND")

        buy_mask  = _eval_conditions(df, entry_conds, logic)
        sell_mask = _eval_conditions(df, exit_conds,  logic)
        # 只取從 False→True 的第一天
        sig[buy_mask  & ~buy_mask.shift(1).fillna(False)]  =  1
        sig[sell_mask & ~sell_mask.shift(1).fillna(False)] = -1

    return sig


def _eval_conditions(
    df: pd.DataFrame,
    conditions: list[dict],
    logic: str = "AND",
) -> pd.Series:
    """評估自訂條件列表，回傳 bool Series"""
    if not conditions:
        return pd.Series(False, index=df.index)

    masks = []
    FIELD_MAP = {
        "close": "close", "open": "open", "high": "high", "low": "low",
        "volume": "volume",
        "ma5": "ma5", "ma10": "ma10", "ma20": "ma20", "ma60": "ma60",
        "ema12": "ema12",
        "rsi14": "rsi14",
        "macd": "macd", "macd_signal": "macd_s",
        "k": "k", "d": "d",
    }
    OPS = {
        ">": lambda a, b: a > b,
        "<": lambda a, b: a < b,
        ">=": lambda a, b: a >= b,
        "<=": lambda a, b: a <= b,
        "==": lambda a, b: a == b,
        "cross_above": lambda a, b: (a > b) & (a.shift(1) <= b.shift(1)),
        "cross_below": lambda a, b: (a < b) & (a.shift(1) >= b.shift(1)),
    }

    for cond in conditions[:3]:   # max 3 conditions
        field = FIELD_MAP.get(cond.get("field", ""), "")
        op    = cond.get("op", ">")
        value = cond.get("value")   # numeric or field name
        if not field or field not in df.columns:
            continue
        a = df[field]
        # value can be a number or another field name
        if isinstance(value, str) and value in FIELD_MAP and FIELD_MAP[value] in df.columns:
            b = df[FIELD_MAP[value]]
        else:
            try:
                b = float(value)
            except (TypeError, ValueError):
                continue
        fn = OPS.get(op)
        if fn is None:
            continue
        mask = fn(a, b)
        masks.append(mask.fillna(False))

    if not masks:
        return pd.Series(False, index=df.index)

    result = masks[0]
    for m in masks[1:]:
        result = (result & m) if logic == "AND" else (result | m)
    return result


# ── 向量化投資組合模擬 ─────────────────────────────────────────────────────────

def _is_tw_symbol(symbol: str) -> bool:
    s = symbol.upper().strip()
    return s.isdigit() or s.endswith(".TW") or s.endswith(".TWO")


def _run_portfolio(
    df: pd.DataFrame,
    signals: pd.Series,
    initial_capital: float,
    symbol: str,
    stop_loss_pct: float | None,
    take_profit_pct: float | None,
) -> tuple[pd.DataFrame, list[dict]]:
    """
    向量化（偽）投資組合模擬。
    採用全倉策略：有資金就全買，有持倉就全賣。
    以收盤價成交（次日開盤亦可，但收盤更保守）。

    回傳：
      equity_df — columns: equity, drawdown_pct
      trades    — list of trade dicts
    """
    is_tw   = _is_tw_symbol(symbol)
    buy_cost  = TW_BUY_COST  if is_tw else US_TRADE_COST
    sell_cost = TW_SELL_COST if is_tw else US_TRADE_COST

    cash     = initial_capital
    position = 0.0          # 股數（允許小數，模擬整股可用 math.floor）
    entry_price  = 0.0
    entry_date   = None
    entry_cost   = 0.0       # 進場時的買入手續費（元）

    equity_list: list[tuple] = []
    trades: list[dict]        = []

    def _close_position(date, price, reason: str):
        """結算一筆交易並寫入 trades；回傳新的 cash 餘額"""
        nonlocal position, entry_price, entry_date, entry_cost
        proceeds  = position * price * (1 - sell_cost)
        gross_buy = position * entry_price
        pnl       = proceeds - gross_buy - entry_cost
        pnl_pct   = (price * (1 - sell_cost) - entry_price * (1 + buy_cost)) / (entry_price * (1 + buy_cost))
        hold_days = (date - entry_date).days if entry_date else 0
        sell_fee  = position * price * sell_cost
        total_fee = entry_cost + sell_fee
        trades.append({
            "entry_date":   entry_date.strftime("%Y-%m-%d") if entry_date else "",
            "exit_date":    date.strftime("%Y-%m-%d"),
            "entry_price":  round(entry_price, 2),
            "exit_price":   round(price, 2),
            "shares":       round(position, 4),
            "pnl":          round(pnl, 2),
            "pnl_pct":      round(pnl_pct, 6),
            "hold_days":    hold_days,
            "side":         "long",
            "fee":          round(total_fee, 2),
            "exit_reason":  reason,
        })
        new_cash = proceeds
        position = 0.0
        entry_price = 0.0
        entry_date  = None
        entry_cost  = 0.0
        return new_cash

    for date, row in df.iterrows():
        price = float(row["close"])
        if price <= 0 or math.isnan(price):
            equity_list.append((date, cash if position == 0 else cash + position * price))
            continue

        sig = int(signals.get(date, 0))
        exit_reason = "signal"

        # ── 停損/停利 ──
        if position > 0 and entry_price > 0:
            chg = (price - entry_price) / entry_price
            if stop_loss_pct  is not None and chg <= -abs(stop_loss_pct):
                sig = -1
                exit_reason = "stop_loss"
            elif take_profit_pct is not None and chg >= abs(take_profit_pct):
                sig = -1
                exit_reason = "take_profit"

        # ── 買入 ──
        if sig == 1 and position == 0 and cash > 0:
            cost     = price * (1 + buy_cost)
            shares   = cash / cost
            position = shares
            entry_cost  = shares * price * buy_cost
            cash     = 0.0
            entry_price = price
            entry_date  = date

        # ── 賣出 ──
        elif sig == -1 and position > 0:
            cash = _close_position(date, price, exit_reason)

        equity = cash + position * price
        equity_list.append((date, equity))

    # ── 期末強平：若回測結束時仍有持倉，以最後收盤價結算 ──
    if position > 0 and len(df) > 0:
        last_date  = df.index[-1]
        last_price = float(df.iloc[-1]["close"])
        if last_price > 0 and not math.isnan(last_price):
            cash = _close_position(last_date, last_price, "end_of_period")

    equity_series = pd.Series({d: e for d, e in equity_list}, name="equity")
    equity_series = equity_series.sort_index()

    # Drawdown
    rolling_max = equity_series.expanding().max()
    drawdown    = (equity_series - rolling_max) / rolling_max

    equity_df = pd.DataFrame({
        "equity":       equity_series,
        "drawdown_pct": drawdown,
    })
    return equity_df, trades


# ── 績效統計計算 ───────────────────────────────────────────────────────────────

def _calc_stats(
    equity_df: pd.DataFrame,
    trades: list[dict],
    benchmark_df: pd.DataFrame | None,
    initial_capital: float,
) -> dict[str, Any]:
    equity = equity_df["equity"]
    if equity.empty or len(equity) < 2:
        return {}

    # ── 基本報酬 ──
    final      = float(equity.iloc[-1])
    total_ret  = (final - initial_capital) / initial_capital
    years      = (equity.index[-1] - equity.index[0]).days / 365.25
    cagr       = ((final / initial_capital) ** (1 / max(years, 0.01))) - 1 if years > 0 else 0.0

    # ── Daily returns ──
    daily_ret = equity.pct_change().dropna()

    # ── Sharpe ──
    rf_daily  = RISK_FREE_RATE / TRADING_DAYS
    excess    = daily_ret - rf_daily
    sharpe    = (excess.mean() / excess.std() * math.sqrt(TRADING_DAYS)) if excess.std() > 0 else 0.0

    # ── Sortino ──
    downside = daily_ret[daily_ret < rf_daily]
    sortino  = (excess.mean() / downside.std() * math.sqrt(TRADING_DAYS)) if len(downside) > 0 and downside.std() > 0 else 0.0

    # ── Max Drawdown ──
    rolling_max   = equity.expanding().max()
    drawdown      = (equity - rolling_max) / rolling_max
    max_dd        = float(drawdown.min())
    calmar        = cagr / abs(max_dd) if abs(max_dd) > 1e-9 else 0.0

    # 最大回撤持續天數
    in_dd       = drawdown < 0
    dd_groups   = (in_dd != in_dd.shift()).cumsum()
    max_dd_days = 0
    for _, grp in in_dd.groupby(dd_groups):
        if grp.all() and len(grp) > max_dd_days:
            max_dd_days = len(grp)

    # ── Trade stats ──
    win_rate    = 0.0
    profit_factor = 0.0
    avg_hold    = 0.0
    best_trade  = 0.0
    worst_trade = 0.0
    if trades:
        pnl_list = [t["pnl_pct"] for t in trades]
        wins  = [p for p in pnl_list if p > 0]
        losses = [p for p in pnl_list if p <= 0]
        win_rate = len(wins) / len(pnl_list)
        profit_factor = (sum(wins) / abs(sum(losses))) if losses else float("inf")
        avg_hold  = sum(t["hold_days"] for t in trades) / len(trades)
        best_trade  = max(pnl_list)
        worst_trade = min(pnl_list)

    # ── Benchmark ──
    benchmark_cagr = 0.0
    alpha          = cagr
    if benchmark_df is not None and not benchmark_df.empty:
        bm = benchmark_df["close"]
        bm = bm.reindex(equity.index, method="ffill").dropna()
        if len(bm) >= 2:
            bm_ret = (float(bm.iloc[-1]) - float(bm.iloc[0])) / float(bm.iloc[0])
            bm_yrs = (bm.index[-1] - bm.index[0]).days / 365.25
            benchmark_cagr = ((1 + bm_ret) ** (1 / max(bm_yrs, 0.01))) - 1 if bm_yrs > 0 else 0.0
            alpha = cagr - benchmark_cagr

    return {
        "total_return":    round(total_ret,    4),
        "cagr":            round(cagr,         4),
        "sharpe":          round(sharpe,        3),
        "sortino":         round(sortino,       3),
        "calmar":          round(calmar,        3),
        "max_drawdown":    round(max_dd,        4),
        "max_dd_days":     max_dd_days,
        "win_rate":        round(win_rate,      4),
        "profit_factor":   round(min(profit_factor, 99.0), 3),
        "avg_hold_days":   round(avg_hold,      1),
        "total_trades":    len(trades),
        "best_trade":      round(best_trade,    4),
        "worst_trade":     round(worst_trade,   4),
        "benchmark_cagr":  round(benchmark_cagr, 4),
        "alpha":           round(alpha,          4),
        "final_equity":    round(final, 2),
    }


def _build_monthly_returns(equity_df: pd.DataFrame) -> list[dict]:
    """計算月度報酬率（用於熱力圖）"""
    eq = equity_df["equity"].copy()
    monthly = eq.resample("ME").last()
    monthly_ret = monthly.pct_change().dropna()
    result = []
    for dt, ret in monthly_ret.items():
        result.append({
            "year":       int(dt.year),
            "month":      int(dt.month),
            "return_pct": round(float(ret), 4),
        })
    return result


# ── 台股資料抓取（FinMind，比 yfinance 穩定）──────────────────────────────────

async def _fetch_tw_ohlcv(symbol: str, start: str, end: str) -> list[dict]:
    """
    台股 OHLCV — 優先走 FinMind（與 K 線圖同源），失敗才 fallback yfinance。
    避免 Render 等雲端 IP 被 Yahoo Finance 封鎖。
    """
    from datetime import date as _date
    from app.services.finmind_service import fetch_daily_kline  # noqa: PLC0415

    try:
        rows = await fetch_daily_kline(
            symbol,
            _date.fromisoformat(start),
            _date.fromisoformat(end),
        )
        if rows:
            return rows
    except Exception as exc:
        logger.warning("[backtest] FinMind fetch 失敗，fallback yfinance: %s", exc)

    # Fallback：yfinance（本機開發時通常可用）
    import asyncio
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, _fetch_ohlcv_sync, f"{symbol}.TW", start, end
    )


# ── 主入口 ────────────────────────────────────────────────────────────────────

async def run_backtest(
    symbol: str,
    strategy: dict,
    start_date: str,
    end_date: str,
    initial_capital: float = 1_000_000.0,
    stop_loss_pct: float | None = None,
    take_profit_pct: float | None = None,
) -> dict:
    """
    執行完整回測並回傳結果。

    回傳結構：
    {
      stats: dict,
      equity_curve: [{time, value, drawdown}],
      benchmark_curve: [{time, value}],
      trades: [trade_dict],
      monthly_returns: [{year, month, return_pct}],
    }
    """
    import asyncio

    yf_sym = _yf_symbol(symbol)
    is_tw  = _is_tw_symbol(symbol)

    # ── 資料抓取：台股用 FinMind，美股用 yfinance ──
    if is_tw:
        raw, raw_bench = await asyncio.gather(
            _fetch_tw_ohlcv(symbol,  start_date, end_date),
            _fetch_tw_ohlcv("0050",  start_date, end_date),
        )
    else:
        loop = asyncio.get_running_loop()
        raw, raw_bench = await asyncio.gather(
            loop.run_in_executor(None, _fetch_ohlcv_sync, yf_sym, start_date, end_date),
            loop.run_in_executor(None, _fetch_ohlcv_sync, "SPY",  start_date, end_date),
        )

    if not raw:
        raise ValueError(f"無法取得 {symbol} 的歷史資料，請確認代號正確。")

    df        = _to_df(raw)
    bench_df  = _to_df(raw_bench) if raw_bench else None

    if len(df) < 50:
        raise ValueError(f"{symbol} 資料筆數不足（{len(df)} 筆），請擴大日期範圍。")

    # 加入指標
    df = _add_indicators(df, strategy)
    df = df.dropna()

    if len(df) < 10:
        raise ValueError("指標計算後資料不足，請確認策略參數與日期範圍。")

    # 生成訊號
    signals = _gen_signals(df, strategy)

    # 執行模擬
    equity_df, trades = _run_portfolio(
        df, signals, initial_capital, symbol,
        stop_loss_pct, take_profit_pct,
    )

    # 計算績效
    stats = _calc_stats(equity_df, trades, bench_df, initial_capital)

    # 資金曲線（輕量化：最多 1000 點）
    step = max(1, len(equity_df) // 1000)
    eq_sampled = equity_df.iloc[::step]
    equity_curve = [
        {
            "time":     idx.strftime("%Y-%m-%d"),
            "value":    round(float(row["equity"]), 2),
            "drawdown": round(float(row["drawdown_pct"]), 4),
        }
        for idx, row in eq_sampled.iterrows()
    ]

    # 基準曲線
    benchmark_curve: list[dict] = []
    if bench_df is not None and not bench_df.empty:
        bm = bench_df["close"].reindex(equity_df.index, method="ffill").dropna()
        bm_init = float(bm.iloc[0]) if len(bm) > 0 else 1.0
        bm_norm = bm / bm_init * initial_capital
        bm_sampled = bm_norm.iloc[::step]
        benchmark_curve = [
            {"time": idx.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
            for idx, v in bm_sampled.items()
        ]

    monthly_returns = _build_monthly_returns(equity_df)

    logger.info(
        "[backtest] %s %s %s~%s trades=%d sharpe=%.2f",
        symbol, strategy.get("type"), start_date, end_date,
        len(trades), stats.get("sharpe", 0),
    )

    return {
        "stats":           stats,
        "equity_curve":    equity_curve,
        "benchmark_curve": benchmark_curve,
        "trades":          trades,
        "monthly_returns": monthly_returns,
    }
