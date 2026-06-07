# StockPulse — 功能待辦清單（競品差距補強）

> 最後更新：2026-06-07（確認 Valuation Band / 月營收 / Web Push 前後端均已完整實作；補充前端細節）
> 依據：與 TradingView、Yahoo Finance、富途牛牛、鉅亨網、台灣股市資訊網的競品差距分析

---

## 評分基準（2026-06-05 更新後）

| 面向 | 現況 | 目標 |
|------|------|------|
| 技術指標數量 | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 繪圖工具 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 基本面深度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 台股專屬數據 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 同業比較 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 歷史估值帶 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## 🔴 P0 — 關鍵缺口（立刻做，用戶感受最強）

### [x] 1. 月營收走勢圖（台股最重要月度數據）✅ 已完成
- **重要性**：台股投資人每月 10 日等月營收，是判斷成長動能的核心指標
- **競品**：鉅亨網、Goodinfo、富途牛牛 都有
- **實作**：
  - 後端：`apps/api/app/api/v1/monthly_revenue.py` + `services/monthly_revenue_service.py`
    - 從 MOPS IFRS API 抓近 24 個月，含 YoY%、累計 YoY%、去年同月對比
    - 自動嘗試 sii → otc → rotc，支援台灣上市/上櫃/興櫃；美股回傳 `is_tw: false` 說明
    - TTL 86400 秒（每日快取）
  - 前端：`apps/web/components/analysis/AnalysisPanel.tsx`（`MonthlyRevenueSection`）
    - 摘要卡片：最新月營收（億）、單月 YoY%、累計 YoY%、環比月增率
    - `RevenueTrendChart`：24 個月 SVG 折線圖（含去年同月灰虛線對照）
    - `YoYBarChart`：單月 YoY 成長率柱狀圖（綠漲紅跌）
    - 月營收明細表（近 12 個月，含去年同月、單月 YoY、累計 YoY）
  - 位置：分析 Tab → 基本面 子 Tab（`ValuationBandSection` 之後）
- **難度**：中（已完成）

---

### [x] 2. PE / PB 歷史估值帶（Valuation Band）✅ 已完成
- **重要性**：讓用戶知道「現在是貴還是便宜」，富途牛牛最受歡迎的功能之一
- **競品**：富途牛牛、CMoney、股魚
- **實作**：
  - 後端：`apps/api/app/api/v1/valuation_band.py` + `services/valuation_band_service.py`
    - 5 年週線收盤價（yfinance）× 季度 Net Income / Shares → 滾動 TTM EPS → 歷史 PE
    - 季度 Stockholders Equity / Shares → BVPS → 歷史 PB
    - 計算 mean ± 1σ / ±2σ 帶、當前分位數（百分比）
    - TTL 86400 秒（每日快取）
  - 前端：`apps/web/components/analysis/AnalysisPanel.tsx`（`ValuationBandSection`）
    - `ValuationBandChart`：SVG 折線圖，PE/PB 歷史走勢 + ±1σ/±2σ 彩帶 + 當前虛線
    - `PercentileArc`：半圓弧分位數儀表（當前估值在 5 年中的歷史百分位）
    - `ValuationCard`：當前值、5 年均值、±1σ 正常區間、「偏高估/中性/偏低估」評語
    - PE（紫色 `#8b5cf6`）+ PB（青色 `#06b6d4`）各自獨立卡片
  - 位置：分析 Tab → 基本面 子 Tab（`DividendHistorySection` 之後）
- **難度**：中（已完成）

---

### [x] 3. 同業比較表（Peer Comparison）
- **重要性**：Yahoo Finance、富途核心功能，用戶選 2330 會想對比三星、Intel
- **競品**：Yahoo Finance、富途牛牛
- **需要**：
  - 同產業 5 間公司橫向比較：PE / PB / ROE / 毛利率 / 市值 / 殖利率
  - 用戶可自訂對比標的
- **資料來源**：yfinance `ticker.info` 批次查詢
- **位置**：分析 tab → 基本面 → 最下方新增「同業比較」section
- **難度**：中

---

### [x] 4. 財務歷史延長至 10 年（現為 5 年）
- **重要性**：長期投資者（巴菲特派）看 10 年 ROE / EPS 趨勢
- **競品**：Yahoo Finance（10年）、Goodinfo（更長）
- **需要**：
  - 財務報表 tab 的柱狀圖從 5 年改為 10 年
  - 後端 `financials.py` 的 `[:5]` 改為 `[:10]`
- **資料來源**：yfinance（已有，只是限制了筆數）
- **難度**：低

---

## 🟠 P1 — 重要補強（差距明顯）

### [x] 5. 股利歷史（近 10 年）
- **重要性**：台灣存股族最在乎，Goodinfo 的核心賣點
- **需要**：
  - 每年配息金額 + 殖利率歷史折線圖
  - 連續配息年數標記
  - 除息日、填息日記錄
- **資料來源**：yfinance `ticker.dividends`
- **位置**：分析 tab → 基本面 → 股利區塊擴充
- **難度**：低~中
- **實作**：`apps/api/app/api/v1/dividends.py`（`GET /api/v1/dividends/{symbol}`），`AnalysisPanel.tsx` `DividendHistorySection`

---

### [x] 6. 外資持股比例趨勢（台股專屬）
- **重要性**：外資持股% 上升 = 多頭信號，台股投資人高度關注
- **競品**：鉅亨網、CMoney
- **需要**：
  - 近 12 個月外資持股比例折線圖
  - 與股價走勢疊加對比
- **資料來源**：TWSE 公開資料（每日公告）
- **位置**：分析 tab → 技術面 → 籌碼區塊
- **難度**：中

---

### [x] 7. 技術指標補強（ATR / ADX / Stochastic RSI / Ichimoku）

| 指標 | 用途 | 優先級 |
|------|------|--------|
| **ATR（真實波幅）** | 波動度量化，停損設置依據 | 高 |
| **ADX（趨勢強度）** | 判斷趨勢強弱，避免橫盤用趨勢策略 | 高 |
| **Stochastic RSI** | RSI 的 RSI，更靈敏的超買超賣 | 中 |
| **Ichimoku（一目均衡表）** | 日本技術分析主流，判斷支撐壓力 | 中 |

- **位置**：K 線圖 → IndicatorSelector 新增選項 + KLineChart.tsx 實作
- **資料來源**：前端 `lib/indicators.ts` 自算（TypeScript 純實作，Wilder 平滑法）
- **難度**：中
- **實作**：`apps/web/lib/indicators.ts`（atr / adx / stochRsi / ichimoku），`KLineChart.tsx` 子面板渲染，`IndicatorSelector.tsx` 新增按鈕

---

### [x] 8. 繪圖工具補強（4 種）

| 工具 | 重要性 | 競品 |
|------|--------|------|
| **Fibonacci 回撤** | 技術分析師必備，找關鍵回撤位 | TradingView ★★★★★ |
| **矩形框選** | 標記整理區間 | TradingView、富途 |
| **文字標籤** | 在圖上加注記 | TradingView、富途 |
| **平行通道** | 標記上升/下降通道 | TradingView |

- **位置**：`DrawingToolbar.tsx` + `KLineChart.tsx` Canvas 繪圖邏輯
- **難度**：中~高（Fibonacci 需要拖曳計算，矩形/文字較簡單）

---

## 🟡 P2 — 加分項（拉開差距）

### [x] 9. AI 技術分析解讀（結合現有 Gemini）
- 點擊「AI 解讀」→ Gemini 結合 RSI/MACD/MA 位置/法人買賣 自動生成中文分析段落
- 後端：`GET /api/v1/ai-analysis/{symbol}`，快取 15 分鐘，Gemini 失敗有規則式回退
- 前端：分析 tab 技術面頂部「🤖 AI 技術分析解讀」卡片，點擊按鈕觸發

### [x] 10. Earnings Surprise 追蹤
- 實際 EPS vs 分析師預估差距（正/負驚喜）
- 後端：`GET /api/v1/earnings/{symbol}`，快取 24 小時
- 前端：財務報表 tab 頂部 EPS 柱狀圖 + 詳細表格（含台股無預估值說明）

### [x] 11. Volume Profile（成交量分佈圖）
- 價位 vs 成交量橫向分佈，找主力成本區、關鍵支撐
- 後端：`GET /api/v1/volume-profile/{symbol}?period=3m`，50 桶分配算法，快取 15 分
- 前端：分析 tab 技術面「📊 Volume Profile」卡片，SVG 橫向 histogram
  - 標示 POC（最大量價位）、Value Area（70% 成交量上下緣）、當前價位

### [x] 12. 財報異常警示
- 後端：`GET /api/v1/financial-alerts/{symbol}`，偵測 6 大異常，快取 24 小時
  - 應收帳款/營收比連升 3 年、存貨/營收比連升 3 年
  - 連續 3 季淨利衰退、FCF < 淨利 50% 連 2 年（盈餘品質）
  - 毛利率連降 3 年、營業現金流連 2 年為負
- 前端：財務報表 tab 頂部警示卡（danger/warning 分級，綠色通過/橘紅警示）

---

## 🔵 P3 — 未來路線圖（已預留架構空間）

### [ ] 15. AI 每日自選股摘要（首頁區塊）

> 設計決策（2026-06-07 grill-me 確認）

- **觸發方式**：**按鈕觸發**（用戶點「生成摘要」才呼叫 Gemini），不自動排程
- **快取**：30 分鐘（同一用戶重複點擊直接回快取，不重複呼叫）
- **內容**：自選股昨日最強/最弱、法人異動異常、接近除息日提醒、整體籌碼氛圍
- **後端**：`POST /api/v1/dashboard/ai-summary`（帶 X-User-ID），Gemini 1.5 Flash，TTL 30 分鐘
- **前端**：首頁 Tab 內嵌區塊，「🤖 生成今日摘要」按鈕 + 上次生成時間戳 + 結果 Markdown 渲染
- **依賴**：現有 `ai_analysis.py`（Gemini 整合）+ Supabase watchlist 資料
- **難度**：中（約半天）

### [ ] 17. 個股 AI 一句話評價（K 線圖旁）

> 設計決策（2026-06-07 grill-me 確認）

- **觸發方式**：**按鈕觸發**（用戶點「AI 評價」才呼叫 Gemini），不自動執行
- **位置**：K 線圖 Toolbar 右側加「🤖」按鈕，點擊後在圖表下方展開一行評價
- **內容**：綜合技術面（RSI/MACD/均線位置）+ 籌碼面（法人買賣超方向）→ 一句話中文判斷
  - 範例：「外資連 5 日買超，MACD 翻多，技術面偏多但 RSI 接近超買區（72），短線留意回調」
- **後端**：`GET /api/v1/ai/stock-verdict/{symbol}`，Gemini 1.5 Flash，快取 15 分鐘
- **難度**：低（約 2 小時）

---

### [ ] 16. Pine Script 風格自訂公式條件
- **目標**：讓進階用戶用類程式語言撰寫警示條件，對標 TradingView Strategy/Alert
- **構想語法範例**（C 型自訂條件）：
  ```
  rsi(14) < 30 and volume > sma(volume, 20) * 2
  close > ema(close, 20) and macd() > 0
  ```
- **技術方向**：
  - 後端：自定義 Mini DSL Parser（Python），支援：指標函數（rsi/ma/ema/macd/vol）、算術運算、邏輯運算（and/or/not）、比較運算
  - 語法樹 AST 求值，安全沙箱（禁止 eval/exec）
  - 前端：CodeMirror 輕量編輯器 + 語法高亮 + 自動補全
  - Supabase 儲存 formula 字串，後端每次 dashboard 請求時即時求值
- **安全考量**：嚴格白名單函數，禁止任意 Python 執行
- **難度**：高（需設計 DSL、Parser、安全求值器）
- **優先度：P3 — 長期路線圖，待用戶需求驗證後再啟動**

---

### [x] 13. Web Push 通知（價格警報推送）✅ 已完成（`2eb7d7f`，2026-06-07）
- **後端**：`apps/api/app/api/v1/push.py` + `services/push_service.py`
  - `GET /push/vapid-public-key`、`POST /push/subscribe`、`DELETE /push/subscribe`、`GET /push/status`、`POST /push/test`
  - pywebpush 發送 VAPID 加密 Push；訂閱端點持久化至 Supabase `push_subscriptions` 表（in-memory fallback）
- **前端**：
  - `apps/web/public/sw.js`：Service Worker，處理 `push` 事件 → `showNotification`；`notificationclick` → 開啟或聚焦分頁
  - `apps/web/hooks/usePushNotification.ts`：封裝訂閱流程（`subscribe` / `unsubscribe`），自動讀取 VAPID 公鑰
  - `apps/web/components/layout/Header.tsx`：`PushSubscribeButton`，📶 圖示顯示訂閱狀態
- 設價提醒觸發 → 自動 Web Push，即使瀏覽器關閉也能收到系統通知
- **端對端測試通過**：訂閱 → Supabase 儲存 → VAPID 推播 → 裝置收到通知（`sent: 1`）

### [x] 14. 多股比較走勢圖（頂尖版）✅ 已完成

> 設計決策（2026-06-07 grill-me 確認）；已完整實作

#### 實作規格
| 面向 | 決策 | 實作狀態 |
|------|------|---------|
| **比較基準** | 正規化報酬（起始日 = 100），公平比較不同價位股票 | ✅ |
| **股票數量** | 最多 4 支（1 主股 + 3 對比），顏色 chip 區分 | ✅ |
| **時間區間** | 1M · 3M · 6M · 1Y · 3Y · 5Y | ✅（無 YTD / 自訂日期）|
| **圖表風格** | lightweight-charts LineSeries × 4，各色獨立 | ✅ |
| **標註資訊** | Legend 顯示累積報酬% + 加入/刪除 chip | ✅ |
| **加入方式** | 圖表頂部 Inline 輸入框，Enter 加入，最多 4 支 | ✅ |
| **入口位置** | 獨立「比較」Tab（page.tsx dynamic import） | ✅ |

#### 後端
- `GET /api/v1/compare?symbols=2330,2317,0050&period=1y`（`apps/api/app/api/v1/compare.py`）
- yfinance 抓歷史收盤價，正規化為起始=100 的報酬序列
- 快取 TTL 設定完成

#### 前端
- `CompareChart.tsx`：lightweight-charts LineSeries × 4，顏色 `[#3b82f6, #f59e0b, #22c55e, #f43f5e]`
- `initialSymbol` prop 支援從外部傳入主股
- 符號 chip 可刪除（symbols.length > 1 時顯示 ✕）

#### AI 整合（已完成）
- 比較圖下方「🤖 AI 比較分析」按鈕（≥ 2 支股票時出現）
- 呼叫 `getCompareAnalysis(symbols, period)` → Gemini 生成比較分析
- 快取 15 分鐘；結果可一鍵關閉

---

## ✅ 已完成的差異化優勢（競品沒有或較弱）

| 功能 | 說明 |
|------|------|
| **AI 策略回測（頂尖版，`19eb219`）** | 6 種策略（MA/RSI/MACD/KD/布林/自訂）；11 項指標（CAGR/Sharpe/Sortino/Calmar/MaxDD）；月份熱力圖；資金曲線+交易標記；台股交易成本模擬；benchmark 0050/SPY 對比。比 Yahoo Finance 更強，完全免費 |
| 三大法人 K 線疊圖 | 視覺化法人籌碼 |
| WebSocket 即時行情 | 比大多數免費網站更即時 |
| AI 盤前選股推播 | 競品多為付費功能 |
| 繪圖工具 localStorage 持久化 | 切換股票後線段保留 |
| ~~完整回測引擎 + 月份報酬熱力圖~~ | 已整合至上方「AI 策略回測（頂尖版）」條目 |
| 分析 tab（技術面+基本面+財務報表） | 整合度高 |
| P/E、EPS、殖利率、Beta 基本面卡 | yfinance 整合，覆蓋台股+美股 |
| 股利歷史近 10 年（柱狀+殖利率折線） | 存股族必備，連續配息年數標記 |
| PE/PB 歷史估值帶（5年+σ分位） | 富途牛牛熱門功能，免費實作 |
| 同業比較表（可自訂對比標的） | 中位色碼標記優/劣 |
| 月營收走勢 + YoY 柱狀圖 | 台股每月 10 日公告，MOPS 來源 |
| 外資持股比例走勢（近 12 個月） | TWSE MI_QIANW，台股專屬 |
| 行動版 RWD 三段式佈局 | 底部 Tab bar + 側欄折疊抽屜，手機看盤可用（`1960da0`）|
| **Header 大盤指數列（骨架 + 即時）** | IndicesBar 重構：Skeleton loading → 點位/漲跌點/漲跌幅三欄式顯示 |
| **Skeleton 動畫全覆蓋** | `Skeleton.tsx` 5種（`ChartSkeleton` / `DashboardSkeleton` / `NewsListSkeleton` / `TableSkeleton` / `RightPanelSkeleton`）；page.tsx 11個動態import全套用；K線inline載入改ChartSkeleton假K棒脈衝 |
| **多股比較走勢圖（頂尖版）** | `CompareChart.tsx`：最多4支股票，正規化報酬起始=100，1M/3M/6M/1Y/3Y/5Y，Inline搜尋框，Legend含累積報酬%；🤖 AI比較分析按鈕（Gemini，快取15分鐘）；已整合page.tsx比較Tab |
| **RightPanel 寬螢幕放寬** | `hidden xl:block` → `hidden lg:block`，1024px 以上即可見，含 isLoading skeleton |
| ATR / ADX / Stochastic RSI / Ichimoku 技術指標 | 前端純 TS 實作，Wilder 平滑法，Ichimoku 含時間偏移（先行/遲行帶）|
| UptimeRobot 防冷啟動監控 | 每 14 分鐘 ping /health，防 Render 閒置休眠 |
| **個人化首頁儀錶板（首頁 Tab）** | 自選股報價列表、今日警示 8 種信號、7日重要日期、自訂 AND/OR 警示規則（Supabase `user_alert_rules` 表已建立，持久化啟用）|
| **佈局架構重構（`e4381ef`）** | 移除 LeftPanel/RightPanel 固定側欄；K 線圖高度修正（`h-full`）；新增「排行」主 Tab；WorkspaceModal 拖曳排序 |
| **籌碼 Tab 全面翻新（`234cf4f`）** | 6 區塊垂直滾動；7 項加權評分環形圖（滿分 100）；三大法人累積持倉 cumsum 折線；外資持股% 雙軸圖；券商分點外資/投信/隔日沖分類（已知名單＋算法偵測）；`/chips/{symbol}/brokers?days=5/10/20` 端點；TTL 300s |
| **首頁 280px 自選股多群組側欄（`234cf4f`）** | WatchlistSidebar 嵌入首頁 Tab；TickerTape 純大盤指數；HomeDashboard 移除重複 WatchlistBlock |

---

## 完成後預估評分

| 面向 | P0 完成後 | P0+P1 完成後 |
|------|----------|------------|
| 技術分析 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 基本面 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 台股專屬 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **整體** | **超過 Yahoo Finance 免費版** | **接近富途牛牛免費版** |
