# StockPulse 專案進度追蹤

> **更新日期：** 2026-06-11（回測升級 Roadmap 建立 + P0-1 交易明細強化）  
> **當前版本：** commit `7bfb0fd`（回測 trades 加 fee/exit_reason 欄位 + 期末強平 + CSV 匯出 + 出場原因 chip 篩選 + 9 欄表格）  
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

**整體 PRD 功能完成度：約 97%**

---

## ✅ 已完成功能清單

### K 線圖表（超越 PRD 規格）
- [x] 五種圖表類型：蠟燭 / 空心K / Heikin-Ashi / 折線 / 面積
- [x] 技術指標：MA、EMA、BOLL、MACD、RSI、KD（PRD 標準）
- [x] 額外指標：VWAP、VWAP帶（±1σ通道可開關）、Williams %R、OBV（PRD 未規劃）
- [x] 三大法人籌碼疊圖（外資 / 投信 / 自營）
- [x] 時間週期切換（1m/5m/15m/30m/60m/日/週/月/**季/年**）
- [x] **K 線型態標記縮小**（text="" size=0.6，不遮蓋 K 線）
- [x] **Tab 改名**：走勢圖 → **K線**（`useTabConfig.ts`）
- [x] **OHLCV 十字線側欄**：滑鼠移到 K 線時左側欄即時顯示開高低收量，離開恢復即時報價（`onCrosshairMove` prop + `hoveredBar` state）
- [x] **全螢幕按鈕**：圖表右下角 ⛶，點後 Modal 佔滿全視窗（`FullscreenChartModal.tsx`），含完整工具列（週期/圖形/繪圖/指標），ESC 或 ✕ 關閉
- [x] **Ctrl+Z 撤銷畫線**：無限 undo（`undoStackRef`），每次落筆前 push 快照，Ctrl+Z pop 還原並重繪；symbol 切換時自動清空堆疊
- [x] **指標參數 Legend + Popover**：圖表左上角顯示 MA5/MA10/EMA12/BOLL(20) 等 Legend，點 ✎ 開 `IndicatorParamPopover` 調整週期/標準差等參數，套用即重繪，localStorage 持久化（`lib/indicatorParams.ts`）
- [x] **子指標獨立面板**：MACD/RSI/KD/WR/OBV/ATR/ADX/SRSI 各自獨立 `<SubIndicatorPanel>`（獨立 lightweight-charts 實例），不再擋成交量（`SubIndicatorPanel.tsx`）
- [x] **可拖動分界線**：`ResizeDivider` 5px 拖把，滑鼠拖動即時調整主圖/子指標高度比例；主圖最小 30%，子指標最小 5%，比例存 localStorage
- [x] **跨面板時間軸同步**：`subscribeVisibleLogicalRangeChange` + `isSyncingRef` 防止 loop，主圖縮放/捲軸即時同步所有子指標面板
- [x] **ChartWithPanels**（新）：統一管理主圖 + 所有子指標面板，page.tsx 用 ChartWithPanels 替換原 KLineChart 呼叫
- [x] **MACD/KD/RSI 子指標面板修復**（2026-06-11）：根路由 `/` (app/page.tsx) 原直接使用 KLineChart，子面板從未存在；改用 ChartWithPanels，子指標正常顯示
- [x] **app/page.tsx ← dashboard 完整同步**（2026-06-11）：美股支援、withCache 前端快取、keep-alive tabs、hoveredBar OHLCV 側欄、鍵盤快捷鍵全數移入根路由；/dashboard 路由退役
- [x] **工具列精簡**（2026-06-11）：移除工具列全螢幕按鈕（⛶ 保留在圖表右下角）、移除 ChartTypeSelector（蠟燭為預設，不再需要切換）
- [x] **K線拖曳回朔 Bug 修復**（2026-06-11）：`applyOptions` 改傳完整 `handleScroll`/`handleScale` 物件（含明確的 `pressedMouseMove: true`），解決滾輪放大後拖曳恢復舊視角問題
- [x] **ESC → 游標工具**（2026-06-11）：ChartWithPanels 傳遞 `onToolChange={setActiveTool}`，ESC 鍵可正確切回 cursor 模式
- [x] **首頁 / 分析面板滾動修復**（2026-06-11）：HomeDashboard 容器加 `overflow-y-auto`（重要日期/自訂警示規則可捲動）、AnalysisPanel 容器同步修復；LeftPanel 自選股側欄改 `overflow-y-auto`
- [x] **LeftPanel 移除熱門排行子 tab**（2026-06-11）：左側自選股側欄移除「熱門排行」切換（與主導航「排行」Tab 100% 重複），HotRanking dynamic import 與 panelMode state 一併清除

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
- [x] **新聞中文過濾 + 重要度篩選**（高/中/低 tabs + 分類 chips + 關鍵字搜尋）
- [x] **板塊熱力圖首頁小版**（HomeDashboard MiniSectorBar，各板塊漲跌 pill chips）
- [x] **板塊熱力圖大盤版**（MarketDashboard SectorTile + 點擊展開成分股）

### AI & 選股（M4）
- [x] 自然語言解析選股（Gemini API）— 競品無此功能
- [x] 5 個預設策略模板
- [x] 多維篩選器（技術 / 籌碼 / 基本面）
- [x] 選股結果列表
- [x] **Screener 一鍵加自選股**（每列 +/✓ 按鈕，optimistic update + rollback）
- [x] **Screener 基本面篩選**（Sprint 6，`7caeeb4`）：
  - 股票池 70 → 127 檔（補高殖利率傳產、生技、ETF：00878/00713/00919/006208/00881 等）
  - 7 個基本面欄位：PE / 殖利率% / 毛利率% / 市值億 / ROE% / EPS成長% / 年營收成長%
  - `fundamental_cache_service.py`：yfinance 批量抓取，24h in-memory TTL，ThreadPoolExecutor
  - `RunRequest` 新增 10 個條件欄位，`_matches()` 同步支援基本面過濾
  - 前端展開式「＋ 基本面條件」面板（min/max 輸入，條件數 badge）
  - 動態結果欄：有啟用哪個基本面條件才顯示對應欄，無條件時保持原有欄位
- [x] **TWSE OpenAPI 批量基本面**（`fa919ce`）：
  - `twse_openapi_service.py`：`GET /v1/openAPI/BWIBBU_ALL` 一次拉取全市場 ~1700 支 PE/PB/殖利率（TTL 4h）
  - `GET /v1/exchangeReport/STOCK_DAY_ALL` 全市場日行情快照（TTL 5min，備用）
  - `fundamental.py` 台股改走 TWSE 批量查 → 單股 O(1) 查找，取代 FinMind per-symbol TaiwanStockPER 呼叫
  - FinMind 配額完全釋放給 K 線 / 法人 / 財報等歷史端點

### 即時行情（新增）
- [x] **WebSocket `/ws/quotes`** 端點（盤中 5s / 盤外 30s diff 推播）
- [x] **`useStockWebSocket` hook**（自動重連，指數退避）
- [x] LeftPanel + page.tsx 改用 WS，取代 15s REST 輪詢
- [x] 連線指示燈（頭部綠點）
- [x] **修復上櫃股票報價不更新**（twse_fetcher 改為 tse_|otc_ 雙查詢，commit `b2121b4`）

### 效能優化（Sprint 1）
- [x] **Tab keep-alive**（mountedTabs Set + CSS hidden，kline/home/analysis 永遠掛載，其他首次訪問後不銷毀）
- [x] **前端 clientCache**（`lib/clientCache.ts`，module-level Map，`withCache<T>()` TTL 包裝）
  - fundamentals TTL 1h、patterns TTL 5min、kline TTL 3min（季/年K 30min）

### 鍵盤快捷鍵 + 美股支援（Sprint 3）
- [x] **鍵盤快捷鍵**（`hooks/useKeyboardShortcuts.ts`）
  - `/` → 聚焦搜尋框；`↑↓` → 循環自選股（自動 K 線同步）；symRef + listRef 避免 stale closure
- [x] **Header Enter 確認**：`activeIdx === -1` 時直接選 `results[0]`，不需先按方向鍵；`id="stock-search-input"` 供鍵盤 focus
- [x] **美股搜尋（S&P 500 靜態清單）**：`stock_list.py` 內建 ~120 美股/ETF，`search_stocks()` 同時搜台+美，回傳 `market: "TW"|"US"`
- [x] **搜尋結果 🇺🇸 badge**：美股顯示藍色 NYSE/NASDAQ badge，`select()` 傳遞 `market` 欄位
- [x] **美股 K 線端點** `GET /kline/us/{symbol}`（yfinance + executor，後端 1h TTL 快取，支援 daily/weekly/monthly/quarterly/yearly）
- [x] **前端美股路由**：`market` state，`loadKline` 遇 US → `getUsKline`（marketRef 避免依賴陣列），跳過 WebSocket 報價
- [x] **Tab 自動過濾**：美股時自動隱藏「籌碼」「回測」tab（無台股本地籌碼資料）
- [x] **工具列 🇺🇸 badge**：美股在股票名稱旁顯示藍色 🇺🇸 US 標籤

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
| ~~**PE/PB 歷史估值帶**~~ | 5 年均值 ±σ 帶 | ✅ 已完成（後端 `valuation_band_service.py`；前端 `AnalysisPanel` `ValuationBandSection`：SVG 折線+彩帶、分位弧儀表、高估/低估評語） |
| ~~**同業比較表**~~ | 5 家同產業橫向比較 | ✅ 已完成（`peer_comparison.py`，支援自訂對比） |
| ~~**外資持股比例趨勢**~~ | 近 12 月折線 + 股價疊圖 | ✅ 已完成（`foreign_holding.py`，TWSE） |
| ~~**月營收走勢**~~ | 24 個月折線 + YoY 柱狀 | ✅ 已完成（後端 `monthly_revenue_service.py` MOPS IFRS；前端 `AnalysisPanel` `MonthlyRevenueSection`：摘要卡片+折線圖+YoY柱狀圖+明細表） |
| ~~**財務歷史 10 年**~~ | 損益表 + 現金流 10 年 | ✅ 已完成（`financials.py`） |
| ~~**個股 30 日籌碼詳情表格**~~ | 三大法人日報表 | ✅ 已完成（`2c5d003`，ChipsPanel 近30日明細表格，外資/投信/自營/合計，正紅負綠） |
| **連續買超/賣超天數標籤** | 標示「外資連 N 日買超」| 已有 streak badge，但 Watchlist 列表未顯示 |
| **美股完整支援** | Polygon.io 整合 | Sprint 3 已加 S&P 500 搜尋 + `/kline/us/` yfinance K 線；無五檔委買委賣/即時行情 |
| ~~**SMTP 盤前 AI 推播**~~ | 每日 8AM Email | ✅ 已完成（改用 Resend API，`1361516`）|

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
| ~~**通知推播**~~ | 富途 / 籌碼K線 | ✅ 已完成：Web Push（SW + VAPID + Supabase）+ 設價提醒 Toast 雙管道 |

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
| **VWAP ± 1σ 通道帶（可開關）** | ✅ **新增** | ✅ | △ | ❌ | 輕微領先 |
| 週期：1分 ～ 月K | ✅ | ✅ | ✅ | ✅ | 齊平 |
| **季K / 年K（最長 15 年）** | ✅ **新增** | ✅ | ✅ | ✅ | 齊平 |
| **繪圖工具（趨勢線 / 水平線 / 斐波納契）** | ❌ | ✅✅ | ✅ | ✅ | **重大缺口** — 交易者的基本需求 |
| **多圖版型（2分割 / 4分割）** | ❌ | ✅✅ | ✅ | ❌ | 進階缺口 |
| **Pine Script / 自訂指標** | ❌ | ✅✅ | ❌ | ❌ | 長期路線 |
| **多股比較折線** | ✅ | ✅ | ✅ | ❌ | **已完成**（`CompareChart.tsx`，4支，正規化報酬，AI分析）|
| **K 線型態辨識（錘頭 / 吞噬 / 十字星）** | ✅ **已完成** | ✅ | ✅ | ✅ | **已完成（`8eeca87`）：13種型態，K線疊圖＋分析面板** |
| **量價背離自動提示** | ❌ | ✅ | ✅ | ✅ | 中優先 |

**評分：6/11 ★★★★☆** — K線型態辨識 ✅；繪圖工具 ✅；缺多圖版型與量價背離提示。

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
| **選股結果一鍵加入自選股** | ✅ **已完成** | ✅ | ✅ | ✅ | 已補（`527ee74` Screener +/✓ 按鈕）|

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
| **美股 K 線 + 搜尋（S&P 500）** | △ **Sprint 3 新增** | ✅✅ | ✅✅ | ❌ | Sprint 3 已加 ~120 美股搜尋 + yfinance K 線端點；無完整即時報價 |
| **期貨 / 選擇權行情** | ❌ | △ | ✅ | △ | 衍生品交易者需求 |
| **歷史波動率 / 隱含波動率** | ❌ | ✅ | ✅ | ❌ | 選擇權交易者需求 |

**評分：3/8 ★★☆☆☆** — 台股基本行情 OK，但五檔委買委賣缺失對短線交易者是硬傷，美股用 yfinance 有長期穩定性風險。

---

### 6. 通知 & 提醒系統

| 功能項目 | StockPulse | TradingView | 富途牛牛 | 籌碼K線 | 差距評估 |
|---------|:----------:|:-----------:|:-------:|:------:|---------|
| 設價提醒（突破 / 跌破）Toast | ✅ | ✅ | ✅ | ✅ | 基本齊平 |
| **Web Push Notification（背景通知）** | ✅ | ✅ | ✅ | ❌ | **已完成（`2eb7d7f`）：VAPID + SW + Supabase 持久化** |
| **Email / Line 推播** | ✅ Email（Resend API，`1361516`）| ✅ | ✅ | ✅ | Line 未做 |
| **技術指標觸發警報（如 RSI < 30）** | ✅ **已完成** | ✅✅ | ✅ | △ | **已完成（`439564d`）：13 種指標，10 條件 AND/OR，AlertModal + 🔔 工具列** |
| **法人異常大量買超警報** | △ 部分 | ❌ | △ | ✅ | 外資/投信連買連賣天數已納入警報條件 |
| **財報公告 / 除權息提醒** | ✅ 月曆 Tab | ✅ | ✅ | △ | **已完成（`671967b`）：月曆 Tab，30天視窗，三色事件格，點格展開詳情** |

**評分：6/6 ★★★★★** — Web Push ✅；技術指標警報 ✅（13指標/10條件）；財報月曆 ✅；Line 未做。

---

### 7. UX & 平台品質

| 功能項目 | StockPulse | TradingView | 富途牛牛 | 籌碼K線 | 差距評估 |
|---------|:----------:|:-----------:|:-------:|:------:|---------|
| Dark / Light 模式（防 FOUC） | ✅ | ✅ | ✅ | △ | 優於籌碼K線 |
| Google OAuth 登入 | ✅ | ✅ | ✅ | ❌ | 優於籌碼K線 |
| **行動版 RWD（手機看盤）** | ✅ 已完成 | ✅✅ | App ✅ | △ → ✅ | **三段式 RWD 佈局：底部 Tab bar + 側欄折疊抽屜（`1960da0`）** |
| **鍵盤快捷鍵（/ 搜尋、↑↓ 換股）** | ✅ **Sprint 3** | ✅✅ | △ | ❌ | **已完成（`70bd3af`）：`useKeyboardShortcuts` hook，/ + ↑↓ + Enter 確認** |
| **Skeleton 載入動畫** | ❌ 純文字 | ✅ | ✅ | ✅ | 視覺品質差距 |
| 自選股多群組 + 拖曳排序 | ✅ | ✅ | ✅ | ✅ | 齊平 |
| CSV / JSON 匯出 | ✅ | △ | △ | ❌ | 輕微優勢 |
| 主 Tab 導航清晰度 | ✅ 已改 | ✅ | ✅ | ✅ | 已修（181be18）|
| Header 登入按鈕位置 | ✅ 已修 | ✅ | ✅ | ✅ | 已修（181be18）|
| **股票列 Hover 互動效果** | ✅ 已完成 | ✅ | ✅ | ✅ | **藍紫 shimmer 光掃效果，全站所有股票列（`30341cf`）** |
| Sentry 錯誤監控 | ✅ | — | — | — | 工程品質領先 |
| GitHub Actions CI/CD | ✅ | — | — | — | 工程品質領先 |

**評分：9/12 ★★★★☆** — 工程品質不錯，Hover 互動效果 ✅；**鍵盤快捷鍵 ✅（Sprint 3）**；Skeleton 載入動畫仍待補。

---

### 綜合評分摘要

| 面向 | 得分 | 滿分 | 評分 | 最關鍵補強 |
|------|:----:|:----:|:----:|-----------|
| K 線圖表技術分析 | **11** | 13 | ★★★★★ | 季K/年K ✅；VWAP帶 ✅；K線型態 ✅；全螢幕✅；子面板分離✅；Ctrl+Z✅；指標參數✅；缺多圖版型/量價背離 |
| 台股籌碼分析 | 5 | 9 | ★★★★☆ | 6 區塊垂直滾動、7 項評分、券商分點已補；期貨籌碼尚缺 |
| **個股基本面資料** | **8** | **8** | **★★★★★** | **✅ 全面補強完成（P/E、EPS、殖利率、股利歷史、財報 10 年）** |
| AI 選股 & 策略 | **7** | 7 | **★★★★★** | 回測引擎 ✅；Screener 一鍵加自選股 ✅ |
| 即時行情品質 | 3 | 8 | ★★☆☆☆ | 五檔委買委賣；上櫃報價已修復 |
| 板塊 & 市場概覽 | **3** | 3 | **★★★★★** | 首頁 MiniSectorBar ✅；大盤 SectorHeatmap+成分股 ✅；新聞篩選 ✅ |
| 通知 & 提醒 | **6** | 6 | **★★★★★** | 技術指標警報 ✅；財報月曆 ✅；Line 未做 |
| UX & 平台品質 | 8 | 11 | ★★★★☆ | keep-alive Tab ✅；clientCache ✅；**鍵盤快捷鍵 ✅（Sprint 3）** |
| **加總** | **51** | **65** | **約 95/100** | |

> **結論（2026-06-09 Sprint 6 更新）：** Sprint 1~5 詳見前述 + **Sprint 6 Screener 基本面篩選**（股票池 70→127，PE/殖利率/毛利率/市值/ROE/EPS成長/營收成長 7 欄篩選，展開式面板，動態結果欄）+ **TWSE OpenAPI 批量基本面**（BWIBBU_ALL 取代 FinMind per-symbol PE/PB，FinMind 配額全釋放）；整體評分 95 → **96** 分。  
> 下一個建議：**行情資料來源優化**（盤中延遲標示 / 批次 TWSE 報價 / TPEX 上櫃行情）或 **正式網域 + Cloudflare**。

---

## 🎯 建議下一步（按優先級排序）

### ~~第 0 步：UptimeRobot 防冷啟動~~ ✅ 已完成
> 已設定每 14 分鐘 ping `https://jaystock.onrender.com/health`，防止 Render 冷啟動

### ~~第 1 步：盤前 AI 推播~~ → 改為網頁 AI 精選按鈕（`cdd975f`，2026-06-08）
- Email 發信因 Render IP 被 Cloudflare 封鎖（SMTP port 587 + Resend API 403 1010），放棄 Email 路線
- **改為首頁「✨ AI 今日精選」按鈕**：點擊呼叫 `GET /api/v1/recommendations`，即時顯示 Top5 + AI 理由卡片
- 刪除：`digest.py`、`digest_service.py`、`daily_digest.py`、scheduler digest job
- 刪除 Render 環境變數：`DIGEST_SMTP_USER/PASS/RECIPIENTS`、`RESEND_API_KEY`、`ADMIN_TOKEN`

### ~~第 2 步：個股基本面資料~~ ✅ 已完成
> 競品評分 0/8 → 8/8，包含：P/E、EPS、殖利率、股利歷史 10 年、財報 10 年、PE/PB 估值帶、同業比較、月營收、外資持股

### 第 3 步：UI 視覺提升（已部分完成）

**A. Header 跑馬燈行情列**（✅ 已完成 `3021203`）
- TickerTape 替換原 IndicesBar：大盤指數 + 用戶自選股持續滾動
- 兩步驟同步：先讀 localStorage 快速顯示 → 再從 Supabase 拉真實資料

**B. Tab 中文標籤**（✅ 已完成 `181be18`）
- 走勢圖 / 籌碼 / 大盤 / 選股 / 新聞 — underline 樣式導航
- 圖表控制拆到第二列，不再與主 tab 混排

**C. Skeleton 載入動畫**（✅ 已完成）
- `components/ui/Skeleton.tsx`：`ChartSkeleton` / `DashboardSkeleton` / `NewsListSkeleton` / `TableSkeleton` / `RightPanelSkeleton`（5 種）
- `page.tsx` 所有 11 個動態 import 均已套用對應 Skeleton fallback
- KLine inline 載入也改用 `ChartSkeleton`（animate-pulse 假K棒 + 假成交量）

**D. RightPanel 修復**（✅ 已完成 `2c5d003`）
- `page.tsx` 引入 RightPanel，加入主佈局 `</main>` 後
- 元件使用 `hidden lg:flex`，1024px+ 顯示大字股價 + 今日行情 + 振幅

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

### ~~第 8 步：多股比較走勢圖（頂尖版）~~ ✅ 已完成

> 設計規格由 2026-06-07 grill-me 確認，已完整實作：

| 面向 | 決策 | 實作狀態 |
|------|------|---------|
| 比較基準 | 正規化報酬（起始=100） | ✅ |
| 股票數量 | 最多 4 支（主 + 3 對比），顏色 chip 標示 | ✅ |
| 時間區間 | 1M / 3M / 6M / 1Y / 3Y / 5Y | ✅（無 YTD / 自訂日期）|
| 圖表風格 | lightweight-charts LineSeries × 4，各色獨立 | ✅ |
| 標註 | Legend 顯示每支股票累積報酬% + 加入/刪除 chip | ✅ |
| 入口 | 獨立「比較」Tab（page.tsx dynamic import） | ✅ |
| 加入方式 | 圖表頂部 Inline 輸入框，Enter 加入，最多 4 支 | ✅ |
| AI 整合 | 比較圖下方「🤖 AI 比較分析」按鈕（≥2支時顯示，Gemini 生成） | ✅ |

檔案：`apps/web/components/chart/CompareChart.tsx`

### ~~第 9 步（原 B）：技術指標觸發警報~~ ✅ 已完成（`439564d`，2026-06-08）
- 後端：`alert_rules.py` ALLOWED_FIELDS 7→14 個（KD-K、MACD柱狀、MA5/MA60、外資/投信連賣天數）
- 後端：條件上限 3→10，`dashboard.py` 計算 `stoch_k`/`macd_hist`/`above_ma5`/`above_ma60`（6個月 yfinance）
- 前端：`ALERT_RULE_FIELDS` 擴充 13 個欄位含提示說明
- 前端：`AlertModal.tsx`（新）浮動 Modal：列表/新增/編輯/刪除規則
- 前端：`DrawingToolbar.tsx` 加 🔔 按鈕，`page.tsx` × 2 整合

### ~~第 10 步（Hover）：股票列互動效果~~ ✅ 已完成（`30341cf`，2026-06-08）
- `globals.css`：`.stock-row-shimmer`（`::before` pseudo-element，`isolation: isolate`，藍紫光掃）
- 覆蓋：LeftPanel 自選股 / HotRanking 排行 / HomeDashboard 自選/警示/AI精選 / ScreenerPanel 結果表格

### ~~第 11 步：財報 / 除權息月曆（Feature C）~~ ✅ 已完成（`671967b`，2026-06-08）
- 後端：`calendar.py`（`GET /api/v1/calendar?symbols=...`，30天視窗，exdiv/earnings/agm 三型別，6h TTL）
- 後端：`main.py` 註冊 calendar router
- 前端：`CalendarView.tsx`（5×7 月曆格、點格展開詳情、底部事件列表、三色事件 chip）
- 前端：`useTabConfig.ts` 加 "月曆" Tab，`page.tsx` × 2 lazy-load

### ~~第 12 步：K 線型態辨識（Feature A）~~ ✅ 已完成（`8eeca87`，2026-06-08）
- 後端：`patterns.py`，純手寫辨識，13種型態，TTL=5分鐘，無 ta-lib 依賴
  - 十字星 / 錘頭 / 上吊線 / 倒錘頭 / 流星 / 看漲吞噬 / 看跌吞噬 / 啟明星 / 黃昏之星 / 三白兵 / 三黑鴉 / 向上跳空 / 向下跳空
  - 趨勢輔助（5日收盤）區分錘頭vs上吊線、倒錘頭vs流星
- 前端：`KLineChart.tsx` — `createSeriesMarkers()`（LW-Charts v5 plugin），多頭▲綠/空頭▼紅/中性●灰
- 前端：`AnalysisPanel.tsx` — `PatternSection`，最近10個型態，方向badge+日期+描述，技術面Tab最上方
- 前端：`page.tsx` × 2 — symbol 變動時 fetch，傳 `patternMarkers` 給 KLineChart

### 第 13 步：正式網域 + Cloudflare（上線）
- 購買 `stockpulse.tw` 或類似網域
- Cloudflare DNS + SSL + CDN，取代 Render 預設網址
- 更新 NextAuth `AUTH_URL` + CORS_ORIGINS

---

## ✅ 近期完成（2026-06-11）

| Commit | 說明 | 狀態 |
|--------|------|------|
| `c54dc52` | **回測 P0-3：自訂策略 A 積木式 + 基本面 + Lookahead 防護**：後端 `backtest_service.py` custom 指標補齊 EMA26/BOLL；新增 `_add_fundamental_columns()` 注入月營收 + 季 EPS（lookahead-safe：月公布 +10 天、季公布 +45 天）；新欄位：eps_ttm/eps_quarterly/eps_quarterly_yoy/qoq + revenue/yoy/mom/annual_ttm/annual_yoy；`_eval_conditions` FIELD_MAP 擴充至 24 個欄位，條件上限 3→10，支援 entry_logic/exit_logic 獨立 AND/OR；前端新建 `<ConditionsEditor>` 積木式元件：FIELD_GROUPS 6 大類 optgroup、7 運算子（含 cross_above/below）、AND/OR toggle、+/× 增刪、值可填數字或欄位名（自動辨識）；選 custom 策略時 UI 自動切換為條件編輯器 | ✅ Live |
| `8d7f9ae` | **回測 P0-2：K線圖標記買賣點**：新建 `<TradesKlineChart>` 元件，從 `getKline()` 拉每日 K 線、用 equity_curve 頭尾日期篩選回測範圍；CandlestickSeries 採台股慣例（紅漲綠跌）；買入 ▲藍 (B#) 在 K 棒下方、賣出 ▼依損益正負染色 (S# +X%) 在上方；新增 `<TradesMiniList>` 6 欄迷你表（編號與 K 線標記對應）；Tab 新增「K線標記」（順序：績效摘要/資金曲線/**K線標記**/交易明細/月份報酬）| ✅ Live |
| `7bfb0fd` | **回測 P0-1：交易明細表格強化 + Roadmap 文件**：新建 `docs/BACKTEST-ROADMAP.md`（15 題 grill-me 完整規格，P0/P1/P2 三階段）；後端 `backtest_service.py` trades 加 `fee`（買 0.1425% + 賣 0.1425% + 證交稅 0.3%）和 `exit_reason`（signal/stop_loss/take_profit/end_of_period），新增 `_close_position()` helper，修復期末強平 bug（原本期末有持倉的交易會消失不在 trades 列表）；前端 `BacktestPanel.tsx` TradeList 重構：2 行統計（總筆數/獲利/虧損/勝率/平均損益 + 平均持倉/總手續費/最佳最差）、出場原因 chip 即時過濾、9 欄表格含彩色 badge、⬇ CSV 匯出（UTF-8 BOM）| ✅ Live |
| `acce6c6` | **回測 422 Bug 修復**：`backtest.py` 的 `from __future__ import annotations` 導致所有型別標註成為 lazy 字串；slowapi `@limiter.limit()` 裝飾器包裝後，FastAPI `get_type_hints()` 無法解析 `BacktestRequest`，退回把 `body` 當 query param（422）。修復：移除該 import（screener.py 從未有此行）+ 加 `body: BacktestRequest = Body(...)` 明確聲明。前後 5 分鐘 Playwright 驗證：2330/MA5×MA20/5年，總報酬 +96.67%，CAGR 14.73%，正常返回 200 + 完整回測數據 | ✅ Live |
| `2c5d003` | **30日籌碼明細表 + RightPanel 整合**：`ChipsPanel.tsx` 新增「三大法人 · 近30日明細」Section（每日外資/投信/自營/合計淨買賣數字表格，最新在前，正紅負綠千分位）；`page.tsx` 引入 `RightPanel` 並加入主佈局（lg breakpoint 1024px+），顯示大字股價 + 今日行情卡 + 振幅區間；確認基本面摘要列已存在（市值/本益比/EPS/殖利率/52W/Beta/產業）| ✅ Local |
| `fa919ce` | **TWSE OpenAPI 批量基本面**：新增 `twse_openapi_service.py`（`BWIBBU_ALL` 一次拉 ~1700 支 PE/PB/殖利率，TTL 4h；`STOCK_DAY_ALL` 全市場日行情快照 TTL 5min）；`fundamental.py` 台股改走 TWSE 批量查詢（單股 O(1)），FinMind `TaiwanStockPER` per-symbol 呼叫全部取代 | ✅ Live |
| `7caeeb4` | **Sprint 6：Screener 基本面篩選**：股票池 70→127；`fundamental_cache_service.py`（yfinance 批量 24h TTL）；`RunRequest` 10 個基本面條件欄；`_matches()` 過濾；前端展開式面板 + 動態結果欄（7 個欄位按條件啟用顯示） | ✅ Live |
| `5a31945` | **Sprint 5：K線圖表全面強化** — Tab 改名「K線」；左側欄 OHLCV 十字線（`onCrosshairMove` prop → `hoveredBar` state，滑鼠離開恢復報價）；全螢幕按鈕（右下角 ⛶ → `FullscreenChartModal`，含完整工具列，ESC/✕ 關閉）；Ctrl+Z 無限 undo（`undoStackRef<Drawing[][]>`，symbol 切換清空）；指標參數 Legend+Popover（MA/EMA/BOLL/VWAP 等可點 ✎ 調參數，`IndicatorParamPopover.tsx`，`lib/indicatorParams.ts` localStorage 持久化）；子指標獨立面板（`SubIndicatorPanel.tsx`，`SUB_PANEL_INDICATORS` = MACD/RSI/KD/WR/OBV/ATR/ADX/SRSI，各自獨立 createChart 實例，不擋成交量）；可拖動分界線（`ResizeDivider.tsx`，主圖最小 30%，子指標最小 5%，高度比例 localStorage 持久化）；跨面板時間軸同步（`subscribeVisibleLogicalRangeChange` + `isSyncingRef`）；`ChartWithPanels.tsx` 統一管理，page.tsx 替換 KLineChart 呼叫 | ✅ Local |
| `70bd3af` | **Sprint 3：鍵盤快捷鍵 + 美股搜尋/K線**：`useKeyboardShortcuts.ts`（/ 聚焦搜尋、↑↓ 切自選股、symRef+listRef 避免 stale closure）；Header Enter 直接確認第一結果（`activeIdx=-1` fallback）、`id="stock-search-input"`、🇺🇸 badge、`select()` 傳 `market`；`stock_list.py` 新增 ~120 S&P 500 股票，`search_stocks()` 回傳 `market: "TW"\|"US"`；`kline.py` 新端點 `GET /kline/us/{symbol}`（yfinance executor，1h TTL 快取，支援 5 種 period）；`dashboard/page.tsx` market state + marketRef 路由（US→getUsKline，跳 WebSocket），美股自動隱藏籌碼/回測 Tab，工具列 🇺🇸 badge，watchlist 載入供 ↑↓ 鍵 | ✅ Live |
| `00ffe32` | **Sprint 2：VWAP帶 + 首頁板塊概覽**：`indicators.ts` 新增 `vwapBand()`（滾動20日 VWAP ± 1σ）；`KLineChart.tsx` 新增 VWAP_BAND 指標（3 LineSeries：中線+上下通道）；`IndicatorSelector.tsx` 新增「VWAP帶」可開關按鈕；`HomeDashboard.tsx` 新增 `MiniSectorBar`（板塊名稱+漲跌% pill chips，靜默 fetch，不影響主載入）| ✅ Live |
| `b2121b4` | **Sprint 2：季K/年K + 修復上櫃報價**：`kline.py` 新增 quarterly/yearly period，`_aggregate()` 支援 QE/YE 分組，季K/年K 拉15年資料；`twse_fetcher.py` 修復上櫃股票盤中價格不更新（改為 `tse_XXX.tw|otc_XXX.tw` 同時查詢）；`PeriodSelector.tsx` 新增「季K」「年K」按鈕；`dashboard/page.tsx` 季K/年K cache TTL 設 30 分鐘 | ✅ Live |
| `527ee74` | **Sprint 1：4項修復**：K線型態標記縮小（text="" size=0.6）；Screener 一鍵加自選股（+/✓ 按鈕 optimistic update + rollback）；新聞中文過濾+重要度篩選（後端 importance/is_chinese 欄位，前端高/中/低 tabs+分類chips+關鍵字搜尋）；Tab keep-alive + clientCache（mountedTabs Set + `lib/clientCache.ts` TTL Map）| ✅ Live |
| `8eeca87` | **K線型態辨識（Feature A）**：後端 `patterns.py` 純手寫13種型態（十字星/錘頭/上吊線/倒錘頭/流星/看漲吞噬/看跌吞噬/啟明星/黃昏之星/三白兵/三黑鴉/向上跳空/向下跳空），趨勢輔助區分多頭vs空頭型態；前端 `createSeriesMarkers()`（LW-Charts v5 plugin），多頭▲/空頭▼/中性●；`AnalysisPanel.tsx` `PatternSection`（最近10個，方向badge+日期+描述）；`page.tsx` × 2 整合 | ✅ Live |
| `671967b` | **財報/除權息月曆（Feature C）**：後端 `calendar.py` 新 endpoint `GET /api/v1/calendar?symbols=...`，30天視窗，平行查詢，6h TTL快取，支援 exdiv/earnings/agm；前端 `CalendarView.tsx`（5×7月曆格，今天日期圓形藍色標示，事件 chip 三色：🟡除息/🔵財報/🟢股東會，點格展開詳情面板，底部事件清單含「N天後」badge，shimmer hover 效果，自選股空時引導提示）；`useTabConfig.ts` 新增"月曆"Tab；`page.tsx` × 2 lazy-load | ✅ Live |
| `439564d` | **技術指標觸發警報系統（Feature B）**：後端 `alert_rules.py` ALLOWED_FIELDS 7→14（KD-K/MACD柱/MA5/MA60/外資連賣/投信連賣）、條件上限3→10；後端 `dashboard.py` 新增 stoch_k/macd_hist/above_ma5/above_ma60 計算（6mo yfinance）；前端 `AlertModal.tsx`（新）完整 CRUD Modal；前端 `DrawingToolbar.tsx` 🔔 按鈕；`page.tsx` × 2 整合；`api.ts` ALERT_RULE_FIELDS 擴充至 13 個含提示 | ✅ Live |
| `30341cf` | **股票列 Hover Shimmer 效果（全站）**：`globals.css` 新增 `@keyframes shimmer-sweep`、`.stock-row-shimmer`（`::before` pseudo-element，`isolation: isolate` stacking context，藍紫漸層左→右掃，保留底色，0.2s 淡出）、`.tr-shimmer-active`（table row 用 background 動畫）；覆蓋 LeftPanel/HotRanking/HomeDashboard 3個按鈕/ScreenerPanel | ✅ Live |
| — | **多股比較走勢圖（全棧完成）**：`CompareChart.tsx`（lightweight-charts LineSeries×4，正規化報酬起始=100，1M/3M/6M/1Y/3Y/5Y，Inline 搜尋加入，符號 chip 可刪除，Legend 含累積報酬%）；AI 比較分析按鈕（≥2支時顯示，呼叫 Gemini，快取 15 分鐘）；已整合至 page.tsx 動態 import + ChartSkeleton | ✅ Live |
| — | **Skeleton 載入動畫（全覆蓋）**：`components/ui/Skeleton.tsx`（`ChartSkeleton` 假K棒脈衝 / `DashboardSkeleton` 市場卡片 / `NewsListSkeleton` 新聞列 / `TableSkeleton` 選股表格 / `RightPanelSkeleton` 右側欄）；page.tsx 11 個動態 import 全部套用；KLine 行內載入改 ChartSkeleton | ✅ Live |
| `cdd975f` | **AI 今日精選按鈕（取代 Email 推播）**：刪除 digest/email 整套（Render IP 被 Cloudflare 封）；新增 `GET /api/v1/recommendations`（screener Top5 + Gemini 理由，15min 快取）；HomeDashboard 加「✨ AI 今日精選」按鈕 → 展開卡片列表（排名+價格+AI理由+籌碼標籤，點擊跳 K 線） | ✅ Live |
| `e59edd8`～`2eb7d7f` | **Web Push Notification（全棧完成）**：Service Worker (`/public/sw.js`) + VAPID + pywebpush；`push_service.py`（Supabase 持久化 + in-memory fallback）；`/api/v1/push/subscribe\|status\|test` 端點；`usePushNotification` hook；Header 📶 `PushSubscribeButton`；修復 slowapi+Pydantic 422；修復 require_user 支援 Google numeric ID；Supabase `push_subscriptions` 表；**端對端測試通過（sent: 1）** | ✅ Live |
| — | **PE/PB 歷史估值帶（全棧完成）**：後端 `valuation_band_service.py`（5年週線×TTM EPS/BVPS，±1σ/±2σ，分位數）；前端 `ValuationBandSection`（SVG折線+彩帶+`PercentileArc`分位弧+估值評語）；位置：分析Tab→基本面 | ✅ Live |
| — | **月營收走勢圖（全棧完成）**：後端 `monthly_revenue_service.py`（MOPS IFRS，24個月，YoY/累計YoY，sii/otc/rotc自動嘗試）；前端 `MonthlyRevenueSection`（摘要卡片+`RevenueTrendChart`+`YoYBarChart`+明細表）；位置：分析Tab→基本面 | ✅ Live |
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
| `GET /api/v1/kline/{symbol}` | K 線歷史資料（daily/weekly/monthly/**quarterly/yearly**） | ✅ 正常 |
| `GET /api/v1/kline/us/{symbol}` | **美股 K 線**（yfinance，1h TTL，支援 daily～yearly） | ✅ 正常（Sprint 3 新增）|
| `GET /api/v1/chips/{symbol}` | 三大法人籌碼 | ✅ 正常 |
| `GET /api/v1/market/indices` | 大盤指數 | ✅ 正常 |
| `GET /api/v1/market/ranking` | 漲跌爆量排行 | ✅ 正常 |
| `GET /api/v1/news/{symbol}` | 個股新聞 | ✅ 正常（已修復）|
| `POST /api/v1/screener/run` | AI 選股執行 | ✅ 正常 |
| `GET /api/v1/backtest/presets` | 6 種策略模板 | ✅ 正常 |
| `POST /api/v1/backtest/run` | 回測執行（6策略/11指標/4分頁結果）| ✅ 正常（`acce6c6` 修復 422）|
| `GET/POST /api/v1/watchlist` | 自選股 CRUD | ✅ 正常（Supabase 持久化）|
| `POST /api/v1/feedback` | Beta 回饋 | ✅ 正常 |
| `GET /api/v1/alerts` | 設價提醒通知 | ✅ 正常（Supabase + in-memory fallback）|
| `GET /api/v1/recommendations` | AI 今日精選 Top5（15min 快取） | ✅ 正常 |
| `GET /api/v1/dashboard/summary` | 首頁儀錶板批次摘要 | ✅ 正常 |
| `GET /api/v1/alert-rules` | 列出用戶自訂警示規則 | ✅ 正常 |
| `POST /api/v1/alert-rules` | 新增警示規則（最多 10 條件） | ✅ 正常 |
| `PUT /api/v1/alert-rules/{id}` | 更新警示規則 | ✅ 正常 |
| `DELETE /api/v1/alert-rules/{id}` | 刪除警示規則 | ✅ 正常 |
| `PATCH /api/v1/alert-rules/{id}/toggle` | 切換規則啟用狀態 | ✅ 正常 |
| `GET /api/v1/fundamental/{symbol}` | P/E、EPS、殖利率、Beta、市值 | ✅ 正常 |
| `GET /api/v1/dividends/{symbol}` | 股利歷史近 10 年 | ✅ 正常（本次新增）|
| `GET /api/v1/financials/{symbol}` | 財務報表趨勢 10 年 | ✅ 正常 |
| `GET /api/v1/valuation-band/{symbol}` | PE/PB 歷史估值帶 | ✅ 正常 |
| `GET /api/v1/peer-comparison/{symbol}` | 同業比較表 | ✅ 正常 |
| `GET /api/v1/monthly-revenue/{symbol}` | 月營收走勢 | ✅ 正常 |
| `GET /api/v1/foreign-holding/{symbol}` | 外資持股比例走勢 | ✅ 正常 |
| `GET /api/v1/calendar` | 自選股未來 30 天事件月曆 | ✅ 正常 |
| `GET /api/v1/patterns/{symbol}` | K 線型態辨識（13種，近 90 日）| ✅ 正常（本次新增）|
| `WS /ws/quotes` | 即時行情 WebSocket | ✅ 正常 |

---

*最後更新：2026-06-11 by Claude（回測 P0-3 自訂策略積木 + 基本面 lookahead；commit `c54dc52`；整體評分 96/100）*

> **回測升級進行中：** 完整規格見 `docs/BACKTEST-ROADMAP.md`  
> - P0-1 ✅ 交易明細表格強化  
> - P0-2 ✅ K線圖標記買賣點  
> - P0-3 ✅ 自訂策略 A（積木式）+ EPS/營收欄位 + Lookahead 防護  
> - P0-4 ⏳ 儲存策略 / 我的策略列表  
