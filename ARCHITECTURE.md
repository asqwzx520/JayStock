# ARCHITECTURE.md — 頂尖股票分析平台系統架構

> **版本：** v0.1  
> **日期：** 2026-05-26  
> **配套文件：** [PRD.md](PRD.md)

---

## 1. 架構總覽

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│   Browser（Next.js SSR/CSR）  ｜  PWA Mobile                   │
└───────────────────┬─────────────────────────────────────────────┘
                    │ HTTPS / WSS
┌───────────────────▼─────────────────────────────────────────────┐
│                      EDGE / CDN LAYER                           │
│              Cloudflare（Static Assets + DDoS）                 │
└───────────────────┬─────────────────────────────────────────────┘
                    │
        ┌───────────┴────────────┐
        │                        │
┌───────▼──────┐        ┌────────▼──────────┐
│  Next.js     │        │  FastAPI           │
│  App Server  │        │  API Server        │
│  (Vercel)    │        │  (Railway/Render)  │
└───────┬──────┘        └────────┬──────────┘
        │                        │
        │               ┌────────┼────────────┐
        │               │        │            │
        │        ┌──────▼──┐ ┌───▼───┐ ┌─────▼────┐
        │        │PostgreSQL│ │ Redis │ │Meilisearch│
        │        │  (DB)    │ │(Cache)│ │ (Search) │
        │        └──────────┘ └───────┘ └──────────┘
        │
┌───────▼──────────────────────────────────────┐
│              EXTERNAL DATA SOURCES            │
│  TWSE OpenAPI ｜ FinMind ｜ Polygon.io         │
│  Claude API ｜ Finnhub ｜ Yahoo Finance        │
└──────────────────────────────────────────────┘
```

---

## 2. Frontend 架構（Next.js 15）

### 2.1 目錄結構

```
/app
  /(workspace)           # 主工作區（受保護路由）
    /[symbol]            # 個股頁 /TSMC → /2330
    /screener            # AI 選股器
    /market              # 市場總覽儀錶板
    /watchlist           # 自選股管理
  /(auth)                # 登入 / 註冊
  /api                   # Next.js Route Handlers（BFF 層）
    /auth                # NextAuth.js
    /proxy               # 後端 API Proxy（避免 CORS + 隱藏後端 URL）

/components
  /chart                 # TradingView Lightweight Charts 封裝
    ChartContainer.tsx
    IndicatorOverlay.tsx
    ChipOverlay.tsx      # 三大法人疊圖
  /layout
    LeftPanel.tsx
    CenterPanel.tsx
    RightPanel.tsx
    Header.tsx
  /watchlist
    WatchlistGroup.tsx
    WatchlistRow.tsx
  /screener
    ScreenerForm.tsx
    StrategyTemplate.tsx
    ResultTable.tsx
  /ui                    # 基礎元件（shadcn/ui + 自訂）

/lib
  /store                 # Zustand stores
    useMarketStore.ts    # 大盤即時資料
    useChartStore.ts     # 圖表狀態（symbol、timeframe、indicators）
    useWatchlistStore.ts
    useScreenerStore.ts
  /hooks
    useWebSocket.ts      # 行情 WebSocket 訂閱
    useQuote.ts
    useKline.ts
  /api-client            # 型別化 API 呼叫函數
  /utils
    formatters.ts        # 數字、百分比、日期格式化
    indicators.ts        # 客戶端指標計算（補充後端）
```

### 2.2 資料流架構

```
WebSocket (行情 push)
    │
    ▼
useWebSocket hook
    │
    ▼
Zustand Market Store ──► React UI (自動重渲染)
                                │
                                ▼
                    TradingView Lightweight Charts
                    （透過 updateData() API 即時更新）
```

### 2.3 K 線圖元件設計

```typescript
// 核心抽象層：ChartContainer
interface ChartConfig {
  symbol: string;
  timeframe: '1m' | '5m' | '15m' | '30m' | '60m' | '1d' | '1w' | '1M';
  indicators: IndicatorConfig[];
  chipOverlay: boolean;  // 是否疊加法人籌碼
  layout: 'single' | 'dual' | 'quad';
}

// 指標疊圖支援列表
type IndicatorType =
  | 'MA' | 'EMA' | 'BOLL' | 'VWAP' | 'ICHIMOKU'
  | 'MACD' | 'RSI' | 'KD' | 'OBV' | 'WILLIAMR';
```

---

## 3. Backend 架構（FastAPI）

### 3.1 目錄結構

```
/app
  /api
    /v1
      /quotes.py         # 即時報價端點
      /kline.py          # K 線歷史資料
      /chips.py          # 三大法人籌碼
      /screener.py       # 選股器（含 AI 解析）
      /watchlist.py      # 自選股 CRUD
      /users.py          # 用戶帳號
      /market.py         # 大盤指數、廣度
  /websocket
    /quote_ws.py         # 行情 WebSocket handler
  /services
    /data_fetcher.py     # 外部 API 抓取（TWSE 即時 / FinMind / yfinance）
    /ai_service.py       # Gemini API 整合
    /chip_analyzer.py    # 籌碼分析計算邏輯
    /screener_engine.py  # 選股條件執行引擎
    /backtest.py         # 輕量回測引擎
  /models
    /database.py         # SQLAlchemy 模型
    /schemas.py          # Pydantic 請求/回應 Schema
  /tasks
    /scheduler.py        # APScheduler 排程任務
    /daily_chip.py       # 每日法人資料抓取 Job
    /daily_kline.py      # 每日 K 線更新 Job
  /core
    /config.py           # 環境變數管理
    /security.py         # JWT / API Key 驗證
    /rate_limiter.py     # Redis Rate Limiting
```

### 3.2 API 端點設計

```
GET  /api/v1/quotes/{symbol}              # 個股即時報價
GET  /api/v1/kline/{symbol}?tf=1d&n=500  # K 線資料（最多 2000 根）
GET  /api/v1/chips/{symbol}?days=30      # 三大法人籌碼
GET  /api/v1/chips/market                # 全市場法人動向
GET  /api/v1/market/breadth              # 市場廣度
GET  /api/v1/market/indices              # 大盤指數

POST /api/v1/screener/run               # 執行選股（含 AI 解析）
POST /api/v1/screener/backtest          # 回測策略

GET  /api/v1/watchlist                  # 取得自選股（需登入）
POST /api/v1/watchlist                  # 新增自選股
PUT  /api/v1/watchlist/{id}             # 更新
DELETE /api/v1/watchlist/{id}          # 刪除

WS   /ws/quotes                         # 行情 WebSocket
WS   /ws/alerts                         # 到價提醒 WebSocket
```

### 3.3 WebSocket 行情推播設計

```
客戶端 → 訂閱訊息 → { action: "subscribe", symbols: ["2330", "2317"] }

服務端行情更新循環（盤中 09:00–13:30）：
  每 5 秒 GET https://mis.twse.com.tw/stock/api/getStockInfo.jsp
          ?ex_ch=tse_2330.tw|tse_2317.tw   ← 批次查多檔
      │
      ▼
  解析回應 → 比對價格是否有變動
      │
      ▼
  更新 Upstash Redis Hash：quote:{symbol} = { price, change, volume, ... }
      │
      ▼
  僅對「價格有變動」的 symbol 廣播 WebSocket 推播（減少無效封包）

注意事項：
  - TWSE endpoint 為非官方，需加 User-Agent header 模擬瀏覽器
  - 請求頻率建議 ≥ 5 秒間隔，避免 IP 被封
  - 盤後（13:30 後）改為每 5 分鐘 poll FinMind 確認收盤價

TWSE 非官方 Endpoint 防護機制：
  ① User-Agent 輪替
      headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://mis.twse.com.tw/",
      }

  ② 速率保護（Leaky Bucket）
      - 每次請求間隔嚴格 ≥ 5 秒
      - 批次查詢最多 20 檔/次，超過拆分多批

  ③ Circuit Breaker（斷路器）
      - 連續 3 次請求失敗 → 觸發斷路，切換 FinMind fallback
      - 斷路狀態持續 5 分鐘，期間完全不打 TWSE
      - 5 分鐘後 half-open：送一次測試請求，成功則恢復

  ④ Fallback 行為
      - TWSE 斷路期間：從 Redis 取最後已知報價 + 標記 ⚠️「資料延遲」
      - Redis 也無資料：呼叫 FinMind 最新一筆 kline close 作為近似現價
      - 前端收到 { ..., stale: true } 時顯示灰色提示條

  ⑤ 實作位置：twse_fetcher.py（_consecutive_failures 計數器 + _circuit_open_until 時間戳）
```

---

## 4. 資料庫設計（PostgreSQL）

### 4.1 核心資料表

```sql
-- 用戶
users (id, email, name, avatar_url, created_at)

-- 自選股群組
watchlist_groups (id, user_id, name, sort_order, created_at)

-- 自選股項目
watchlist_items (id, group_id, symbol, market, note, tags, sort_order, price_alert, created_at)

-- K 線歷史（分表：kline_1d, kline_1w, kline_1m）
kline_daily (symbol, date, open, high, low, close, volume, turnover)

-- 三大法人（台股）
institutional_chips (symbol, date, foreign_buy, foreign_sell, trust_buy, trust_sell, dealer_buy, dealer_sell)

-- 融資融券
margin_data (symbol, date, margin_balance, margin_change, short_balance, short_change)

-- 策略模板
strategy_templates (id, user_id, name, conditions_json, is_public, created_at)

-- 選股執行記錄
screener_runs (id, user_id, query_text, parsed_conditions, result_symbols, ran_at)
```

### 4.2 Redis 快取策略

```
quote:{symbol}           TTL: 5 秒（盤中）/ 5 分鐘（盤後）
kline:{symbol}:{tf}      TTL: 60 秒（盤中）/ 1 小時（盤後）
chips:{symbol}           TTL: 30 分鐘
market:indices           TTL: 10 秒（盤中）
screener:result:{hash}   TTL: 5 分鐘（避免重複計算）
session:{user_id}        TTL: 7 天
```

---

## 5. AI 整合架構（Gemini API — 免費）

### 5.1 自然語言選股解析流程

```
用戶輸入：「外資連買 5 天且 RSI < 50 的電子股」
    │
    ▼
FastAPI /screener/run
    │
    ▼
ai_service.parse_screener_query(text)
    │
    ▼  呼叫 Google Gemini 1.5 Flash API（免費 1,500 次/日）
       System Prompt：
         你是台股選股條件解析器。
         將用戶輸入轉換為結構化 JSON 篩選條件。
         輸出必須符合 ScreenerCondition schema。
         僅輸出 JSON，不要任何說明文字。
    │
    ▼
ScreenerCondition {
  sector: "電子",
  chips: { foreign_consecutive_buy: { gte: 5 } },
  technical: { RSI_14: { lte: 50 } },
  timeframe: "1d"
}
    │
    ▼
screener_engine.run(conditions) → 查詢 Supabase + Upstash Redis
    │
    ▼
ai_service.generate_summary(symbol, data) → Gemini Flash 生成 100 字理由
    │
    ▼
回傳結果清單 + 每檔 AI 摘要
```

### 5.2 免費額度管理策略

- Gemini 1.5 Flash 免費 tier：**每分鐘 15 次 / 每日 1,500 次**
- 每日 AI 選股結果**快取至 Upstash Redis**（TTL 6 小時），同一條件不重複呼叫
- 超過免費額度時自動 fallback 到 **Groq API**（llama3-70b，免費）

```python
# ai_service.py 範例
import google.generativeai as genai

genai.configure(api_key=GEMINI_API_KEY)  # Google AI Studio 免費取得
model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
    generation_config={"response_mime_type": "application/json"}  # 強制 JSON 輸出
)

response = model.generate_content(
    f"{SCREENER_SYSTEM_PROMPT}\n\n用戶輸入：{user_query}"
)
conditions = json.loads(response.text)
```

---

## 6. 資料管線（Data Pipeline）

### 6.1 排程任務架構

```
APScheduler Jobs：

[盤中 09:00–13:30]
  每 5 秒  → poll TWSE 非官方 Endpoint → 更新 Upstash Redis
  每 60 秒 → 更新盤中分鐘 K → 推播 WebSocket

[盤後 14:00]
  FinMind API 抓取當日：
    - 三大法人買賣超
    - 融資融券餘額
    - 個股日 K 線（OHLCV）
  → 寫入 Supabase（PostgreSQL）
  → 清除相關 Redis 快取
  → 觸發 AI 選股每日摘要

[每週五 18:00]
  - 更新週 K 線
  - 更新財報資料（有更新時）

[每月第一個工作日]
  - 更新大股東持股資料
```

### 6.2 容錯設計

- FinMind API 失敗 → fallback 到 Yahoo Finance（yfinance）
- **TWSE 非官方 Endpoint 失敗** → 三層 fallback：
  1. Redis 最後已知快取報價（標記 `stale: true`）
  2. FinMind 最新 kline close 作為近似現價（標記 `stale: true`）
  3. 全部來源皆失敗 → 前端顯示「無法取得即時報價」灰色遮罩
  > Circuit Breaker：連續 3 次失敗 → 斷路 5 分鐘，保護 IP 不被封鎖
- Gemini API 超出免費額度 → fallback 到 Groq API（llama3-70b）
- 排程任務失敗 → Sentry 告警 + 自動重試 3 次（指數退避）

---

## 7. 安全性設計

| 風險 | 緩解措施 |
|------|---------|
| API Key 洩漏 | 所有外部 API Key 存於環境變數，後端持有，前端不可見 |
| XSS | Next.js 預設跳脫；AI 生成內容用 DOMPurify 過濾 |
| SQL Injection | 全面使用 SQLAlchemy ORM 參數化查詢 |
| CSRF | NextAuth.js 內建 CSRF Token |
| Rate Limiting | Redis 計數器，每 IP 每分鐘 ≤ 60 次 API 請求 |
| 敏感資料 | 用戶密碼 bcrypt hash；JWT 有效期 7 天 |
| Claude API 濫用 | 每用戶每日 AI 選股次數限制（Free: 10 次 / Pro: 100 次）|

---

## 8. 效能優化策略

### Frontend
- **Code Splitting：** 圖表庫（~500KB）非同步 lazy import
- **Virtual Scrolling：** 自選股清單 + 選股結果表格使用虛擬捲動（TanStack Virtual）
- **Web Worker：** 客戶端技術指標計算移入 Web Worker，不阻塞 UI
- **Service Worker：** PWA 離線快取靜態資源

### Backend
- **Connection Pooling：** SQLAlchemy + asyncpg，最大 20 連線
- **Batch Queries：** 自選股報價一次 batch query，非逐條查詢
- **Pagination：** K 線資料 cursor-based 分頁（非 offset）
- **Compression：** WebSocket 訊息 MessagePack 壓縮（比 JSON 小 30–50%）

---

## 9. 技術決策記錄（ADR）

### ADR-001：圖表庫選擇 TradingView Lightweight Charts v5
**決策：** 選用 TradingView Lightweight Charts，不選 ECharts 或 Recharts  
**理由：** 金融 K 線場景特化，效能最優（Canvas 渲染），Crosshair 同步多圖表原生支援  
**折衷：** 自訂彈性較 ECharts 低，複雜疊加圖（法人籌碼）需自行實作 primitive plugin  

### ADR-002：Python FastAPI 而非 Node.js
**決策：** 後端選 FastAPI（Python），前端 BFF 選 Next.js Route Handlers  
**理由：** 量化計算（pandas、numpy）、FinMind Python SDK、回測邏輯在 Python 生態更成熟  
**折衷：** 異語言全端，需維護兩套 type 定義（可用 openapi-typescript 自動生成前端型別）  

### ADR-003：MVP 台股優先，美股 M5 後加入
**決策：** M1–M4 聚焦台股，M5 才整合 Polygon.io 美股  
**理由：** 台股三大法人籌碼是核心差異化功能，需先深做；美股資料來源另行評估授權成本  

---

## 10. 部署架構（MVP）

```
GitHub
  │
  ├─ push to main
  │
  ├─► GitHub Actions CI
  │     - ESLint + TypeScript check
  │     - pytest（後端）
  │     - Build Next.js
  │
  ├─► Vercel（自動部署 Frontend）
  │     Domain: app.yourdomain.com
  │
  └─► Railway（自動部署 Backend）
        Domain: api.yourdomain.com
        Services:
          - FastAPI app（Web）
          - APScheduler worker（Worker）
          - PostgreSQL（Database）
          - Redis（Cache）
```

---

*架構設計為 MVP 階段規劃；生產規模需評估 AWS ECS / GCP Cloud Run + RDS + ElastiCache 遷移方案。*
