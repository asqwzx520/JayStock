# StockPulse 專案進度追蹤

> **更新日期：** 2026-06-07  
> **當前版本：** commit `2eb7d7f`（Web Push Notification：VAPID + Service Worker + Supabase 持久化，端對端測試通過）  
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
- [x] 自然語言解析選股（Gemini API）— 競品無此功能
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
| ~~**個股基本面資料卡**~~ | P/E、EPS、市值、殖利率、52週高低 | ✅ 已完成（`fundamental.py` + `FundSection`） |
| ~~**股利歷史近 10 年**~~ | 每年配息 + 殖利率折線 | ✅ 已完成（`dividends.py` + `DividendHistorySection`） |
| ~~**PE/PB 歷史估值帶**~~ | 5 年均值 ±σ 帶 | ✅ 已完成（`valuation_band.py`） |
| ~~**同業比較表**~~ | 5 家同產業橫向比較 | ✅ 已完成（`peer_comparison.py`，支援自訂對比） |
| ~~**外資持股比例趨勢**~~ | 近 12 月折線 + 股價疊圖 | ✅ 已完成（`foreign_holding.py`，TWSE） |
| ~~**月營收走勢**~~ | 24 個月折線 + YoY 柱狀 | ✅ 已完成（`monthly_revenue.py`，MOPS） |
| ~~**財務歷史 10 年**~~ | 損益表 + 現金流 10 年 | ✅ 已完成（`financials.py`） |
| **個股 30 日籌碼詳情表格** | 三大法人日報表 | 有 API 但 UI 未完整呈現 |
| **連續買超/賣超天數標籤** | 標示「外資連 N 日買超」| 已有 streak badge，但 Watchlist 列表未顯示 |
| **美股完整支援** | Polygon.io 整合 | 用 yfinance 部分替代，無完整美股 |
| **SMTP 盤前 AI 推播** | 每日 8AM Email | 端點已建，env var 已設，待實際發信驗證 |

### UI / UX 缺口（視覺品質）

> 2026-06-03 UI 審查後記錄，需改善才能達到「頂尖股票網站」標準

#### 視覺問題（讓網站看起來業餘）

| 問題 | 位置 | 改法 |
|------|------|------|
| ~~**Header 無大盤指數**~~ | `Header.tsx` | ✅ 已完成：IndicesBar 顯示骨架動畫 → 即時點位/漲跌點/漲跌幅（`IndicesBar` 重構）|
| **Tab 顯示英文代碼** | `page.tsx` tab labels | 改為「走勢圖 / 籌碼 / 大盤 / 選股 / 新聞」中文標籤（✅ 已修） |
| ~~**載入動畫太陽春**~~ | 所有 dynamic import | ✅ 已完成：CSS Skeleton 動畫覆蓋 K線/市場/選股/新聞/分析，新增 `RightPanelSkeleton`，AnalysisPanel 替換 ⏳ spinner |
| ~~**RightPanel 隱藏**~~ | `RightPanel.tsx` `hidden xl:block` | ✅ 已修：改為 `hidden lg:block`（1024px+ 顯示），新增 isLoading skeleton |
| **無基本面摘要列** | 工具列下方空白 | 在 K線圖上方加一列：市值 / P/E / EPS / 52週高低 |
| **Toolbar 太擁擠** | `page.tsx` | 主 tab 與圖表控制同一列（✅ 已拆成兩列）|
| **登入按鈕位置怪** | `Header.tsx` | AuthButton 非最右側（✅ 已修，ml-auto 推到右邊）|

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

## 🏆 競品齊全度分析（2026-06-04）

> 評估基準：TradingView（圖表標準）、富途牛牛（全功能平台）、籌碼K線（台股籌碼專家）  
> 評分方法：✅ 完整實作 ／ △ 部分或弱實作 ／ ❌ 完全缺失

### 1. K 線圖表 & 技術分析

| 功能項目 | StockPulse | TradingView | 富途牛牛 | 籌碼K線 | 差距評估 |
|---------|:----------:|:-----------:|:-------:|:------:|---------|
| 蠟燭 / 空心K / HA / 折線 / 面積 | ✅ | ✅ | ✅ | ✅ | 齊平 |
| MA / EMA / BOLL | ✅ | ✅ | ✅ | ✅ | 齊平 |
| MACD / RSI / KD | ✅ | ✅ | ✅ | ✅ | 齊平 |
| VWAP / OBV / Williams %R | ✅ | ✅ | ✅ | ✅ | 齊平 |
| 週期：1分 ～ 月K | ✅ | ✅ | ✅ | ✅ | 齊平 |
| **繪圖工具（趨勢線 / 水平線 / 斐波納契）** | ❌ | ✅✅ | ✅ | ✅ | **重大缺口** — 交易者的基本需求 |
| **多圖版型（2分割 / 4分割）** | ❌ | ✅✅ | ✅ | ❌ | 進階缺口 |
| **Pine Script / 自訂指標** | ❌ | ✅✅ | ❌ | ❌ | 長期路線 |
| **多股比較折線** | ❌ | ✅ | ✅ | ❌ | 中優先 |
| **K 線型態辨識（錘頭 / 吞噬 / 十字星）** | ❌ | ✅ | ✅ | ✅ | 中優先 |
| **量價背離自動提示** | ❌ | ✅ | ✅ | ✅ | 中優先 |

**評分：5/11 ★★★☆☆** — 基礎技術分析完整，缺繪圖工具是最大硬傷。

---

### 2. 台股籌碼分析（核心競爭力）

| 功能項目 | StockPulse | TradingView | 富途牛牛 | 籌碼K線 | 差距評估 |
|---------|:----------:|:-----------:|:-------:|:------:|---------|
| 三大法人買賣超 K線疊圖 | ✅ | ❌ | △ | ✅ | 相較 TradingView 有優勢 |
| 連續買超 / 賣超 streak badge | ✅ | ❌ | ❌ | ✅ | 優勢保持 |
| 融資融券圖表 | ✅ | ❌ | △ | ✅ | 齊平 |
| **30 日籌碼日報數字表格** | △ 弱 | ❌ | ✅ | ✅ | **缺完整數字呈現** — 用戶需核對每日數字 |
| **籌碼集中度 / 主力控盤率** | ❌ | ❌ | ❌ | ✅✅ | 差距於台股專業用戶 |
| **外資期貨未平倉（大台/小台）** | ❌ | ❌ | ❌ | ✅ | 期貨交易者重要需求 |
| **借券賣出資料** | ❌ | ❌ | △ | ✅ | 中優先 |
| **董監持股 / 大股東結構** | ❌ | ❌ | ✅ | ✅ | 長期投資者需求 |
| **股權分散表（持股人數分佈）** | ❌ | ❌ | ❌ | ✅✅ | 籌碼K線核心功能 |

**評分：3/9 ★★★☆☆** — 三大法人疊圖有優勢，但缺乏數字化呈現和期貨籌碼，台股籌碼專業用戶仍需搭配籌碼K線使用。

---

### 3. 個股基本面資料（✅ 已全面補強）

| 功能項目 | StockPulse | TradingView | 富途牛牛 | 籌碼K線 | 差距評估 |
|---------|:----------:|:-----------:|:-------:|:------:|---------|
| **P/E（本益比）、EPS** | ✅ | ✅ | ✅✅ | △ | 已補，`fundamental.py` |
| **殖利率、配息歷史近 10 年** | ✅ | ✅ | ✅✅ | △ | 已補，`dividends.py`，連續配息年數 |
| **52 週高低、Beta** | ✅ | ✅ | ✅ | ❌ | 已補，含 52W 圖示 |
| **市值、流通股數** | ✅ | ✅ | ✅ | △ | 已補，含億/兆格式 |
| **財報三表（損益 / 現金流 10 年）** | ✅ | ✅ | ✅✅ | ❌ | 已補，`financials.py` 10 年 |
| **EPS 趨勢圖、季報比較** | ✅ | ✅ | ✅✅ | ❌ | 已補，季度 EPS 柱狀圖 |
| **法人評級 / 目標價** | ✅ | △ | ✅ | ❌ | 已補，分析師共識卡 |
| **同業 P/E 比較（產業評價）** | ✅ | △ | ✅ | ❌ | 已補，5家同業 + 自訂對比 |

**評分：8/8 ★★★★★** — 基本面資料已全面補強，涵蓋存股族（殖利率/配息歷史）、成長股（EPS趨勢/財報）、估值（PE/PB帶）、同業橫向比較。

---

### 4. AI 選股 & 策略功能

| 功能項目 | StockPulse | TradingView | 富途牛牛 | 籌碼K線 | 差距評估 |
|---------|:----------:|:-----------:|:-------:|:------:|---------|
| 技術條件多維篩選 | ✅ | ✅ | ✅ | ✅ | 齊平 |
| **自然語言 AI 選股（Gemini）** | ✅ **領先** | ❌ | ❌ | ❌ | **差異化優勢** — 三大競品均無 |
| 5 個策略模板 | ✅ | ✅ | △ | ✅ | 齊平 |
| **回測引擎（歷史績效驗證）** | ❌ | ✅✅ | △ | ❌ | **重大缺口** — 策略可信度的依據 |
| **條件單回測 / 參數最佳化** | ❌ | ✅✅ | ❌ | ❌ | 進階缺口 |
| **策略儲存 / 分享 / 訂閱** | ❌ | ✅✅ | ❌ | △ | 長期路線 |
| **選股結果一鍵加入自選股** | △ | ✅ | ✅ | ✅ | 小缺口，易補 |

**評分：3/7 ★★★☆☆** — AI 自然語言選股是真正差異化，但缺回測讓策略無法被驗證，削弱說服力。

---

### 5. 即時行情 & 資料品質

| 功能項目 | StockPulse | TradingView | 富途牛牛 | 籌碼K線 | 差距評估 |
|---------|:----------:|:-----------:|:-------:|:------:|---------|
| WebSocket 即時推播架構 | ✅ | ✅✅ | ✅✅ | ✅ | 架構齊平 |
| 盤中 5 秒更新 | ✅ | ✅ | ✅ | ✅ | 齊平 |
| 台股完整個股覆蓋 | ✅ | ✅ | ✅ | ✅ | 齊平 |
| **Level 2 委買委賣五檔** | ❌ | △ 付費 | ✅ | △ | **交易者核心工具** |
| **盤前 / 盤後美股行情** | ❌ | ✅ | ✅ | ❌ | 美股用戶需求 |
| **美股完整資料（Polygon.io）** | △ yfinance | ✅✅ | ✅✅ | ❌ | 資料穩定性風險，yfinance 有 rate limit |
| **期貨 / 選擇權行情** | ❌ | △ | ✅ | △ | 衍生品交易者需求 |
| **歷史波動率 / 隱含波動率** | ❌ | ✅ | ✅ | ❌ | 選擇權交易者需求 |

**評分：3/8 ★★☆☆☆** — 台股基本行情 OK，但五檔委買委賣缺失對短線交易者是硬傷，美股用 yfinance 有長期穩定性風險。

---

### 6. 通知 & 提醒系統

| 功能項目 | StockPulse | TradingView | 富途牛牛 | 籌碼K線 | 差距評估 |
|---------|:----------:|:-----------:|:-------:|:------:|---------|
| 設價提醒（突破 / 跌破）Toast | ✅ | ✅ | ✅ | ✅ | 基本齊平 |
| **Web Push Notification（背景通知）** | ✅ | ✅ | ✅ | ❌ | **已完成（`2eb7d7f`）：VAPID + SW + Supabase 持久化** |
| **Email / Line 推播** | △ Email 架構已建 | ✅ | ✅ | ✅ | Email 待驗證，無 Line |
| **技術指標觸發警報（如 RSI < 30）** | ❌ | ✅✅ | ✅ | △ | 進階需求 |
| **法人異常大量買超警報** | ❌ | ❌ | △ | ✅ | 台股籌碼用戶需求 |
| **財報公告 / 除權息提醒** | ❌ | ✅ | ✅ | △ | 散戶基本需求 |

**評分：3/6 ★★★☆☆** — Web Push 已完成（VAPID + Supabase 持久化）；Email 架構已建待驗證；Line 未做。

---

### 7. UX & 平台品質

| 功能項目 | StockPulse | TradingView | 富途牛牛 | 籌碼K線 | 差距評估 |
|---------|:----------:|:-----------:|:-------:|:------:|---------|
| Dark / Light 模式（防 FOUC） | ✅ | ✅ | ✅ | △ | 優於籌碼K線 |
| Google OAuth 登入 | ✅ | ✅ | ✅ | ❌ | 優於籌碼K線 |
| **行動版 RWD（手機看盤）** | ✅ 已完成 | ✅✅ | App ✅ | △ → ✅ | **三段式 RWD 佈局：底部 Tab bar + 側欄折疊抽屜（`1960da0`）** |
| **鍵盤快捷鍵** | ❌ | ✅✅ | △ | ❌ | 進階用戶需求 |
| **Skeleton 載入動畫** | ❌ 純文字 | ✅ | ✅ | ✅ | 視覺品質差距 |
| 自選股多群組 + 拖曳排序 | ✅ | ✅ | ✅ | ✅ | 齊平 |
| CSV / JSON 匯出 | ✅ | △ | △ | ❌ | 輕微優勢 |
| 主 Tab 導航清晰度 | ✅ 已改 | ✅ | ✅ | ✅ | 已修（181be18）|
| Header 登入按鈕位置 | ✅ 已修 | ✅ | ✅ | ✅ | 已修（181be18）|
| Sentry 錯誤監控 | ✅ | — | — | — | 工程品質領先 |
| GitHub Actions CI/CD | ✅ | — | — | — | 工程品質領先 |

**評分：6/11 ★★★★☆** — 工程品質不錯，行動版 RWD 已補強；Skeleton 載入動畫與鍵盤快捷鍵仍待做。

---

### 綜合評分摘要

| 面向 | 得分 | 滿分 | 評分 | 最關鍵補強 |
|------|:----:|:----:|:----:|-----------|
| K 線圖表技術分析 | 7 | 11 | ★★★★☆ | 繪圖工具已補，ATR/ADX/StochRSI/Ichimoku 已補強 |
| 台股籌碼分析 | 5 | 9 | ★★★★☆ | 6 區塊垂直滾動、7 項評分、券商分點已補；期貨籌碼尚缺 |
| **個股基本面資料** | **8** | **8** | **★★★★★** | **✅ 全面補強完成（P/E、EPS、殖利率、股利歷史、財報 10 年）** |
| AI 選股 & 策略 | 6 | 7 | ★★★★★ | 回測引擎 ✅ 已補（`19eb219`）|
| 即時行情品質 | 3 | 8 | ★★☆☆☆ | 五檔委買委賣 |
| 通知 & 提醒 | 3 | 6 | ★★★☆☆ | Web Push ✅ 已完成；Email 待驗證；Line 未做 |
| UX & 平台品質 | 7 | 11 | ★★★★☆ | 鍵盤快捷鍵 |
| **加總** | **39** | **60** | **約 77/100** | |

> **結論（2026-06-07 更新）：** Web Push Notification 完整上線（`e59edd8`～`2eb7d7f`），通知面向從 1/6 → 3/6。修復 slowapi+Pydantic 422 bug、require_user 同時支援 UUID v4 與 Google numeric ID。整體評分 75 → 77 分。  
> 下一個建議：**SMTP 盤前 AI 推播驗證**（30 分鐘）或 **鍵盤快捷鍵**（UX 質感提升）。

---

## 🎯 建議下一步（按優先級排序）

### ~~第 0 步：UptimeRobot 防冷啟動~~ ✅ 已完成
> 已設定每 14 分鐘 ping `https://jaystock.onrender.com/health`，防止 Render 冷啟動

### 第 1 步：SMTP 盤前 AI 推播驗證（30 分鐘）
- 手動呼叫 `POST https://jaystock.onrender.com/api/v1/digest/send`
- 確認 Email 送達（Gmail App Password 需填入 `DIGEST_SMTP_PASS`）

### ~~第 2 步：個股基本面資料~~ ✅ 已完成
> 競品評分 0/8 → 8/8，包含：P/E、EPS、殖利率、股利歷史 10 年、財報 10 年、PE/PB 估值帶、同業比較、月營收、外資持股

### 第 3 步：UI 視覺提升（已部分完成）

**A. Header 跑馬燈行情列**（✅ 已完成 `3021203`）
- TickerTape 替換原 IndicesBar：大盤指數 + 用戶自選股持續滾動
- 兩步驟同步：先讀 localStorage 快速顯示 → 再從 Supabase 拉真實資料

**B. Tab 中文標籤**（✅ 已完成 `181be18`）
- 走勢圖 / 籌碼 / 大盤 / 選股 / 新聞 — underline 樣式導航
- 圖表控制拆到第二列，不再與主 tab 混排

**C. Skeleton 載入動畫**（待做）
- 取代所有「載入圖表中…」文字
- 建立 `components/ui/Skeleton.tsx` 共用元件
- 套用到 KLineChart / ChipsChart / MarketDashboard

**D. RightPanel 修復**（待做）
- `hidden xl:block` → `hidden lg:block`
- 讓 1024px 以上螢幕都能看到右側面板

### ~~第 4 步：行動版 RWD~~ ✅ 已完成（`1960da0`）
> 三段式 RWD 佈局已實作：底部 Tab bar + 左側欄折疊抽屜，台灣 60%+ 投資人用手機看盤。

### ~~第 5 步：繪圖工具（技術分析必備）~~ ✅ 已完成（`c1a8a7d`）
> Fibonacci / 矩形 / 文字標籤 / 平行通道均已實作（Canvas 疊圖 + localStorage 持久化）。

### ~~第 6 步：回測引擎（頂尖版）~~ ✅ 已完成（`19eb219`，2026-06-05）
> 6 種策略 + 11 項指標 + 4 分頁結果面板（績效摘要/資金曲線/交易明細/月份熱力圖），全免費部署。

### ~~第 7 步：Web Push Notification~~ ✅ 已完成（`2eb7d7f`，2026-06-07）
- Service Worker (`/sw.js`) + VAPID 金鑰 + Push API
- 設價提醒觸發時，即使瀏覽器關閉也能收到系統推播
- 後端：`push_service.py`（pywebpush 發送）+ `/api/v1/push/subscribe` Supabase 持久化
- 前端：`usePushNotification` hook + Header 📶 訂閱按鈕
- **端對端測試通過**：訂閱 → Supabase 儲存 → VAPID 推播 → 裝置收到通知

### 第 8 步：正式網域 + Cloudflare（上線）
- 購買 `stockpulse.tw` 或類似網域
- Cloudflare DNS + SSL + CDN，取代 Render 預設網址
- 更新 NextAuth `AUTH_URL` + CORS_ORIGINS

---

## ✅ 近期完成（2026-06-07）

| Commit | 說明 | 狀態 |
|--------|------|------|
| `e59edd8`～`2eb7d7f` | **Web Push Notification**：Service Worker + VAPID + pywebpush；`push_service.py`（Supabase 持久化 + in-memory fallback）；`/api/v1/push/subscribe|status|test` 端點；`usePushNotification` hook；Header 📶 訂閱按鈕；修復 slowapi+Pydantic 422（改用 `request.json()`）；修復 require_user 支援 Google numeric ID；Supabase `push_subscriptions` 表建立；**端對端測試通過** | ✅ Live |
| `234cf4f` | **籌碼 Tab 全面翻新**：6 區塊垂直滾動（評分環形圖 / 法人流量 / 累積持倉 / 外資持股% / 券商分點 / 融資融券）；7 項加權評分（滿分 100）；券商分點分 foreign/trust/daytrade 三類 + 隔日沖偵測（已知名單 + 算法）；`/chips/{symbol}/brokers?days=5/10/20` 新端點；TTL 300s 快取 | ✅ Live |
| `19eb219` | **回測引擎（頂尖版）**：6 種策略（MA黃金交叉/RSI均值回歸/MACD/KD/布林/自訂）；11 項績效指標（CAGR/Sharpe/Sortino/Calmar/MaxDD/勝率/盈虧比等）；台股交易成本（買0.1425%，賣0.1425%+0.3%稅）；benchmark自動選0050.TW/SPY；yfinance最多20年日K，24h TTL；4 分頁結果（績效摘要/資金曲線+交易標記/交易明細可排序/月份報酬熱力圖）| ✅ Live |
| `234cf4f` | **首頁 Tab 280px 自選股側欄**：LeftPanel WatchlistSidebar 內嵌首頁，支援多群組；TickerTape 純大盤指數（移除自選股）；HomeDashboard 移除重複 WatchlistBlock | ✅ Live |
| `e4381ef` | **佈局架構重構**：移除 LeftPanel/RightPanel 固定側欄；K 線圖從 `flex-1` 改 `h-full` 修正高度；新增「排行」主 Tab；WorkspaceModal 拖曳排序；自選股改為首頁 Tab 左側欄 | ✅ Live |
| `3021203` | **Theme B 視覺改造**：藍黑 Terminal 背景（#0a0e17）、跑馬燈行情列（大盤指數 + 用戶自選股，兩步驟同步 Supabase）、Tab 列加右側分隔線與選中深藍底色、Logo 改等寬大寫 + 狀態燈、圓角縮小 | ✅ Live |
| — | UptimeRobot 監控設定（每 14 分鐘 ping /health，防冷啟動）| ✅ 完成 |
| `41e7233` | 補齊新端點安全防護（validate_symbol + X-User-ID） | ✅ Live |
| `1592574` | FEATURE-BACKLOG 完成狀態更新（#1/#2/#3/#6/#8）| ✅ Live |
| `c1a8a7d` | 繪圖工具：Fibonacci / 矩形 / 文字標籤 / 平行通道 | ✅ Live |
| `1960da0` | 行動版 RWD：三段式響應式佈局（底部 Tab bar + 側欄折疊抽屜）| ✅ Live |
| — | 技術指標補強：ATR(14) / ADX+DI±(14) / Stochastic RSI / Ichimoku 一目均衡表 | ✅ 本次新增 |
| `260b455` | 外資持股比例走勢（TWSE MI_QIANW + 雙軸折線圖）| ✅ Live |
| `b74b080` | 財務報表歷史由 5 年延長至 10 年 | ✅ Live |
| — | 股利歷史近 10 年（`dividends.py` + `DividendHistorySection`）| 本次新增 |
| `181be18` | UI 修復：Toolbar 拆兩列 + AuthButton 移右 + Tab 中文化 | ✅ Live |

---

## 🌐 線上服務端點

| 端點 | 說明 | 狀態 |
|------|------|------|
| `GET /api/v1/quotes/{symbol}` | 個股即時報價 | ✅ 正常 |
| `GET /api/v1/kline/{symbol}` | K 線歷史資料 | ✅ 正常 |
| `GET /api/v1/chips/{symbol}` | 三大法人籌碼 | ✅ 正常 |
| `GET /api/v1/market/indices` | 大盤指數 | ✅ 正常 |
| `GET /api/v1/market/ranking` | 漲跌爆量排行 | ✅ 正常 |
| `GET /api/v1/news/{symbol}` | 個股新聞 | ✅ 正常（已修復）|
| `POST /api/v1/screener/run` | AI 選股執行 | ✅ 正常 |
| `GET/POST /api/v1/watchlist` | 自選股 CRUD | ✅ 正常（Supabase 持久化）|
| `POST /api/v1/feedback` | Beta 回饋 | ✅ 正常 |
| `GET /api/v1/alerts` | 設價提醒通知 | ✅ 正常（Supabase + in-memory fallback）|
| `GET /api/v1/digest/status` | Email 推播狀態查詢 | ✅ 正常 |
| `POST /api/v1/digest/send` | 手動觸發 AI 選股 Email | ✅ 正常 |
| `GET /api/v1/fundamental/{symbol}` | P/E、EPS、殖利率、Beta、市值 | ✅ 正常 |
| `GET /api/v1/dividends/{symbol}` | 股利歷史近 10 年 | ✅ 正常（本次新增）|
| `GET /api/v1/financials/{symbol}` | 財務報表趨勢 10 年 | ✅ 正常 |
| `GET /api/v1/valuation-band/{symbol}` | PE/PB 歷史估值帶 | ✅ 正常 |
| `GET /api/v1/peer-comparison/{symbol}` | 同業比較表 | ✅ 正常 |
| `GET /api/v1/monthly-revenue/{symbol}` | 月營收走勢 | ✅ 正常 |
| `GET /api/v1/foreign-holding/{symbol}` | 外資持股比例走勢 | ✅ 正常 |
| `WS /ws/quotes` | 即時行情 WebSocket | ✅ 正常 |

---

*最後更新：2026-06-07 by Claude*
