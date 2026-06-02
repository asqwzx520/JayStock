# StockPulse 專案進度追蹤

> **更新日期：** 2026-06-03  
> **當前版本：** commit `28c7f71`  
> **線上服務：**
> - 前端：https://jaystock-web.onrender.com
> - 後端：https://jaystock.onrender.com

---

## 整體完成度

| 里程碑 | 目標 | 完成度 | 狀態 |
|--------|------|:------:|------|
| M0 環境建置 | 全端環境 + CI/CD | 90% | ✅ 完成（缺 Storybook）|
| M1 基礎看盤 | K線 + 技術指標 + 搜尋 | 100% | ✅ 完成 |
| M2 自選股 Watchlist | CRUD + 匯出 | 80% | ✅ 主功能完成 |
| M3 三大法人籌碼 | K線疊圖 + 市場儀錶板 | 85% | ✅ 核心完成 |
| M4 AI 選股器 | 自然語言 + 模板 + 結果 | 90% | ✅ 完成 |
| M5 市場儀錶板 | 大盤 + 廣度 + AI推播 | 85% | ✅ 完成（SMTP待驗證）|
| M6 效能優化 + 上線 | SEO + Sentry + 部署 | 95% | ✅ 已部署 |

**整體 PRD 功能完成度：約 87%**

---

## ✅ 已完成功能清單

### K 線圖表（超越 PRD 規格）
- [x] 五種圖表類型：蠟燭 / 空心K / Heikin-Ashi / 折線 / 面積
- [x] 技術指標：MA、EMA、BOLL、MACD、RSI、KD（PRD 標準）
- [x] 額外指標：VWAP、Williams %R、OBV（PRD 未規劃）
- [x] 三大法人籌碼疊圖（外資 / 投信 / 自營）
- [x] 時間週期切換（日 / 週 / 月 等）

### 自選股（M2）
- [x] Watchlist CRUD（前後端完整）
- [x] CSV ↓ / JSON ↓ 匯出（含 BOM 修正）
- [x] 多群組管理

### 市場功能（M3 + M5）
- [x] 市場整體法人動向儀錶板
- [x] 漲幅 / 跌幅 / 爆量 Top 20 排行榜
- [x] 大盤指數列（台股 + 美股）
- [x] 個股新聞 Tab（yfinance 整合）

### AI & 選股（M4）
- [x] 自然語言解析選股（Gemini API）
- [x] 5 個預設策略模板
- [x] 多維篩選器（技術 / 籌碼 / 基本面）
- [x] 選股結果列表

### 部署 & 品質（M6）
- [x] Google OAuth 登入（NextAuth.js v5）
- [x] Dark / Light 模式切換（防 FOUC）
- [x] Sentry 錯誤監控
- [x] Beta 回饋 Widget（前端 + 後端 `/api/v1/feedback`）
- [x] SEO / Open Graph Meta
- [x] Render 雙服務部署（前端 + 後端）
- [x] GitHub Actions CI/CD

---

## ⚠️ 未完成 / 差距項目

### 高優先（P0 — PRD 核心功能）

| 功能 | PRD 要求 | 現況 | 缺失原因 |
|------|---------|------|---------|
| **WebSocket 即時行情** | ≤3s 延遲，push 推播 | REST polling（5-10s 延遲）| 尚未實作 FastAPI WebSocket |
| **拖曳排序自選股** | dnd-kit 拖曳重排 | 無拖曳功能 | 未引入 dnd-kit |
| **FinMind 法人每日自動抓取** | APScheduler 排程 | 無排程，用 yfinance 替代 | APScheduler 未啟用 |
| **真實資料庫（Supabase）** | PostgreSQL + Auth | 無持久化 DB | 目前用 in-memory |

### 中優先（P1）

| 功能 | PRD 要求 | 現況 |
|------|---------|------|
| **設價提醒（Web Push）** | 突破/跌破通知 | `alerts.py` 後端有端點，前端 `AlertsToast.tsx` 有組件，但未串接 |
| **localStorage → 雲端同步** | 登入後自動同步 | 無 DB，Watchlist 無法持久 |
| **個股 30 日籌碼詳情表格** | 三大法人日報表 | 有 API 但 UI 未完整呈現 |
| **連續買超/賣超天數標籤** | 標示「外資連 N 日買超」| 未實作 |
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

## 🚧 目前進行中（2026-06-03）

| 項目 | Commit | 狀態 |
|------|--------|------|
| 後端新聞 API：`get_news()` 優先 + fallback `.news` | `28c7f71` | 🔨 Building |
| 前端 OAuth 環境變數部署 | — | ⏳ 排隊中 |

### 新聞 API 修復歷程
1. **舊格式（flat）→ 新格式（content 巢狀）**：`45ce534` 修復欄位對應
2. **yfinance 1.4.1 `.news` 回傳空陣列**：`28c7f71` 改用 `get_news()` 優先
3. 同時支援兩種格式，自動偵測

---

## 🎯 建議下一步（按優先級排序）

### 第 1 步：驗證新聞修復
- 等待 `28c7f71` deploy live
- 確認 `https://jaystock.onrender.com/api/v1/news/2330` 回傳有標題的新聞

### 第 2 步：設價提醒前端串接（快速勝利）
- 後端 `alerts.py` 已完整
- 前端 `AlertsToast.tsx` 組件存在
- 只需在 LeftPanel 自選股 Row 加「設定提醒」按鈕 + 呼叫 API

### 第 3 步：WebSocket 即時行情（P0 核心）
- FastAPI WebSocket 端點（`/ws/quotes`）
- 前端 `useWebSocket.ts` hook
- 盤中 09:00–13:30 每 5 秒 poll TWSE，有變動才廣播

### 第 4 步：拖曳排序（dnd-kit）
```bash
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities --filter @stockpulse/web
```
- `LeftPanel.tsx` watchlist 加入 `SortableContext`
- 拖曳結束後呼叫 `PUT /api/v1/watchlist/{id}` 更新 `sort_order`

### 第 5 步：Supabase 整合（資料持久化）
- 目前所有資料 in-memory，重啟即消失
- 用 Supabase Free（PostgreSQL 500MB + Auth）
- 遷移 watchlist、alerts、feedback 三張表

### 第 6 步：SMTP 盤前 AI 推播驗證
- 確認 `DIGEST_SMTP_PASS`（Gmail App Password）已填入
- 手動呼叫 `/api/v1/digest/send` 確認 Email 可送達

---

## 🌐 線上服務端點

| 端點 | 說明 | 狀態 |
|------|------|------|
| `GET /api/v1/quotes/{symbol}` | 個股即時報價 | ✅ 正常 |
| `GET /api/v1/kline/{symbol}` | K 線歷史資料 | ✅ 正常 |
| `GET /api/v1/chips/{symbol}` | 三大法人籌碼 | ✅ 正常 |
| `GET /api/v1/market/indices` | 大盤指數 | ✅ 正常 |
| `GET /api/v1/market/ranking` | 漲跌爆量排行 | ✅ 正常 |
| `GET /api/v1/news/{symbol}` | 個股新聞 | 🔧 修復中 |
| `POST /api/v1/screener/run` | AI 選股執行 | ✅ 正常 |
| `GET/POST /api/v1/watchlist` | 自選股 CRUD | ✅ 正常 |
| `POST /api/v1/feedback` | Beta 回饋 | ✅ 正常 |

---

*本文件由 gsd-progress 技能自動生成，基於 PRD.md、ARCHITECTURE.md、git log 及實際代碼交叉比對。*
