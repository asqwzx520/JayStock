# 回測功能升級規格（Backtest Roadmap）

> **建立日期：** 2026-06-11  
> **討論方式：** /grill-me 14 題逐項確認  
> **目的：** 把單純的「跑一次回測」升級為完整的策略開發/驗證/比較/掃描平台

---

## 進度追蹤

| # | 階段 | 任務 | 狀態 | Commit |
|:-:|:----:|------|:----:|:------|
| 1 | P0 | 交易明細表格強化 | ✅ | `7bfb0fd` |
| 2 | P0 | K 線圖標記買賣點 | ✅ | `8d7f9ae` |
| 3 | P0 | 自訂策略 A（積木式） | 🚧 | — |
| 4 | P0 | 儲存策略 / 我的策略列表 | ⏳ | — |
| 5 | P1 | 參數最佳化（Top 30 + 熱力圖） | ⏳ | — |
| 6 | P1 | 策略比較 | ⏳ | — |
| 7 | P2 | 自訂策略 B（跨日 + K棒形態） | ⏳ | — |
| 8 | P2 | 自訂策略 C（DSL 文字輸入） | ⏳ | — |
| 9 | P2 | 全台股池掃描（非同步 job） | ⏳ | — |
| 10 | P2 | 組合回測 / Portfolio | ⏳ | — |

---

## 階段 P0（第一波 · MVP 基礎強化）

### 1. 交易明細表格強化（Q5-A）✅ `7bfb0fd`

**範圍：** 純前端，現有 `trades` 資料夠

**欄位：**
- 進場日
- 出場日
- 進場價
- 出場價
- 持倉天數
- 報酬%
- 手續費
- 出場原因（訊號出場 / 停損 / 停利 / 期末強平）

**檔案：** `apps/web/components/backtest/BacktestPanel.tsx`（交易明細分頁）

---

### 2. K 線圖標記買賣點（Q5-B）✅ `8d7f9ae`

**範圍：** 回測結果頁新增 K 線圖區塊（資金曲線下方）

**規格：**
- ▲綠 markers = 買入點（對應該日 K 棒）
- ▼紅 markers = 賣出點
- hover tooltip 顯示交易詳情（價格、報酬）
- 使用 `lightweight-charts` 的 `createSeriesMarkers`（已熟悉）

**檔案：** `BacktestPanel.tsx` 新增 `<TradesKlineChart>` 元件

---

### 3. 自訂策略 A 方案：積木式條件編輯器（Q2-A、Q14-A）🚧 進行中

**進場條件 / 出場條件兩區塊**

**每行：** `[欄位下拉] [運算子下拉] [數值輸入] [刪除按鈕]`

**頂部 AND / OR 單選**（不支援混合，要混合請用 P2 的 DSL 文字模式）

**上限：** 10 條件（後端已支援）

**欄位定義（含 Q15 lookahead 防護）：**

| 類別 | 欄位 | Lookahead 延後 |
|------|------|:---:|
| 價量 | 收盤、開盤、最高、最低、成交量 | 無 |
| 均線 | MA5、MA10、MA20、MA60、EMA12、EMA26 | 無 |
| 動能 | RSI(14)、KD-K、KD-D、MACD、MACD訊號 | 無 |
| 通道 | BOLL上軌、BOLL中軌、BOLL下軌 | 無 |
| **EPS** | TTM EPS、最近季 EPS、季 EPS YoY%、季 EPS QoQ% | **季底 +45 天** |
| **營收** | 月營收、月營收 YoY%、月營收 MoM%、年營收、年營收 YoY% | **月 +10 天 / 年 +90 天** |

**運算子：** `>` `<` `=` `cross_above`（向上突破）`cross_below`（向下跌破）

**檔案：**
- 前端：`BacktestPanel.tsx` 自訂策略區塊（取代現有 placeholder）
- 後端：`backtest_service.py` 擴充 `_add_indicators()` 與 `_gen_signals()` 中 `custom` 分支

---

### 4. 儲存策略 / 我的策略列表（Q12-B、Q13）

**儲存按鈕：** 回測結果頁右上「💾 儲存策略」

**儲存 Modal：**
- 策略名稱（必填，用戶自訂，例：「2330 RSI 抄底 v2」、「2024 高股息選股池」）
- 備註（選填）

**我的策略列表：**
- 每筆顯示：名稱、創建日期、策略類型、目標股票/池
- 右側按鈕：「▶ 重新執行」（讀取設定一鍵跑）、「🗑 刪除」

**Supabase 新表：**
```sql
CREATE TABLE backtest_strategies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  note        TEXT,
  strategy_json JSONB NOT NULL,
  symbol_or_pool TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_backtest_strategies_user ON backtest_strategies(user_id);
```

**檔案：**
- 前端：`SaveStrategyModal.tsx`（新）、`MyStrategiesPanel.tsx`（新）
- 後端：`apps/api/app/api/v1/backtest.py` 新增 CRUD endpoints

---

## 階段 P1（第二波 · 差異化亮點）

### 5. 參數最佳化（Q6 A+B+C）

**A 自訂 Grid：** 給進階用戶定義範圍（例：快線 `[3, 5, 8, 10]`、慢線 `[15, 20, 30, 50]`）

**B 一鍵最佳化：** 每個策略內建建議掃描範圍，前端顯示 **Top 30** 排行（Q6 用戶指定 Top 30）

**C 熱力圖：** 2D 參數時呈現（如 MA 黃金交叉的快線×慢線），3+ 參數 fallback 到 Top 30 表格

**檔案：**
- 後端：`backtest_service.py` 新增 `run_optimize()`
- 前端：`OptimizePanel.tsx`（新，獨立分頁）

---

### 6. 策略比較（Q7 A+B+C）

**A 並排績效卡片：** 左右 2~4 欄關鍵指標（總報酬、Sharpe、MaxDD、勝率）

**B 多策略疊加資金曲線：** 同一張圖 2~4 條線（不同顏色）+ 0050 基準

**C 統計顯著性：** t-test / Bootstrap，判斷「策略 A 的 Sharpe 顯著高於 B 嗎」（可摺疊收起）

**檔案：**
- 後端：`backtest_service.py` 新增 `run_compare()`
- 前端：`CompareStrategiesPanel.tsx`（新）

---

## 階段 P2（第三波 · 最大野心）

### 7. 自訂策略 B 方案：跨日條件 + K棒形態（Q2-B）

**新增欄位：**
- 量比：今日量 / 昨日量
- 連續形態：連續 N 日收紅 / 連續 N 日新高
- K 棒形態：直接引用 `patterns.py` 13 種型態

**後端：** `backtest_service.py` 擴充欄位池

---

### 8. 自訂策略 C 方案：DSL 文字輸入（Q2-C、Q8-A）

**架構：** 自訂 DSL（用 `lark` 或 `pyparsing` 寫 parser，~100 行）

**白名單：**
- 函數：`ma(N)`, `rsi(N)`, `cross_above(a, b)`, `cross_below(a, b)`, `consec_up(N)` 等
- 欄位：`close`, `open`, `high`, `low`, `volume`, `eps_ttm`, `revenue_yoy` 等
- 運算子：`>`, `<`, `=`, `AND`, `OR`, `NOT`, `()`

**安全：** 嚴禁 `eval()`，只走 parser → AST → pandas 表達式 → 對 DataFrame 套用

**前端：** Monaco Editor / CodeMirror 配 syntax highlighting + 即時語法檢查

**範例語法：**
```
進場：close > ma(20) AND rsi(14) < 30
出場：close < ma(20) OR rsi(14) > 70
```

---

### 9. 全台股池掃描（Q3-A、Q4 A+D、Q9-B、Q10 A+B+C）

**目標股票池：**
- 預設市值前 200（涵蓋台股 95% 交易量）
- 用戶可額外加入股票（搜尋 / 自選股匯入）

**執行模式：** 非同步 Job + 輪詢
- POST `/backtest/scan` → 後端啟動背景任務 → 回 `job_id`
- 前端每 3 秒 poll `/backtest/scan/{job_id}`（payload: progress + result）
- 記憶體 dict 存 job，key=user_id+timestamp，TTL 1h 自動清除
- 用戶可離開頁面，回來繼續輪詢

**結果頁三合一（A + B + C）：**

| 元件 | 說明 |
|------|------|
| **A 排序下拉** | Sharpe / 總報酬 / 勝率 / MaxDD 切換，預設 Top 30 |
| **B 綜合得分欄位** | `Sharpe×0.4 + 勝率×0.3 + (1−MaxDD)×0.3`，旁邊 ⓘ 解釋公式（非預設排序）|
| **C 篩選 chip** | Sharpe > X、勝率 > Y、MaxDD < Z 即時過濾全 200~250 筆 |

**每列右側：** 「→ 詳細回測」跳轉單股回測頁（形成 Screener → Single Backtest 閉環）

---

### 10. 組合回測 / Portfolio Backtest（Q3-B、Q11 A+D）

**資金分配：**
- A 等權重預設（資金 ÷ N 等分，符合直覺、可心算驗證）
- D 用戶可手動覆寫權重（滑桿 30% / 20% / 25% / 25%）

**報告：**
- 整體資金曲線
- 各股貢獻度（誰賺最多、誰拖累）
- 各股獨立績效卡（並排）

**留 P3：** 相關性矩陣、Risk Parity、動態再平衡

---

## 關鍵技術原則

### 基本面 Lookahead 防護（Q15-B）

**為什麼重要：** 2024 Q1 EPS 是 2024-05-15 才公布，回測時若 2024-01-01 就用 EPS=8 來判斷，等於用了「未來資訊」，績效嚴重失真。

**保守延後規則（按法定公布期限）：**

| 資料類型 | 延後天數 | 範例 |
|---------|:------:|------|
| 季 EPS | **+45 天** | Q1 結束 3/31 → 5/15 起可用 |
| 月營收 | **+10 天** | 1 月 → 2/10 起可用 |
| 年營收 | **+90 天** | 年底 12/31 → 隔年 3/31 起可用 |
| TTM EPS | 跟隨最近一季 EPS 的公布日 | 同上 |

**實作位置：** `backtest_service.py` 加入基本面欄位時，每個資料點都要 shift 對應天數，用戶無感。

---

### 安全沙箱（Q8-A）

**永不用 `eval()`。** DSL parser 路線：
1. 用戶輸入字串 → `lark` parse → AST
2. AST 走訪 → 只允許白名單函數 / 欄位 / 運算子
3. 編譯成 pandas 表達式 → 對 DataFrame 套用
4. 任何不合白名單的 token 都直接拒絕並回友善訊息

---

### 快取策略

- **5 年 K 線**：24h TTL（已實作 `@ttl_cache`）
- **基本面**：1h TTL（用 `fundamental_cache_service.py`）
- **全池掃描結果**：以 `(strategy_hash + pool_hash + date_range)` 為 key 快取 1h
- **參數最佳化結果**：同上策略

---

## 實作優先順序

```
P0 → 立即提升現有回測體驗，無架構大改（~1 週）
P1 → 在 P0 單股回測上做擴展，運算成本可控（~1 週）
P2 → 三個工程量大頭：DSL parser、非同步 job 系統、組合回測（~3 週）
```

---

## 設計討論完整記錄（grill-me 14 題）

| Q | 決策 | 理由 |
|---|------|------|
| Q1 最痛缺口 | 參數最佳化 | 單一策略跑一次沒什麼用 |
| Q2 自訂策略複雜度 | A+B+C 全要 | 入門到專業全覆蓋 |
| Q3 台股池掃描方向 | C（A 選股式 + B 組合） | A 找股票、B 驗組合 |
| Q4 掃描範圍 | A+D（市值前 200 + 用戶加股） | 涵蓋率 vs 速度平衡 |
| Q5 交易展示 | A+B（明細表格 + K 線標記） | 總覽 + 直覺 |
| Q6 參數最佳化 | A+B+C（自訂+一鍵+熱力圖） | Top 30 排行 |
| Q7 策略比較 | A+B+C（卡片+疊圖+t-test） | 一般+專業都覆蓋 |
| Q8 自訂策略 C 安全 | A（自訂 DSL） | 絕不用 eval |
| Q9 全池執行模式 | B（非同步 job + 輪詢）| 可離開頁面 |
| Q10 全池結果頁 | A+B+C（排序+得分+篩選） | 完整體驗 |
| Q11 組合資金分配 | A+D（等權重 + 手動覆寫）| 透明可驗證 |
| Q12 持久化 | B（存策略書，不存結果）| 高 ROI |
| Q13 優先級 | P0/P1/P2 | 由近至遠擴展 |
| Q14 條件編輯 UI | A+C（積木 + DSL）| 入門+進階雙模式 |
| Q15 基本面對齊 | B（延後 N 天）| 法定公布期限保守延後 |

---

*規格鎖定：2026-06-11；下一步：P0-1 交易明細表格強化*
