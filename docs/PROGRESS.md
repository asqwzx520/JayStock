# StockPulse 專案進度追蹤

> **更新日期：** 2026-06-03  
> **當前版本：** commit `005a56c`  
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

### 中優先（P1 — 功能缺口）

| 功能 | PRD 要求 | 現況 |
|------|---------|------|
| **個股基本面資料卡** | P/E、EPS、市值、殖利率、52週高低 | 完全缺失；yfinance 可提供資料，前端未實作 |
| **個股 30 日籌碼詳情表格** | 三大法人日報表 | 有 API 但 UI 未完整呈現 |
| **連續買超/賣超天數標籤** | 標示「外資連 N 日買超」| 已有 streak badge，但 Watchlist 列表未顯示 |
| **輕量回測引擎** | 過去 20/60 日績效 | `backtest.py` 端點未實作 |
| **美股完整支援** | Polygon.io 整合 | 用 yfinance 部分替代，無完整美股 |
| **SMTP 盤前 AI 推播** | 每日 8AM Email | 端點已建，env var 已設，待實際發信驗證 |

### UI / UX 缺口（視覺品質）

> 2026-06-03 UI 審查後記錄，需改善才能達到「頂尖股票網站」標準

#### 視覺問題（讓網站看起來業餘）

| 問題 | 位置 | 改法 |
|------|------|------|
| **Header 無大盤指數** | `Header.tsx` | 加入 TWII + 美股三大指數即時跳動列 |
| **Tab 顯示英文代碼** | `page.tsx` tab labels | 改為「K線 / 籌碼 / 大盤 / 選股 / 新聞」中文標籤 |
| **載入動畫太陽春** | 所有 dynamic import | 改用 CSS Skeleton 動畫取代純文字「載入中…」 |
| **RightPanel 隱藏** | `RightPanel.tsx` `hidden xl:block` | 改為 `lg:block` 或整合進主要佈局 |
| **無基本面摘要列** | 工具列下方空白 | 在 K線圖上方加一列：市值 / P/E / EPS / 52週高低 |

#### 功能缺口（頂尖股票網站必備）

| 功能 | 競品對標 | 實作方向 |
|------|---------|---------|
| **個股基本面資料** | 富途牛牛 / Investing.com | yfinance `Ticker.info` → 後端 `/api/v1/fundamental/{symbol}` → 前端 Tab |
| **繪圖工具** | TradingView | Lightweight Charts `createLineTool` / `createTrendLine` |
| **行動版 RWD** | 所有頂尖站 | 手機版折疊側欄 + 底部 Tab bar |
| **多股比較圖** | TradingView | 同一圖疊加 2–3 支股票折線 |
| **鍵盤快捷鍵** | TradingView | `/` 跳搜尋、`D` 切日K、`W` 切週K 等 |
| **通知推播** | 富途 / 籌碼K線 | 設價提醒目前只有 Toast；可加 Web Push Notification |

### 低優先（P2/P3）

| 功能 | 備註 |
|------|------|
| 多圖表版型（2分割 / 4分割）| 需 layout 架構調整 |
| Storybook UI 元件庫 | M0 跳過 |
| 策略儲存與訂閱 | M4 P2 功能 |
| Pine Script 相容 | 長期路線圖 |
| 行動 App（原生）| Web/PWA 優先 |

---

## ✅ 近期完成（2026-06-03）

| Commit | 說明 | 狀態 |
|--------|------|------|
| `13fe0cb` | WebSocket 即時行情 + dnd-kit 拖曳排序 + 設價提醒 in-memory | ✅ Live |
| `3f28aa0` | Google 登入 trustHost 修復 + FinMind 全端 TTL 快取 + 安全性強化 | ✅ Live |
| `265d843` | Session 綁定 Watchlist（Google 登入後 user_id 自動同步）| ✅ Live |
| `733eda3` | digest API 端點（`/digest/status` + `/digest/send`）| ✅ Live |
| `2c42e67` | CI 修復：WebSocket TDZ lint error + pytest env var | ✅ Live |
| `005a56c` | CI 修復：conftest.py + scheduler DISABLE_SCHEDULER | ⏳ Deploying |

---

## 🎯 建議下一步（按優先級排序）

### 第 0 步：UptimeRobot 防冷啟動（10 分鐘，免費）
> Render 免費方案閒置 15 分鐘會休眠，造成首次訪問等待 30–90 秒

- 註冊 [https://uptimerobot.com](https://uptimerobot.com)（免費方案）
- 新增 Monitor：
  - Type: **HTTP(s)**
  - URL: `https://jaystock.onrender.com/health`
  - Interval: **每 14 分鐘**（低於 Render 15 分鐘休眠門檻）
- 可選：再加一個前端 Monitor `https://jaystock-web.onrender.com`
- 完成後後端 24 小時保持清醒，首次訪問不再卡頓

### 第 1 步：SMTP 盤前 AI 推播驗證（30 分鐘）
- 手動呼叫 `POST https://jaystock.onrender.com/api/v1/digest/send`
- 確認 Email 送達（Gmail App Password 需填入 `DIGEST_SMTP_PASS`）

### 第 2 步：Session 綁定 Watchlist（中優先）
- 目前 user_id 是 localStorage UUID，登入後無法自動合併
- 修改 `getUserId()` 在 NextAuth Session 存在時回傳 session user id
- 讓同一 Google 帳號在不同設備有相同自選股

### 第 3 步：UI 視覺提升 — 讓網站看起來專業（高衝擊）
> 來源：2026-06-03 UI 審查

**A. Header 大盤指數列**
- 在 Header 加入 TWII、S&P500、NASDAQ、費半即時跳動
- 資料來源：`/api/v1/market/indices`（已有端點）
- 檔案：`apps/web/components/layout/Header.tsx`

**B. Tab 中文標籤 + 基本面摘要列**
- Tab 改為「K線 / 籌碼 / 大盤 / 選股 / 新聞」
- K線圖上方加一列：市值 / P/E / 殖利率 / 52週高低
- 檔案：`apps/web/app/page.tsx`

**C. Skeleton 載入動畫**
- 取代所有「載入圖表中…」文字
- 建立 `components/ui/Skeleton.tsx` 共用元件
- 套用到 KLineChart / ChipsChart / MarketDashboard

**D. RightPanel 修復**
- `hidden xl:block` → `hidden lg:block`
- 讓 1024px 以上螢幕都能看到右側面板

### 第 4 步：個股基本面資料（功能缺口最大）
- 後端：`GET /api/v1/fundamental/{symbol}` — yfinance `Ticker.info`
  - 回傳：市值、P/E、EPS、殖利率、產業、52週高低、平均成交量
- 前端：在 K線工具列下加「基本面摘要列」或新增「基本面」Tab
- 檔案：`apps/api/app/api/v1/fundamental.py`（新建）

### 第 5 步：行動版 RWD
- 手機版（< 768px）：左側欄折疊 → 底部抽屜
- Header 在手機版折疊搜尋欄
- 主圖表佔滿寬度，指標選擇改為 dropdown

### 第 6 步：輕量回測引擎（P1）
- `backtest.py` 端點：給定策略 + 期間 → 回傳 20/60 日績效
- 前端在 ScreenerPanel 結果列中加入「回測」按鈕

### 第 7 步：正式網域 + Cloudflare（上線）
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

*最後更新：2026-06-03 by Claude*
