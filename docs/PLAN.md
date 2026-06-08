# Sprint Plan — 2026-06-08

> 本輪 4 項修復，依優先序排列。完成後更新 PROGRESS.md。

---

## 修復一：K線型態標記縮小

**問題**：走勢圖上的型態標記（錘頭線、十字星等）文字太大、圖示太大，影響 K 線閱讀。

**解法**：移除文字標籤，縮小圖示尺寸。

**檔案**：`apps/web/components/chart/KLineChart.tsx`

```diff
 function buildSeriesMarkers(patterns: CandlePattern[]): SeriesMarker<Time>[] {
   const markers = patterns.map((p) => ({
     time:     p.date as Time,
     position: p.direction === "bullish" ? "belowBar" : p.direction === "bearish" ? "aboveBar" : "inBar",
     color:    PATTERN_COLORS[p.direction],
     shape:    p.direction === "bullish" ? "arrowUp" : p.direction === "bearish" ? "arrowDown" : "circle",
-    text:     p.label,
-    size:     1,
+    text:     "",
+    size:     0.6,
   }));
   return markers.sort((a, b) => (a.time as string).localeCompare(b.time as string));
 }
```

---

## 修復二：Screener 一鍵加自選股

**問題**：Screener 篩出股票後，必須點進去再手動加到自選股，步驟繁瑣。

**解法**：在每一列最右欄加 `+` / `✓` 按鈕，直接加入第一個 Watchlist Group。

**檔案**：`apps/web/components/screener/ScreenerPanel.tsx`

**改動重點**：

1. 元件掛載時呼叫 `watchlistApi.get()` → 建立 `watchedSymbols: Set<string>`（存 symbol）與 `firstGroupId: string`
2. `ResultRow` 最後一欄加按鈕：
   - 已在自選股 → `✓`（綠色，disabled）
   - 未加 → `+`（灰色，hover 變藍）
3. 點 `+` → optimistic 先更新 UI → 呼叫 `watchlistApi.addItem(firstGroupId, symbol)`
4. 按鈕 `e.stopPropagation()` 防止觸發整列的選股 onClick
5. 失敗時 rollback（移除 optimistic 更新）

**Props 不變**，watchlist 邏輯完全在 ScreenerPanel 內部管理。

---

## 修復三：新聞中文過濾 + 重要度篩選

**問題**：新聞混雜英文，且沒有過濾功能，找不到重要訊息。

**解法**：後端新增 `importance` / `is_chinese` 欄位；前端加三層篩選 UI。

### 後端：`apps/api/app/services/market_service.py`

新增關鍵字常數與評分函式：

```python
_HIGH_KEYWORDS = [
    # 個股財務
    "法說", "財報", "EPS", "除息", "除權", "配息", "股利",
    "漲停", "跌停", "停牌", "下市", "重大訊息",
    # 國際總經
    "非農", "GDP", "CPI", "PCE", "Fed", "聯準會",
    "升息", "降息", "利率決策",
    "標普", "道瓊", "那斯達克", "大跌", "暴跌", "崩盤", "熊市",
    "NVIDIA", "輝達", "Apple", "蘋果", "Tesla", "特斯拉",
]
_MID_KEYWORDS = [
    "半導體", "晶圓", "AI", "人工智慧",
    "法人", "買超", "賣超", "外資", "投信", "自營商",
    "產業", "供應鏈",
]

def _is_chinese(text: str) -> bool:
    import re
    return bool(re.search(r'[一-鿿]', text))

def _score_importance(title: str, publisher: str) -> str:
    combined = (title + " " + publisher).lower()
    if any(k.lower() in combined for k in _HIGH_KEYWORDS):
        return "高"
    if any(k.lower() in combined for k in _MID_KEYWORDS):
        return "中"
    return "低"
```

在 `_parse_news_item` 兩個 return dict 末尾加：
```python
"importance": _score_importance(title_val, publisher_val),
"is_chinese": _is_chinese(title_val),
```

### 前端型別：`apps/web/lib/api.ts`

```typescript
export interface NewsItem {
  title:        string;
  publisher:    string;
  link:         string;
  published_at: number;
  thumbnail:    string | null;
  type:         string;
  importance:   "高" | "中" | "低";  // NEW
  is_chinese:   boolean;              // NEW
}
```

### 前端 UI：`apps/web/components/market/StockNews.tsx`

**布局（上→下）**：

```
┌─────────────────────────────────────────┐
│ [全部] [高] [中] [低]        [搜尋框  ] │  ← Row 1
│ [美股] [Fed/利率] [半導體] [匯率] [財報]│  ← Row 2 (多選分類 chip)
├─────────────────────────────────────────┤
│ 新聞列表（篩選後）                       │
└─────────────────────────────────────────┘
```

**篩選邏輯（全部前端，不重新 fetch）**：

```typescript
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "美股":     ["標普","道瓊","那斯達克","美股","S&P","Nasdaq"],
  "Fed/利率": ["Fed","聯準會","升息","降息","利率"],
  "半導體":   ["半導體","晶圓","台積電","輝達","AI晶片"],
  "匯率":     ["匯率","美元","台幣","升值","貶值"],
  "財報":     ["財報","EPS","營收","獲利"],
  "法說":     ["法說","投資人日"],
};

const filtered = news
  .filter(n => n.is_chinese)   // 預設只看中文（固定）
  .filter(n => importance === "全部" || n.importance === importance)
  .filter(n =>
    activeCategories.length === 0 ||
    activeCategories.some(cat =>
      CATEGORY_KEYWORDS[cat].some(kw => n.title.includes(kw))
    )
  )
  .filter(n => !keyword || n.title.includes(keyword));
```

---

## 修復四：效能優化（Tab keep-alive + 前端快取）

**問題**：切 tab 後切回，資料全部重新載入，等待時間長。

**解法 A**：已訪問過的 tab 保持掛載，用 CSS `hidden` 隱藏。  
**解法 B**：API 回應存入前端 Map cache，相同 key 在 TTL 內直接回傳快取。

### B. 新建 `apps/web/lib/clientCache.ts`

```typescript
const _cache = new Map<string, { data: unknown; ts: number }>();

export function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 5 * 60_000
): Promise<T> {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return Promise.resolve(entry.data as T);
  return fetcher().then(data => {
    _cache.set(key, { data, ts: Date.now() });
    return data;
  });
}
```

### A. `apps/web/app/dashboard/page.tsx` — 首次掛載後不銷毀

```typescript
// 初始掛載 3 個最重要的 tab
const [mountedTabs, setMountedTabs] = useState<Set<ViewTab>>(
  new Set(["kline", "home", "analysis"])
);

const handleTabChange = (tab: ViewTab) => {
  setViewTab(tab);
  setMountedTabs(prev => new Set([...prev, tab]));
};
```

渲染模式：
```tsx
{/* kline: 永遠掛載，hidden 隱藏 */}
<div className={viewTab !== "kline" ? "hidden" : "flex h-full ..."}>
  <KLineChart ... />
</div>

{/* 其他 tab: 首次訪問才掛載，之後不銷毀 */}
{mountedTabs.has("ranking") && (
  <div className={viewTab !== "ranking" ? "hidden" : ""}>
    <HotRanking ... />
  </div>
)}
```

### B 套用 withCache：

```typescript
// 基本面 TTL 1h
useEffect(() => {
  withCache(`fundamental:${symbol}`, () => getFundamental(symbol), 3_600_000)
    .then(setFundamental).catch(() => {});
}, [symbol]);

// 型態 TTL 5min
useEffect(() => {
  withCache(`patterns:${symbol}`, () => getPatterns(symbol), 300_000)
    .then(r => setPatterns(r.patterns)).catch(() => {});
}, [symbol]);

// K線 TTL 2min（key 含 period）
// 在 loadKline callback 內套用
withCache(`kline:${sym}:${per}`, () => fetch..., 120_000)
```

---

## 實作順序

| # | 項目 | 檔案 | 預估時間 |
|---|------|------|---------|
| 1 | K線標記縮小 | KLineChart.tsx | 5 min |
| 2 | Screener + 按鈕 | ScreenerPanel.tsx | 1h |
| 3 | 新聞後端重要度 | market_service.py | 30 min |
| 4 | 新聞前端 UI | StockNews.tsx + api.ts | 1.5h |
| 5 | 前端快取 | lib/clientCache.ts（新建） | 20 min |
| 6 | Keep-alive + cache 套用 | dashboard/page.tsx | 1.5h |

**總計：約 5 小時**

---

## 驗證清單（Sprint 1 已完成）

- [x] K線圖上型態只剩小箭頭/圓點，無中文文字
- [x] Screener 每列右側有 `+` 按鈕，點擊後變 `✓`，自選股側欄出現該股
- [x] 新聞 tab 只顯示中文標題；切「高」過濾出法說/財報/Fed 類；關鍵字搜尋有效
- [x] K線 → 排行 → K線，切回瞬間（不重載）；DevTools Network 無重複 fundamentals 請求

---

---

# Sprint 2 — 功能強化（對標 XQ / TradingView）

> 開始日期：2026-06-08
> 目標：縮短與 XQ / TradingView 的差距，提升資料量與視覺衝擊

## 現況盤點（程式碼探索結論）

| 功能 | 實際狀況 | 需要做什麼 |
|------|---------|-----------|
| 板塊熱力圖 | ✅ 後端 `/market/sectors` + 前端 `SectorHeatmap` 都存在，但**埋在大盤 Tab 裡，不夠顯眼** | 強化視覺、獨立 Tab 或首頁置頂 |
| VWAP | ✅ `indicators.ts` + `KLineChart.tsx` 都已實作，VWAP 指標可開啟 | 確認 UX，可能加說明或預設開啟 |
| 季K / 年K | ❌ 後端 `_aggregate()` 只有 W/M，前端週期按鈕無季/年 | 後端加 Q/Y 聚合 + 前端加按鈕 |
| Screener 基本面條件 | ❌ 目前只有技術面+籌碼篩選 | 加 PE/殖利率/毛利率/市值 條件 |

---

## 功能一：板塊熱力圖強化

### grill-me 決策：D
- 首頁（home tab）加小版熱力圖（橫排緊湊版）
- 大盤 Tab 加大完整版：格子放大 + 點擊板塊 → 右側顯示成分股漲跌排序

### 實作細節

**首頁小版**（`HomeDashboard.tsx`）：
- 橫向排列，每個板塊一個 pill chip（名稱 + 漲跌%）
- 深紅→淺紅→灰→淺綠→深綠 5段漸層色
- 點擊 chip → 切到大盤 Tab

**大盤完整版**（`MarketDashboard.tsx`）：
- `SectorTile` 放大：`min-h-[80px]`，顯示板塊名稱、平均漲跌幅、上漲/下跌檔數
- 點擊板塊 → 右側面板展開該板塊成分股列表（symbol + name + change_pct 排序）
- `SectorData` 的 `top_stocks` 欄位已有前5支，需擴充到全部成分股

### 涉及檔案
- `apps/web/components/dashboard/HomeDashboard.tsx`（新增 MiniSectorBar）
- `apps/web/components/market/MarketDashboard.tsx`（SectorTile 放大 + 成分股面板）
- `apps/api/app/services/market_service.py`（`_SECTOR_MAP` 回傳完整成分股清單）
- `apps/web/lib/api.ts`（SectorData 型別擴充）

---

## 功能二：VWAP ± 1σ 通道（可獨立開關）

### grill-me 決策：B，要可以開關
新增 `VWAP_BAND` 指標（獨立於現有 `VWAP`），開啟後顯示 VWAP 中線 + 上下 ±1σ 通道帶。

### 實作細節

**`apps/web/lib/indicators.ts`**：
```typescript
// 新增 vwapBand()，回傳 { mid, upper, lower }[]
export function vwapBand(bars: OHLCV[], period = 20, mult = 1): {
  mid: number | null; upper: number | null; lower: number | null;
}[] {
  const mids = vwap(bars, period);
  // 計算每個點的 typical price 對 VWAP 的標準差（滾動 period 個 bar）
  // upper = mid + mult * σ；lower = mid - mult * σ
}
```

**`apps/web/components/chart/KLineChart.tsx`**：
- `IndicatorType` 加入 `"VWAP_BAND"`
- 渲染：3條 LineSeries（mid 用實線，upper/lower 用虛線 + 半透明填充）
- 顏色：紫色 `#E879F9`（與現有 VWAP 同色系，通道用 10% opacity 填充）

**`apps/web/components/chart/IndicatorSelector.tsx`**：
```typescript
{ key: "VWAP",      label: "VWAP",      desc: "成交量加權平均價（滾動20日）" },
{ key: "VWAP_BAND", label: "VWAP帶",    desc: "VWAP ± 1σ 標準差通道" },  // NEW
```

### 涉及檔案
- `apps/web/lib/indicators.ts`（新增 `vwapBand()` 函式）
- `apps/web/components/chart/KLineChart.tsx`（VWAP_BAND 渲染邏輯）
- `apps/web/components/chart/IndicatorSelector.tsx`（新增按鈕）
- `apps/web/lib/api.ts`（`IndicatorType` 型別同步）

---

## 功能三：季K / 年K

### 現況
- 後端 `_aggregate(rows, freq)` 已支援 "W"（週）、"M"（月）
- 前端 `PeriodSelector.tsx` 只有日/週/月 + 分K
- 後端 query start date 預設 `-365天`，季K/年K 需要更長資料區間

### grill-me 決策：C — 拉最長（15 年）
季K 約 60 根，年K 約 15 根，讓長線投資人看完整週期。

### 實作

**後端 `apps/api/app/api/v1/kline.py`**：
```python
if start is None:
    if period in ("quarterly", "yearly"):
        start = end - timedelta(days=365 * 15)   # 最長 15 年
    else:
        start = end - timedelta(days=365)

if period == "weekly":      rows = _aggregate(rows, "W")
elif period == "monthly":   rows = _aggregate(rows, "M")
elif period == "quarterly": rows = _aggregate(rows, "QE")  # pandas Q-end
elif period == "yearly":    rows = _aggregate(rows, "YE")  # pandas Y-end
```

**前端 `apps/web/components/chart/PeriodSelector.tsx`**：
```typescript
const DAILY_PERIODS = [
  { key: "daily",     label: "日K" },
  { key: "weekly",    label: "週K" },
  { key: "monthly",   label: "月K" },
  { key: "quarterly", label: "季K" },  // NEW
  { key: "yearly",    label: "年K" },  // NEW
] as const;
```

**前端 `apps/web/lib/api.ts`** + **`dashboard/page.tsx`**：
- `Period` / `DailyPeriod` 型別加入 `"quarterly" | "yearly"`
- `isIntradayPeriod()` 不受影響（季/年K 走日K code path）
- `clientCache` TTL：季/年K 用 30 分鐘（資料不常變）

### 涉及檔案
- `apps/api/app/api/v1/kline.py`（加 Q/Y 聚合 + 擴大 start 範圍）
- `apps/web/components/chart/PeriodSelector.tsx`（加按鈕）
- `apps/web/lib/api.ts`（型別）
- `apps/web/app/dashboard/page.tsx`（cache TTL）

### 估計時間：1.5h

---

## 功能四：Screener 基本面篩選條件

### 目標
在現有技術面+籌碼條件之上，加入基本面篩選：

| 條件 | 說明 | 資料來源 |
|------|------|---------|
| PE < N | 本益比低於某值 | yfinance `info.trailingPE` |
| 殖利率 > N% | 股息殖利率 | yfinance `info.dividendYield` |
| 毛利率 > N% | Gross Margin | yfinance `info.grossMargins` |
| 市值 > N 億 | 篩大型股 | yfinance `info.marketCap` |
| ROE > N% | 股東權益報酬率 | yfinance `info.returnOnEquity` |

### 涉及檔案
- `apps/api/app/services/screener_service.py`（加基本面欄位到 metrics）
- `apps/api/app/api/v1/screener.py`（API 過濾條件）
- `apps/web/components/screener/ScreenerPanel.tsx`（UI 篩選欄位）
- `apps/web/lib/api.ts`（ScreenerResult 型別擴充）

### 估計時間：3-4h

---

## Sprint 2 實作順序

| # | 功能 | 難度 | 預估時間 |
|---|------|------|---------|
| 1 | 季K / 年K | 低 | 1.5h |
| 2 | 板塊熱力圖強化 | 中 | 3h |
| 3 | VWAP UX 確認 | 低 | 30min |
| 4 | Screener 基本面條件 | 中高 | 4h |

---

## Sprint 2 驗證清單

- [ ] 走勢圖可選季K / 年K，資料正確聚合（OHLCV 開收高低量）
- [ ] 板塊熱力圖顏色對比明顯，點擊板塊顯示成分股清單
- [ ] VWAP 指標在分K 圖上正確顯示（累積），日K 顯示滾動均值
- [ ] Screener 可加 PE / 殖利率 / 毛利率 / 市值 篩選條件
