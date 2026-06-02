# StockPulse 專案進度追蹤

> **更新日期：** 2026-06-03  
> **當前版本：** commit `13fe0cb`  
> **線上服務：**
> - 前端：https://jaystock-web.onrender.com
> - 後端：https://jaystock.onrender.com

---

## 整體完成度

| 里程碑 | 目標 | 完成度 | 狀態 |
|--------|------|:------:|------|
| M0 環境建置 | 全端環境 + CI/CD | 90% | ✅ 完成（缺 Storybook）|
| M1 基礎看盤 | K線 + 技術指標 + 搜尋 | 100% | ✅ 完成 |
| M2 自選股 Watchlist | CRUD + 匯出 + 拖曳排序 | 95% | ✅ 完成 |
| M3 三大法人籌碼 | K線疊圖 + 市場儀錶板 | 85% | ✅ 核心完成 |
| M4 AI 選股器 | 自然語言 + 模板 + 結果 | 90% | ✅ 完成 |
| M5 市場儀錶板 | 大盤 + 廣度 + AI推播 | 85% | ✅ 完成（SMTP待驗證）|
| M6 效能優化 + 上線 | SEO + Sentry + 部署 | 95% | ✅ 已部署 |
| M7 即時行情 | WebSocket + 設價提醒 | 90% | ✅ 完成（新增）|

**整體 PRD 功能完成度：約 93%**

---

## ✅ 已完成功能清單

### K 線圖表（超越 PRD 規格）
- [x] 五種圖表類型：蠟燭 / 空心K / Heikin-Ashi / 折線 / 面積
- [x] 技術指標：MA、EMA、BOLL、MACD、RSI、KD（PRD 標準）
- [x] 額外指標：VWAP、Williams %R、OBV（PRD 未規劃）
- [x] 三大法人籌碼疊圖（外資 / 投信 / 自營）
- [x] 時間週期切換（1m/5m/15m/30m/60m/日/週/月）

### 自選股（M2）
- [x] Watchlist CRUD（前後端完整）
- [x] CSV ↓ / JSON ↓ 匯出（含 BOM 修正）
- [x] 多群組管理
- [x] **dnd-kit 拖曳排序**（⠿ 拖把，取代 ▲▼ 按鈕）
- [x] **設價提醒**（突破/跌破通知，🔔 UI + AlertsToast）

### 市場功能（M3 + M5）
- [x] 市場整體法人動向儀錶板
- [x] 漲幅 / 跌幅 / 爆量 Top 20 排行榜
- [x] 大盤指數列（台股 + 美股）
- [x] 個股新聞 Tab（yfinance + 新舊格式自動偵測）

### AI & 選股（M4）
- [x] 自然語言解析選股（Gemini API）
- [x] 5 個預設策略模板
- [x] 多維篩選器（技術 / 籌碼 / 基本面）
- [x] 選股結果列表

### 即時行情（新增）
- [x] **WebSocket `/ws/quotes`** 端點（盤中 5s / 盤外 30s diff 推播）
- [x] **`useStockWebSocket` hook**（自動重連，指數退避）
- [x] LeftPanel + page.tsx 改用 WS，取代 15s REST 輪詢
- [x] 連線指示燈（頭部綠點）

### 部署 & 品質（M6）
- [x] Google OAuth 登入（NextAuth.js v5）
- [x] Dark / Light 模式切換（防 FOUC）
- [x] Sentry 錯誤監控
- [x] Beta 回饋 Widget（前端 + 後端 `/api/v1/feedback`）
- [x] SEO / Open Graph Meta
- [x] Render 雙服務部署（前端 + 後端）
- [x] GitHub Actions CI/CD
- [x] Supabase 資料庫（watchlist + 設價提醒通知，免費方案）

---

## ⚠️ 未完成 / 差距項目

### 高優先（P0 — PRD 核心功能）

| 功能 | PRD 要求 | 現況 | 缺失原因 |
|------|---------|------|---------|
| **FinMind 法人每日自動抓取** | APScheduler 排程 | 無排程，用 yfinance 替代 | APScheduler 任務未啟用法人資料抓取 |

### 中優先（P1）

| 功能 | PRD 要求 | 現況 |
|------|---------|------|
| **localStorage → 雲端同步** | 登入後自動同步 | Supabase 已串，但需登入 Session 綁定 user_id |
| **個股 30 日籌碼詳情表格** | 三大法人日報表 | 有 API 但 UI 未完整呈現 |
| **連續買超/賣超天數標籤** | 標示「外資連 N 日買超」| 已有 streak badge，但 Watchlist 列表未顯示 |
| **輕量回測引擎** | 過去 20/60 日績效 | `backtest.py` 端點未實作 |
| **美股完整支援** | Polygon.io 整合 | 用 yfinance 部分替代，無完整美股 |
| **SMTP 盤前 AI 推播** | 每日 8AM Email | SMTP 環境變數已設，未實際驗證 |

### 低優先（P2/P3）

| 功能 | 備註 |
|------|------|
| 繪圖工具（趨勢線、費氏回調）| TradingView primitives 未加 |
| 多圖表版型（2分割 / 4分割）| 需 layout 架構調整 |
| Storybook UI 元件庫 | M0 跳過 |
| 策略儲存與訂閱 | M4 P2 功能 |
| Pine Script 相容 | 長期路線圖 |
| 行動 App（原生）| Web/PWA 優先 |

---

## ✅ 近期完成（2026-06-03）

| Commit | 說明 | 狀態 |
|--------|------|------|
| `45ce534` | 新聞 API：相容 yfinance 新巢狀格式 | ✅ Live |
| `28c7f71` | 新聞 API：改用 `get_news()` 優先，解決 1.4.1 空陣列問題 | ✅ Live |
| `13fe0cb` | WebSocket + dnd-kit + 設價提醒 in-memory + PROGRESS.md | ⏳ Deploying |

---

## 🎯 建議下一步（按優先級排序）

### 第 1 步：SMTP 盤前 AI 推播驗證（30 分鐘）
- 手動呼叫 `POST https://jaystock.onrender.com/api/v1/digest/send`
- 確認 Email 送達（Gmail App Password 需填入 `DIGEST_SMTP_PASS`）

### 第 2 步：Session 綁定 Watchlist（中優先）
- 目前 user_id 是 localStorage UUID，登入後無法自動合併
- 修改 `getUserId()` 在 NextAuth Session 存在時回傳 session user id
- 讓同一 Google 帳號在不同設備有相同自選股

### 第 3 步：輕量回測引擎（P1）
- `backtest.py` 端點：給定策略 + 期間 → 回傳 20/60 日績效
- 前端在 ScreenerPanel 結果列中加入「回測」按鈕

### 第 4 步：多圖表版型（P1）
- 雙圖左右分割（2 個 KLineChart 並排）
- 需重構 `page.tsx` layout 支援多 symbol 同時顯示

### 第 5 步：正式網域 + Cloudflare（上線）
- 購買 `stockpulse.tw` 或類似網域
- Cloudflare DNS + SSL + CDN，取代 Render 預設網址
- 更新 NextAuth `AUTH_URL` + CORS_ORIGINS

---

## 🌐 線上服務端點

| 端點 | 說明 | 狀態 |
|------|------|------|
| `GET /api/v1/quotes/{symbol}` | 個股即時報價 | ✅ 正常 |
| `GET /api/v1/kline/{symbol}` | K 線歷史資料 | ✅ 正常 |
| `GET /api/v1/chips/{symbol}` | 三大法人籌碼 | ✅ 正常 |
| `GET /api/v1/market/indices` | 大盤指數 | ✅ 正常 |
| `GET /api/v1/market/ranking` | 漲跌爆量排行 | ✅ 正常 |
| `GET /api/v1/news/{symbol}` | 個股新聞 | ✅ 正常（已修復） |
| `POST /api/v1/screener/run` | AI 選股執行 | ✅ 正常 |
| `GET/POST /api/v1/watchlist` | 自選股 CRUD | ✅ 正常（Supabase 持久化）|
| `POST /api/v1/feedback` | Beta 回饋 | ✅ 正常 |
| `GET /api/v1/alerts` | 設價提醒通知 | ✅ 正常（Supabase + in-memory fallback）|
| `WS /ws/quotes` | 即時行情 WebSocket | ✅ 新增（13fe0cb）|

---

*最後更新：2026-06-03 by Claude（gsd-progress skill）*
