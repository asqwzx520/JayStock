# StockPulse — 功能待辦清單（競品差距補強）

> 最後更新：2026-06-06（籌碼 Tab 全面翻新、首頁 280px 自選股側欄、佈局架構重構）
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

### [x] 1. 月營收走勢圖（台股最重要月度數據）
- **重要性**：台股投資人每月 10 日等月營收，是判斷成長動能的核心指標
- **競品**：鉅亨網、Goodinfo、富途牛牛 都有
- **需要**：
  - 近 24 個月月營收折線圖
  - YoY 成長率柱狀圖（紅漲綠跌）
  - 累計營收 vs 去年同期比較
- **資料來源**：TWSE/MoPS 公開 API（免費）：`https://mops.twse.com.tw/mops/web/t05st10_ifrs`
- **位置**：分析 tab → 基本面 → 新增「月營收」區塊，或獨立子 tab
- **難度**：中

---

### [x] 2. PE / PB 歷史估值帶（Valuation Band）
- **重要性**：讓用戶知道「現在是貴還是便宜」，富途牛牛最受歡迎的功能之一
- **競品**：富途牛牛、CMoney、股魚
- **需要**：
  - 近 5 年 PE 走勢折線圖 + 歷史均值 ± 1σ 帶狀標記
  - 近 5 年 PB 走勢折線圖
  - 當前 PE 在歷史分位數（如：目前 PE 22x，高於歷史 65% 時間）
- **資料來源**：yfinance `ticker.history()` + `ticker.info` 歷史計算，或 FinMind
- **位置**：分析 tab → 基本面 → 估值區塊下方
- **難度**：中

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
- Service Worker (`/sw.js`) + VAPID 金鑰對 + pywebpush
- 訂閱端點持久化至 Supabase `push_subscriptions` 表（in-memory fallback）
- `usePushNotification` hook + Header 📶 訂閱按鈕
- 設價提醒觸發 → 自動 Web Push，即使瀏覽器關閉也能收到系統通知
- **端對端測試通過**：`sent: 1` 確認

### [ ] 14. 多股比較走勢圖（頂尖版）⬅️ 下一個目標

> 設計決策（2026-06-07 grill-me 確認）

#### 核心規格
| 面向 | 決策 |
|------|------|
| **比較基準** | 正規化報酬（起始日 = 100），公平比較不同價位股票 |
| **股票數量** | 最多 4 支（1 主股 + 3 對比），顏色清楚區分 |
| **時間區間** | 1M · 3M · 6M · YTD · 1Y · 3Y（預設快捷）+ 自訂日期輸入框（開始/結束日） |
| **圖表風格** | 粗實線 + 半透明漸層填充（線下方 15-20% 透明度），有層次感不陽春 |
| **標註資訊** | ① Crosshair 同步 Tooltip（所有股票當日報酬%）② 終點代碼+報酬%標籤 ③ 0% 基準線（水平虛線）④ 高低點 ▲▼ 標記 |
| **加入方式** | Inline 搜尋框（圖表頂部），輸入代碼或公司名，即時搜尋，加入後顯示 tag 可刪除 |
| **入口位置** | K 線圖 Toolbar 右側加「比較」按鈕，點擊切換模式（不新增 Tab） |

#### 後端
- `GET /api/v1/compare?symbols=2330,2317,0050&period=3m&start=&end=`
- yfinance 抓歷史收盤價，正規化為起始=100 的報酬序列
- 快取 TTL：盤中 5 分鐘，盤後 60 分鐘
- 同時回傳每支股票的：總報酬%、最高點日期+值、最低點日期+值、波動率

#### 前端
- `CompareChart.tsx`：lightweight-charts LineSeries × 4，自訂顏色（品牌藍 + 3 個對比色）
- 每條線的漸層填充：`createPriceLine` 或 SVG overlay
- `CompareSearchBar.tsx`：Inline 搜尋框，呼叫現有 `/api/v1/search` 端點
- `CompareLegend.tsx`：每條線的終點浮動標籤（代碼 + 報酬%）
- 整合在現有 `KLineChart.tsx` 的 Toolbar，切換模式時圖表區替換

#### AI 整合（按鈕觸發，不自動執行）
- 比較圖下方加「🤖 AI 分析這段比較」按鈕
- 呼叫 `POST /api/v1/ai/compare-analysis`，Gemini 生成：為什麼 A 跑贏 B、法人動向差異、技術面關鍵差異
- 快取 15 分鐘（同樣股票+區間不重複呼叫）

#### 難度：中（預估 1.5 天）

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
| **Skeleton 動畫全覆蓋** | 新增 `RightPanelSkeleton`；AnalysisPanel tabs 改脈衝骨架；K線/市場/選股/新聞已覆蓋 |
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
