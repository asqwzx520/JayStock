# StockPulse — 功能待辦清單（競品差距補強）

> 最後更新：2026-06-05（P2 #9 AI技術分析解讀 + #14 多股比較 + #10 Earnings Surprise）
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

### [ ] 13. Web Push 通知（價格警報推送）⏸️ 暫緩
- 到價警報目前只在開網頁時有效，需要 Service Worker + VAPID
- 讓用戶手機直接收推播
- 難度：高
- **優先度：最低（P3）— 暫不實作，待其他功能穩定後再評估**

### [x] 14. 多股比較走勢圖
- 同時顯示 2~4 支股票的正規化報酬走勢（起始日 = 100），做相對強弱比較
- 後端：`GET /api/v1/compare?symbols=2330,2317&period=1y`，快取 5 分鐘
- 前端：新增「比較」主 tab，lightweight-charts 多線疊加，支援 1M/3M/6M/1Y/3Y/5Y

---

## ✅ 已完成的差異化優勢（競品沒有或較弱）

| 功能 | 說明 |
|------|------|
| AI 策略回測（6種策略+11項指標） | 比 Yahoo Finance 更強，免費 |
| 三大法人 K 線疊圖 | 視覺化法人籌碼 |
| WebSocket 即時行情 | 比大多數免費網站更即時 |
| AI 盤前選股推播 | 競品多為付費功能 |
| 繪圖工具 localStorage 持久化 | 切換股票後線段保留 |
| 完整回測引擎 + 月份報酬熱力圖 | 免費平台罕見 |
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

---

## 完成後預估評分

| 面向 | P0 完成後 | P0+P1 完成後 |
|------|----------|------------|
| 技術分析 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 基本面 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 台股專屬 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **整體** | **超過 Yahoo Finance 免費版** | **接近富途牛牛免費版** |
