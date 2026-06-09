# Tier 雙層快取架構重構計畫

> **狀態**：實作中
> **建立日期**：2026-06-10
> **目標**：一次性解決 9 項 bug + 重構後端資料來源架構，根除 FinMind quota 與 yfinance IP block 問題

---

## 背景：根因分析

### 9 項症狀
1. 儀表板無法載入
2. K 線 API 502 (`/api/v1/kline/2330?period=daily`)
3. K 線放大失效
4. 新聞 tab 無法判斷篩選或功能失敗
5. 回測失敗
6. 大盤 tab 指標不刷新（美股指數）
7. 籌碼 tab「無法載入籌碼資料」＋ 法人動向 API 404 (`/api/v1/market/chips/summary`)
8. 股利 404
9. 年度淨利 = 0

### 兩個根因
1. **FinMind 600 calls/day quota 被 screener 打爆**（254 calls/refresh），導致所有依賴 FinMind 的 endpoint 連環 429/502/404
2. **yfinance Python library 被 Render cloud IP 封鎖** → backtest、儀表板 fallback、美股指數全壞

---

## 解法：Tier 雙層快取架構

### 設計原則
- **後端為快取主體**，前端不直接打外部 API
- **多來源 priority chain**，每種資料各自一套備援順序
- **持久層（Supabase）為主、in-process TTL 為輔、外部 API 為最終保底**

### 架構圖
```
┌──────────────────────────────────────────────────────────────┐
│  Tier 1（深）：~250 檔 = Top 250 by volume                    │
│  • 90 天 K 線 / 60 天籌碼 / 最新財報 / 月營收 / 新聞          │
│  • 每日 daily job 全量更新                                    │
│  • Supabase: kline_daily / chips_daily / financials_quarterly│
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  Tier 2（淺）：全市場 ~1700 檔                                │
│  • 只抓「當日 snapshot」（close / volume / PE / PB / yield）  │
│  • 全部 TWSE bulk endpoint（3 calls/day 覆蓋全市場）          │
│  • Supabase: daily_snapshot                                  │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  Tier 3（lazy backfill）：用戶觸發                             │
│  • 用戶第一次查冷門股 90 天 K → live API → 寫進 Supabase      │
│  • 該股下週日 Top 250 重算時可能升級為 Tier 1                 │
└──────────────────────────────────────────────────────────────┘
```

### Tier 1 universe 來源
- **動態 = 過去 5 個交易日成交量 Top 250**
- 週日凌晨 02:00 重算
- 資料源：Tier 2 STOCK_DAY_ALL（已有，零額外 API 成本）

---

## 主力備援順序（per data type）

| 資料類型 | 1st 主力 | 2nd 備援 | 3rd 保底 |
|---------|---------|---------|---------|
| 日 K 線（台股） | Supabase Tier1 | YF v8/chart 直連 httpx | TWSE STOCK_DAY |
| 日 K 線（美股） | YF v8/chart 直連 httpx | yfinance lib | — |
| 籌碼（三大法人） | Supabase Tier1/2 | TWSE T86 bulk | FinMind |
| 大盤指數（TWII） | TWSE MIS 即時 | YF v8 直連 | yfinance lib |
| 大盤指數（美股） | YF v8 直連 httpx | yfinance lib | — |
| 財報 | Supabase Tier1 | MOPS 直連爬蟲 | FinMind |
| 股利 | yfinance lib | YF v8 直連 + 自算 | TWSE 除息表 |
| 新聞 | Supabase news_cache | 多源即時聚合 | Yahoo RSS only |
| 本益比/殖利率 | TWSE BWIBBU_d bulk | FinMind | — |
| 月營收 | MOPS 自結公告 | FinMind | — |
| 股權分散 | TDCC（週四公告） | — | — |

### 額外採用的免費來源
- **MOPS（公開資訊觀測站）**：財報、月營收、股利、董監持股
- **TDCC（集保結算所）**：股權分散表（替代付費的個股分點資料）
- **TPEx（櫃買中心）**：上櫃股對應資料
- **Finnhub** (`finnhub.io`)：美股新聞、財報，免費 60 req/min
- **鉅亨網 / MoneyDJ RSS**：中文新聞

### 不採用
- ~~Alpha Vantage~~（25 req/day 太少）
- ~~FinMind 付費版~~（每月 NT$1,500）

---

## Phase 0：Supabase Schema

```sql
-- 新增 6 張
CREATE TABLE daily_snapshot (
  date DATE, symbol TEXT, close NUMERIC, volume BIGINT,
  pe_ratio NUMERIC, pb_ratio NUMERIC, dividend_yield NUMERIC,
  PRIMARY KEY (date, symbol)
);

CREATE TABLE financials_quarterly (
  symbol TEXT, year INT, quarter INT,
  revenue NUMERIC, gross_profit NUMERIC, operating_income NUMERIC,
  net_income NUMERIC, eps NUMERIC, equity NUMERIC, total_assets NUMERIC,
  source TEXT, updated_at TIMESTAMPTZ,
  PRIMARY KEY (symbol, year, quarter)
);

CREATE TABLE monthly_revenue (
  symbol TEXT, year INT, month INT,
  revenue NUMERIC, yoy_pct NUMERIC, mom_pct NUMERIC,
  PRIMARY KEY (symbol, year, month)
);

CREATE TABLE news_cache (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT, title TEXT, publisher TEXT, link TEXT UNIQUE,
  published_at TIMESTAMPTZ, importance TEXT, is_chinese BOOLEAN,
  thumbnail TEXT, source TEXT
);
CREATE INDEX ON news_cache (symbol, published_at DESC);

CREATE TABLE tdcc_ownership (
  symbol TEXT, week_date DATE,
  retail_pct NUMERIC,        -- 散戶 (<10張) 比例
  major_pct NUMERIC,         -- 大戶 (>1000張) 比例
  shareholder_count INT,
  major_count INT,
  PRIMARY KEY (symbol, week_date)
);

CREATE TABLE tier1_universe (
  symbol TEXT PRIMARY KEY,
  rank INT, avg_volume_5d BIGINT, updated_at TIMESTAMPTZ
);

CREATE TABLE cache_failures (
  id BIGSERIAL PRIMARY KEY,
  job_name TEXT, target_symbol TEXT, target_date DATE,
  error_msg TEXT, retry_count INT DEFAULT 0,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON cache_failures (resolved, created_at);

-- 擴充既有
ALTER TABLE chips_daily ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'twse_t86';
ALTER TABLE kline_daily ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'yf_direct';
```

---

## Phase 1：Services 改造

### 新增
| 檔案 | 職責 |
|------|------|
| `app/services/twse_service.py` | T86 / STOCK_DAY_ALL / BWIBBU_d / MIS 統一封裝 |
| `app/services/mops_service.py` | 公開資訊觀測站爬蟲（財報 + 月營收） |
| `app/services/tdcc_service.py` | 集保結算所股權分散 |
| `app/services/news_aggregator.py` | Yahoo + 鉅亨 + MoneyDJ + TWSE 重大訊息多源聚合 |
| `app/services/yf_direct.py` | 統一 YF v8/chart httpx 服務 |
| `app/services/finnhub_service.py` | 美股新聞 + 報價（key 預設空白） |

### 改造既有
| 檔案 | 改動 |
|------|------|
| `screener_service.py` | 改讀 Supabase Tier1，零 live API |
| `backtest_service.py` | 改讀 Supabase kline_daily |
| `finmind_service.py` | 降為最終 fallback |
| `market_service.py` | 大盤指數整合 intraday_indices job |

---

## Phase 2：Core utilities

| 檔案 | 內容 |
|------|------|
| `app/core/retry.py` | `with_retry()` exponential backoff + `log_failure()` |
| `app/core/tier1.py` | `get_tier1_symbols()` / `is_tier1(symbol)` |
| `app/core/sources.py` | 統一 priority chain 工廠 |

---

## Phase 3：排程任務（Asia/Taipei）

| 時間 | Job | 內容 | API 來源 | 預估耗時 |
|------|-----|------|---------|---------|
| 14:10 每日 | `daily_chips_full` | T86 全市場 ~1700 檔 | TWSE T86 | 5 秒 |
| 14:35 每日 | `daily_snapshot_full` | 全市場收盤/PE/PB/殖利率 | TWSE bulk | 10 秒 |
| 15:00 每日 | `daily_kline_tier1` | Tier1 ~250 檔 90 天 K | YF 直連 + FinMind | 5 分鐘 |
| 15:30 每日 | `daily_financials_tier1` | Tier1 最新季報 | MOPS + FinMind | 8 分鐘 |
| 15:45 每日 | `daily_news_tier1` | Tier1 多源 RSS | Yahoo/鉅亨/MoneyDJ | 3 分鐘 |
| 週四 17:30 | `weekly_tdcc` | 股權分散 | TDCC POST | 10 分鐘 |
| 週日 02:00 | `weekly_recompute_tier1` | 重算 Top 250 | 讀 Supabase | 2 分鐘 |
| 每月 11 日 09:00 | `monthly_revenue` | 月營收 | MOPS | 5 分鐘 |
| 盤中 每 5 分鐘 | `intraday_indices` | 大盤指數刷新 | TWSE MIS + YF 直連 | 2 秒 |
| 盤中 每 5 分鐘 | `check_price_alerts` | （既有保留） | — | — |

每個 task 開頭先呼叫 `process_pending_failures()` 處理上輪失敗。

---

## Phase 4：API endpoints 改造

| 檔案 | 改動 |
|------|------|
| `api/v1/kline.py` | Supabase → YF 直連 → TWSE → FinMind |
| `api/v1/chips.py` | Supabase → T86 → FinMind |
| `api/v1/market.py` | `chips/summary` 改讀 Supabase |
| `api/v1/financials.py` | Supabase → MOPS → FinMind |
| `api/v1/news.py` | 改讀 `news_cache` |
| `api/v1/ownership.py` ⭐新 | TDCC 股權分散 |
| `api/v1/revenue.py` ⭐新 | 月營收查詢 |

---

## Phase 5：Admin endpoints

`api/v1/admin.py`（用 `ADMIN_TOKEN` env 保護）：
- `POST /admin/backfill?days=90` — 全 Tier1 回補
- `POST /admin/backfill/{symbol}?days=90` — 單檔 (lazy backfill)
- `POST /admin/recompute-tier1` — 手動觸發重算 universe
- `GET  /admin/cache-failures?resolved=false` — 查未解決失敗
- `POST /admin/retry-failures` — 手動觸發 failure retry
- `GET  /admin/schedule-status` — 看各 job 上次跑時間
- `GET  /api/v1/health/ping` — cron-job.org keepalive 用（防 Render Free spin down）

---

## Phase 6：Frontend 修復

| 檔案 | 改動 |
|------|------|
| `components/market/StockNews.tsx` | 新增來源 filter chip |
| `components/chart/KLineChart.tsx` | 修縮放 `handleScale.pinch` 等 |
| `components/chips/ChipsTab.tsx` | 「券商分點」改為「股權分散（TDCC）」 |
| `lib/api.ts` | 新增 `getOwnership()` / `getRevenue()` |

---

## Phase 7：環境變數 + 部署

新增 env：
```
ADMIN_TOKEN=<random>
FINNHUB_API_KEY=<optional, leave blank initially>
ENABLE_MOPS_SCRAPER=true
```

### Render Free tier 注意事項
- **問題**：Free 服務 15 分鐘 idle 自動 spin down，APScheduler 在 sleep 期間不會執行
- **緩解**：用 [cron-job.org](https://cron-job.org)（免費）每 10 分鐘 ping `GET /api/v1/health/ping` 保持 alive
- **長期建議**：升級 Starter ($7/月)

### 冷啟動部署流程
1. Supabase 跑 schema migration
2. Render 加 env vars
3. Push code → 等 deploy
4. `curl -X POST .../admin/backfill?days=90 -H "X-Admin-Token: $TOKEN"`
5. 等 30 分鐘冷啟動完成
6. 驗證 9 個 bug 全修復

---

## ⏱ Commit 拆分

| # | Commit | 內容 |
|---|--------|------|
| 1 | `feat(db): add 7 tables for tier1/2 cache architecture` | Phase 0 |
| 2 | `feat(services): twse/mops/tdcc/news_aggregator/yf_direct/finnhub` | Phase 1 新增 |
| 3 | `feat(core): retry wrapper + tier1 utility + priority chain` | Phase 2 |
| 4 | `feat(tasks): 9 scheduled jobs for full cache coverage` | Phase 3 |
| 5 | `refactor(api): all endpoints supabase-first with fallback chain` | Phase 4 |
| 6 | `feat(api): admin endpoints + health ping` | Phase 5 |
| 7 | `feat(web): news sources / ownership / kline zoom fix` | Phase 6 |
| 8 | `chore: env vars + deploy notes` | Phase 7 |

---

## 風險與緩解

| 風險 | 緩解 |
|------|------|
| MOPS HTML 結構改 | FinMind 接住 + schema 版本檢測 |
| TDCC 反爬蟲 | User-Agent + 間隔 + retry |
| daily job 失敗整批爛 | 每檔獨立 try/except → cache_failures 表 |
| 冷啟動 30 分鐘空資料 | API 回傳 `warming_up` 狀態 |
| Render Free spin down | cron-job.org keepalive |
