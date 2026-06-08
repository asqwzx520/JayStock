# Sprint Plan — 2026-06-08

> **Sprint 1（4項修復）✅、Sprint 2（季K/年K + VWAP帶 + 板塊）✅、Sprint 3（鍵盤快捷鍵 + 美股 + DB優化）✅、Sprint 4（分析 Tab 修復）✅、Sprint 5（K線圖表強化）✅ 完成（commit `5a31945`，2026-06-09）**

---

# Sprint 5 — K 線圖表全面強化（grill-me 2026-06-09）

> 6 項功能，全部集中在圖表體驗；無後端改動。

## 決策記錄

| # | 功能 | 決策 |
|---|------|------|
| 1 | Tab 改名 | 走勢圖 → **K線** |
| 2 | OHLCV十字線 | **A** — 更新左側欄（`onCrosshairMove` prop 回傳 `ChartBar \| null`，滑鼠離開時還原即時報價） |
| 3 | 全視窗放大 | **C** — Modal 彈窗 + **A** 完整工具列（週期/圖形/繪圖/指標/AI評價） |
| 4 | Ctrl+Z 畫線 Undo | **A** — 無限層回退（`undoStack: Drawing[][]` 快照） |
| 5 | 指標參數顯示 | **C** — 圖表左上角 Legend，可點擊開 Popover 編輯參數；**A** 除 Ichimoku 外全開放 |
| 6 | 子指標分離 | **C** — 每個子指標各自獨立 `<SubIndicatorPanel>`；可拖動分界線；localStorage 記憶比例；各面板獨立高度；主圖最小 30%、子指標最小 5% |

---

## 指標分類

### Overlay（疊在主圖上，不動）
`MA` `EMA` `BOLL` `VWAP` `VWAP_BAND` `ICHI` `CHIPS`

### Sub-panel（各自獨立面板）
`MACD` `RSI` `KD` `WR` `OBV` `ATR` `ADX` `SRSI`

---

## 功能一：Tab 改名

**檔案**：`apps/web/hooks/useTabConfig.ts`

```diff
- { id: "kline", label: "走勢圖", visible: true },
+ { id: "kline", label: "K線",   visible: true },
```

> ⚠️ localStorage key `jaystock_tab_config_v1` 的 label 由前端覆蓋，不需 migration。

---

## 功能二：十字線 OHLCV → 左側欄

### KLineChart.tsx 改動

新增 prop：
```typescript
interface KLineChartProps {
  // ...existing
  onCrosshairMove?: (bar: ChartBar | null) => void;
}
```

在 `buildChart` 內訂閱：
```typescript
chart.subscribeCrosshairMove((param) => {
  if (!param.time || !param.seriesData.size) {
    props.onCrosshairMove?.(null);
    return;
  }
  // 找到對應 data[] 中 barTime(d) === param.time 的 bar
  const bar = data.find((d) => barTime(d) === param.time) ?? null;
  props.onCrosshairMove?.(bar);
});
```

### page.tsx 改動

```typescript
const [hoveredBar, setHoveredBar] = useState<ChartBar | null>(null);

// 左側欄顯示邏輯：hoveredBar 優先，否則用 quote
const displayOpen   = hoveredBar ? hoveredBar.open   : quote?.open;
const displayHigh   = hoveredBar ? hoveredBar.high   : quote?.high;
const displayLow    = hoveredBar ? hoveredBar.low    : quote?.low;
const displayClose  = hoveredBar ? hoveredBar.close  : quote?.price;
const displayVolume = hoveredBar ? hoveredBar.volume : quote?.volume;
const displayDate   = hoveredBar && "date" in hoveredBar ? hoveredBar.date : null;
```

左側欄「今日行情」區塊改用 `display*` 值，日期標題改成 `displayDate ?? "今日行情"`。

---

## 功能三：全視窗 Modal（新元件）

### 新建 `apps/web/components/chart/FullscreenChartModal.tsx`

```typescript
interface FullscreenChartModalProps {
  data:        ChartBar[];
  indicators:  IndicatorType[];
  chipsData?:  ChipsBar[];
  chartType:   ChartType;
  activeTool:  DrawingTool;
  clearKey:    number;
  symbol:      string;
  patternMarkers?: CandlePattern[];
  indicatorParams: IndicatorParams;   // 同主圖參數，進 Modal 沿用
  onClose:     () => void;
  // 以下供 Modal 內工具列用
  onIndicatorsChange: (v: IndicatorType[]) => void;
  onChartTypeChange:  (v: ChartType) => void;
  onPeriodChange:     (v: Period) => void;
  period:      Period;
}
```

結構：
```tsx
<div className="fixed inset-0 z-[9000] flex flex-col"
     style={{ background: "var(--bg-base)" }}>
  {/* 工具列：與主頁完全相同的 PeriodSelector + ChartTypeSelector + DrawingToolbar + IndicatorSelector */}
  <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b">
    ...toolbar...
    <button onClick={onClose} className="ml-auto">✕ 關閉</button>
  </div>
  {/* 圖表區（flex-1，KLineChart + SubIndicatorPanel 同樣架構）*/}
  <div className="flex-1 min-h-0">
    <KLineChartWithPanels ... />
  </div>
</div>
```

> Modal 內圖表為獨立實例，不共享主圖的 drawingsRef（各自 localStorage 同 symbol）。

### page.tsx 整合

```typescript
const [fullscreenOpen, setFullscreenOpen] = useState(false);
```

在 KLineChart 容器的右下角加按鈕：
```tsx
<button
  onClick={() => setFullscreenOpen(true)}
  className="absolute bottom-8 right-4 z-10 ..."
  title="全視窗"
>
  ⛶
</button>
{fullscreenOpen && <FullscreenChartModal ... onClose={() => setFullscreenOpen(false)} />}
```

---

## 功能四：Ctrl+Z 畫線 Undo

### KLineChart.tsx 改動

新增 undo stack ref（儲存「畫線前的快照」）：
```typescript
const undoStackRef = useRef<Drawing[][]>([]);
```

每次新增 / 刪除一個 drawing 時，先 push 快照再修改：
```typescript
// 新增 drawing 前
undoStackRef.current.push([...drawingsRef.current]);
// 修改 drawingsRef.current ...
lsSave(symbolRef.current, drawingsRef.current);
```

在 Escape-key useEffect 中加入 Ctrl+Z 監聽（合併到同一個 keydown handler）：
```typescript
if ((e.ctrlKey || e.metaKey) && e.key === "z") {
  e.preventDefault();
  const prev = undoStackRef.current.pop();
  if (prev !== undefined) {
    drawingsRef.current = prev;
    lsSave(symbolRef.current, prev);
    redrawFnRef.current();
  }
  return;
}
```

Symbol 切換時清空 undo stack：
```typescript
useEffect(() => {
  undoStackRef.current = [];
  // ...existing lsLoad
}, [symbol]);
```

---

## 功能五：指標參數 Legend + 可編輯 Popover

### 參數型別定義（新建 `apps/web/lib/indicatorParams.ts`）

```typescript
export interface IndicatorParams {
  MA:        number[];                          // 預設 [5, 10, 20, 60]
  EMA:       number[];                          // 預設 [12, 26]
  BOLL:      { period: number; std: number };   // 預設 { period:20, std:2 }
  MACD:      { fast: number; slow: number; signal: number }; // 12,26,9
  RSI:       { period: number };                // 14
  KD:        { period: number };                // 9
  VWAP:      { period: number };                // 20
  VWAP_BAND: { period: number };                // 20
  WR:        { period: number };                // 14
  OBV:       { period: number };                // N/A（無參數）
  ATR:       { period: number };                // 14
  ADX:       { period: number };                // 14
  SRSI:      { period: number };                // 14
}

export const DEFAULT_PARAMS: IndicatorParams = {
  MA: [5, 10, 20, 60], EMA: [12, 26],
  BOLL: { period: 20, std: 2 },
  MACD: { fast: 12, slow: 26, signal: 9 },
  RSI: { period: 14 }, KD: { period: 9 },
  VWAP: { period: 20 }, VWAP_BAND: { period: 20 },
  WR: { period: 14 }, OBV: { period: 0 },
  ATR: { period: 14 }, ADX: { period: 14 }, SRSI: { period: 14 },
};

const LS_KEY = "stockpulse_indicator_params_v1";
export function loadParams(): IndicatorParams { ... }
export function saveParams(p: IndicatorParams): void { ... }
```

### KLineChart.tsx — Legend HTML overlay

在 `containerRef` 之上疊一個 `pointer-events-none` 的 div（Legend 本身 `pointer-events-auto`）：

```tsx
{/* Legend：圖表左上角 */}
{activeLegendItems.length > 0 && (
  <div className="absolute top-1 left-1 z-20 flex flex-col gap-0.5 pointer-events-none">
    {activeLegendItems.map(item => (
      <button
        key={item.key}
        className="pointer-events-auto flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px]"
        style={{ background: "rgba(0,0,0,0.45)", color: item.color }}
        onClick={() => setParamPopover(item.key)}
      >
        <span className="font-semibold">{item.label}</span>
        <span className="opacity-70">{item.value ?? "—"}</span>
      </button>
    ))}
  </div>
)}
```

`activeLegendItems` 由 `indicators + hoveredBar + params` 計算而來：
- MA5 → `{ key:"MA5", label:"MA5", color:"#FBBF24", value: sma(closes,5)[hoveredIdx] }`
- RSI → `{ key:"RSI", label:"RSI(14)", color:"#A78BFA", value: rsiValues[hoveredIdx] }`
- 等等

### 新建 `apps/web/components/chart/IndicatorParamPopover.tsx`

```typescript
interface Props {
  indicator: keyof IndicatorParams;
  params:    IndicatorParams;
  onChange:  (next: IndicatorParams) => void;
  onClose:   () => void;
}
```

根據 `indicator` key 渲染對應輸入框（MA 渲染 4 個 number input，BOLL 渲染 period + std，MACD 渲染 fast/slow/signal），按「套用」呼叫 `onChange` 並 `saveParams`。

### KLineChart.tsx props 新增

```typescript
interface KLineChartProps {
  // ...existing
  indicatorParams?:   IndicatorParams;
  onParamsChange?:    (p: IndicatorParams) => void;
}
```

`buildChart` 的所有 hardcode period 改為讀 `indicatorParams`：
```diff
- MA_PERIODS.forEach((period, idx) => {
+ params.MA.forEach((period, idx) => {
```

---

## 功能六：子指標獨立面板 + 可拖動分界線

### 架構概覽

```
<ChartWithPanels>          ← 新容器元件（page.tsx 替換原 KLineChart 呼叫處）
  <KLineChart />           ← 主圖（只含 overlay 指標）
  <ResizeDivider />        ← 可拖 divider（主圖 ↔ 第一個子指標）
  <SubIndicatorPanel indicator="MACD" />
  <ResizeDivider />
  <SubIndicatorPanel indicator="RSI" />
  ...
</ChartWithPanels>
```

### Sub-panel 指標列表
需分離到子面板的 `IndicatorType`：
`MACD` `RSI` `KD` `WR` `OBV` `ATR` `ADX` `SRSI`

### 新建 `apps/web/components/chart/SubIndicatorPanel.tsx`

```typescript
interface SubIndicatorPanelProps {
  indicator:  SubIndicatorType;         // "MACD" | "RSI" | ...
  data:        ChartBar[];
  params:      IndicatorParams;
  height:      number;                  // px，由父元件控制
  syncRange?:  { from: number; to: number } | null;  // 時間軸同步
  onRangeChange?: (range: { from: number; to: number }) => void;
}
```

內部：獨立 `createChart`，`rightPriceScale.scaleMargins: {top:0.05, bottom:0.05}`，隱藏時間軸（`timeScale.visible: false`，只有最底部一個面板顯示時間軸），訂閱 `subscribeVisibleTimeRangeChange` 同步給父元件。

### 新建 `apps/web/components/chart/ResizeDivider.tsx`

```typescript
interface ResizeDividerProps {
  onDrag: (deltaY: number) => void;
}
```

```tsx
<div
  className="shrink-0 h-1 cursor-row-resize select-none"
  style={{ background: "var(--border)" }}
  onMouseDown={(e) => {
    const startY = e.clientY;
    const onMove = (ev: MouseEvent) => onDrag(ev.clientY - startY);
    const onUp = () => { document.removeEventListener("mousemove", onMove); ... };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }}
/>
```

### 新建 `apps/web/components/chart/ChartWithPanels.tsx`

狀態：
```typescript
// 高度比例：[主圖%, 子指標1%, 子指標2%, ...]
const [heights, setHeights] = useState<number[]>(() => loadHeights());
const [syncRange, setSyncRange] = useState<{ from:number; to:number } | null>(null);
```

高度調整（拖動 divider i 時）：
```typescript
function handleDrag(dividerIdx: number, deltaY: number) {
  setHeights(prev => {
    const next = [...prev];
    const totalPx = containerRef.current?.clientHeight ?? 600;
    const deltaPct = (deltaY / totalPx) * 100;
    const MIN_MAIN = 30, MIN_SUB = 5;
    // dividerIdx 0 = 主圖 ↔ 子指標1
    const upper = dividerIdx;
    const lower = dividerIdx + 1;
    const minUpper = upper === 0 ? MIN_MAIN : MIN_SUB;
    next[upper] = Math.max(minUpper, next[upper] + deltaPct);
    next[lower] = Math.max(MIN_SUB,  next[lower] - deltaPct);
    // 確保總和 = 100
    saveHeights(next);
    return next;
  });
}
```

localStorage key：`stockpulse_chart_heights_v1`，格式：`{ main: 65, MACD: 18, RSI: 17 }`

時間軸同步：
- 主圖 `onCrosshairMove` + `subscribeVisibleTimeRangeChange` → 更新 `syncRange` state
- 所有 `SubIndicatorPanel` 接收 `syncRange` prop → `applyOptions` 時間軸（防止 loop：用 `isSyncingRef`）

---

## 實作順序

| # | 項目 | 預估時間 | 影響檔案 |
|---|------|---------|---------|
| 1 | Tab 改名 | 1 min | `useTabConfig.ts` |
| 2 | 十字線 OHLCV | 30 min | `KLineChart.tsx`、`page.tsx` |
| 3 | Ctrl+Z Undo | 30 min | `KLineChart.tsx` |
| 4 | indicatorParams 型別 + localStorage | 20 min | `lib/indicatorParams.ts`（新建） |
| 5 | KLineChart 接入 params + Legend HTML + Popover | 2.5h | `KLineChart.tsx`、`IndicatorParamPopover.tsx`（新建） |
| 6 | SubIndicatorPanel + ResizeDivider + ChartWithPanels | 3h | 3 個新元件、`page.tsx` |
| 7 | FullscreenChartModal | 1h | `FullscreenChartModal.tsx`（新建）、`page.tsx` |
| — | TypeScript check + 驗證 | 30 min | — |

**總計：約 8 小時**

---

## 驗證清單

- [x] Tab 列顯示「K線」（非「走勢圖」）
- [x] 滑鼠移到任一根K線，左側欄開高低收量即時更新；移離後還原即時報價
- [x] 右下角 ⛶ 按鈕，點後 Modal 佔滿全視窗，工具列齊全，ESC/✕ 關閉
- [x] 畫一條趨勢線 → Ctrl+Z → 消失；再畫多條 → 連按 Ctrl+Z 逐條退回
- [x] 開啟 MA，左上角出現「MA5 / MA10 / MA20 / MA60」Legend；點 MA5 → Popover 出現，修改為 8 → 套用 → 線立即重繪，重整頁面後 8 保留
- [x] 開啟 MACD，圖表下方出現獨立子面板，成交量柱狀圖完整不被遮蓋
- [x] 拖動分界線，主圖縮小子指標擴大；不可拖超過主圖 30% 下限
- [x] 同時開啟 MACD + RSI，兩個獨立面板各有分界線；十字線跨面板同步

## ✅ Sprint 5 完成摘要（commit `5a31945`，2026-06-09）

| 功能 | 新建/修改檔案 | 狀態 |
|------|------------|------|
| Tab 改名「K線」 | `hooks/useTabConfig.ts` | ✅ |
| OHLCV 十字線側欄 | `KLineChart.tsx`（`onCrosshairMove` prop + `subscribeCrosshairMove`）、`page.tsx`（`hoveredBar` state + 側欄 OHLCV block） | ✅ |
| 全螢幕 Modal | `components/chart/FullscreenChartModal.tsx`（新建）、`page.tsx`（⛶ 按鈕 + fullscreenOpen state） | ✅ |
| Ctrl+Z 撤銷畫線 | `KLineChart.tsx`（`undoStackRef`，4 個 push 點 + keydown pop）| ✅ |
| 指標參數 lib | `lib/indicatorParams.ts`（新建，`IndicatorParams` 型別 + `loadParams/saveParams`） | ✅ |
| 指標參數 Popover | `components/chart/IndicatorParamPopover.tsx`（新建，FIELDS map + 套用按鈕） | ✅ |
| KLineChart Legend | `KLineChart.tsx`（`legendItems` useMemo + Legend HTML overlay + Popover 整合）| ✅ |
| 子指標獨立面板 | `components/chart/SubIndicatorPanel.tsx`（新建，8 種指標各自 createChart） | ✅ |
| 可拖動分界線 | `components/chart/ResizeDivider.tsx`（新建，5px，mousemove delta） | ✅ |
| 面板高度管理 | `components/chart/ChartWithPanels.tsx`（新建，heights HeightMap + ResizeObserver + 最小高度限制 + localStorage） | ✅ |
| 跨面板時間軸同步 | `SubIndicatorPanel.tsx`（`subscribeVisibleLogicalRangeChange` + `isSyncingRef`） | ✅ |
| page.tsx 整合 | `page.tsx`（`indicatorParams` state + `handleParamsChange`；ChartWithPanels 替換 KLineChart；hoveredBar 側欄；fullscreenOpen + FullscreenChartModal）| ✅ |
| TypeScript | `npx tsc --noEmit` → 0 errors | ✅ |

---

## ✅ Sprint 3 完成摘要（commit `70bd3af`）

| 功能 | 檔案 | 狀態 |
|------|------|------|
| `useKeyboardShortcuts` hook（/ 聚焦、↑↓ 換股） | `hooks/useKeyboardShortcuts.ts`（新建） | ✅ |
| Header Enter 直接確認、`id="stock-search-input"`、Escape 收合 | `components/layout/Header.tsx` | ✅ |
| 搜尋結果 🇺🇸 badge，`select()` 傳 `market` | `components/layout/Header.tsx` | ✅ |
| S&P 500 ~120 股靜態清單，`search_stocks()` 回傳 `market` | `services/stock_list.py` | ✅ |
| `GET /kline/us/{symbol}`（yfinance，1h TTL，executor） | `api/v1/kline.py` | ✅ |
| `getUsKline()` + `StockItem.market?` 型別 | `lib/api.ts` | ✅ |
| market state + marketRef，US→getUsKline，無 WebSocket | `app/dashboard/page.tsx` | ✅ |
| 美股自動隱藏籌碼/回測 Tab | `app/dashboard/page.tsx` | ✅ |
| 工具列 🇺🇸 US badge，watchlist 載入供 ↑↓ | `app/dashboard/page.tsx` | ✅ |

---

## Sprint 1 + 2（已完成）

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

- [x] 走勢圖可選季K / 年K，資料正確聚合（commit `b2121b4`，後端 QE/YE 分組，前端新增按鈕）
- [x] 板塊熱力圖首頁小版（`MiniSectorBar` pill chips，commit `00ffe32`）；大盤完整版點擊板塊顯示成分股（MarketDashboard，原已有）
- [x] VWAP_BAND 指標可獨立開關，顯示 VWAP 中線 ± 1σ 通道（commit `00ffe32`，IndicatorSelector 新按鈕）
- [ ] Screener 可加 PE / 殖利率 / 毛利率 / 市值 篩選條件（**待做 — Sprint 3**）

## Sprint 2 完成摘要（2026-06-08）

| Commit | 功能 | 狀態 |
|--------|------|------|
| `b2121b4` | 季K/年K（kline.py QE/YE + PeriodSelector + TTL 30min）| ✅ |
| `b2121b4` | 修復上櫃股票報價不更新（twse_fetcher tse_\|otc_ 雙查）| ✅ |
| `00ffe32` | VWAP帶 ±1σ 通道（indicators.ts vwapBand + KLineChart 3 LineSeries + IndicatorSelector）| ✅ |
| `00ffe32` | 首頁板塊概覽 MiniSectorBar（HomeDashboard pill chips）| ✅ |
| `d6563dd` | 修復回測台股全失敗（backtest 改用 FinMind，解決 Render 被 Yahoo 封鎖問題）| ✅ |

---

---

# Sprint 3 — 資料庫優化

> 開始日期：2026-06-08  
> 目標：讓 Supabase 快取真正跑起來，減少 FinMind API 呼叫，提升整體速度

## 背景 & 問題

`kline_daily` / `chips_daily` 兩張表已建立 schema 和 index，但**從未有資料被寫入**。
原因：只有讀取路徑，沒有寫入路徑。結果每次請求都 cache miss → 打 FinMind → 慢且耗 quota。

## grill-me 決策記錄

| 問題 | 決策 |
|------|------|
| 優化目標 | 全部都做，按優先序 |
| kline 寫入策略 | A — 寫穿快取（cache miss 後立即 upsert） |
| 同步快取的表 | kline_daily + chips_daily |
| 後端寫入 key | B — 新增 `SUPABASE_SERVICE_KEY` env var，讀用 anon key，寫用 service key |
| 快取保留期限 | 5 年（只寫近 5 年內資料） |

---

## Phase 1 — 讓快取真正跑起來（最高影響力）

### 問題
`kline_daily` / `chips_daily` 表是空的，每次都 miss 到 FinMind。

### 實作清單

| # | 檔案 | 修改 |
|---|------|------|
| 1 | `apps/api/app/core/config.py` | 加 `supabase_service_key: str = ""` |
| 2 | `apps/api/app/core/supabase_client.py` | 加 `get_supabase_admin()` — 用 service_role key，專門寫入用 |
| 3 | `apps/api/app/api/v1/kline.py` | cache miss 後 `asyncio.create_task(_upsert_kline_cache)` — 5 年以內資料才寫，fire-and-forget 不阻塞 response |
| 4 | `apps/api/app/api/v1/chips.py` | 加 `_upsert_chips_cache`，FinMind 回來後 fire-and-forget upsert |
| 5 | Render 環境變數 | 加 `SUPABASE_SERVICE_KEY`（Supabase Dashboard → Settings → API → service_role key） |

### 效果
同一支股票第一次查後，後續全部命中 Supabase，不打 FinMind。

---

## Phase 2 — Schema / 索引優化

| # | 內容 |
|---|------|
| 6 | 新 migration：清理超過 5 年的資料（`DELETE WHERE date < NOW() - INTERVAL '5 years'`） |
| 7 | 新增 covering index：`idx_kline_covering ON kline_daily (symbol, date DESC) INCLUDE (open, high, low, close, volume)` |
| 8 | 新增 covering index：`idx_chips_covering ON chips_daily (symbol, date DESC) INCLUDE (foreign_buy, foreign_sell, trust_buy, trust_sell)` |

---

## Phase 3 — 可選擴充（未來）

| 資料 | TTL | 說明 |
|------|-----|------|
| `fundamental_cache` | 7天 | PE/EPS/殖利率 |
| `news_cache` | 4小時 | 減少 Yahoo scrape 頻率 |

---

## Sprint 3 驗證清單

- [x] Phase 1：kline/chips 第一次查後，Supabase Dashboard 可見到資料寫入（已確認 ✅ 2026-06-08）
- [x] Phase 1：相同股票第二次查，API log 顯示 "Supabase 命中" 而非 "cache miss"（已確認 ✅）
- [x] Phase 2：在 Supabase SQL Editor 執行 `20260609_phase2_phase3.sql`，covering index 建立完成（✅ 2026-06-09）
- [x] Phase 2：`idx_kline_covering` / `idx_chips_covering` 已建立，查詢可走 Index Only Scan
- [x] Phase 3：fundamental_cache / news_cache 表已建立，RLS + GRANT 設定完成（✅ 2026-06-09）

---

## Sprint 3 Phase 1 完成摘要（2026-06-08）

| Commit | 功能 | 狀態 |
|--------|------|------|
| `8cb7d93` | `config.py` 加 `supabase_service_key`；`supabase_client.py` 加 `get_supabase_admin()` | ✅ |
| `8cb7d93` | `kline.py` cache miss 後 fire-and-forget upsert（5年過濾） | ✅ |
| `8cb7d93` | `chips.py` 同步寫穿快取（含 date 欄位修復）| ✅ |
| Render env | 加 `SUPABASE_SERVICE_KEY`（service_role key），觸發自動重新部署 | ✅ |

### Sprint 3 全部完成（2026-06-09）

| Phase | 內容 | 狀態 |
|-------|------|------|
| Phase 1 | kline/chips 寫穿快取，讓 Supabase 真正運作 | ✅ |
| Phase 2 | covering index + cleanup_old_cache() 函式 | ✅ |
| Phase 3 | fundamental_cache / news_cache 三層快取 | ✅ |

### ⚠️ 關鍵坑：Supabase service_role 需 table-level GRANT

`service_role` 雖然繞過 RLS policy，但**仍需顯式 table-level 授權**。
若只有 RLS policy 沒有 GRANT，會看到 `permission denied for table kline_daily (code: 42501)`。

修復方式（在 Supabase SQL Editor 執行一次）：
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kline_daily  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chips_daily  TO service_role;
```

執行後資料立即開始寫入，快取生效。

---

---

# Sprint 4 — 分析 Tab 全面修復

> 完成日期：2026-06-09  
> 問題：技術面跑很久、基本面 404、財務報表 404

## 根因

所有分析相關 API 均使用 `yfinance` 抓取台股資料（`2330.TW`），而 **Render 雲端 IP 被 Yahoo Finance 封鎖**，導致：

| 症狀 | 原因 |
|------|------|
| 技術面跑 30 秒以上 | `yf.download("2330.TW", period="2y")` timeout |
| 基本面 API 404 | `yf.Ticker("2330.TW").info` 回空 dict → 404 |
| 財務報表 API 404 | `yf.Ticker("2330.TW").financials` 回空 dict → 404 |
| AI 分析生成很慢 | OHLCV fetch 就 timeout，Gemini 還未呼叫就已經慢了 |

## 修復決策（grill-me 訪談結果）

| 問題 | 修法 |
|------|------|
| 技術面 | FinMind OHLCV → 本地計算 RSI/MACD/KD/MA/布林 |
| 基本面 | A+C：FinMind PE/PB 優先 + yfinance 12s timeout 補充，永不 404 |
| 財務報表 | 台股全換 FinMind（損益表 + 現金流量表）；美股保留 yfinance |
| AI 分析 | 同技術面，OHLCV 換 FinMind，Gemini 呼叫不變 |

## Sprint 4 完成摘要（2026-06-09）

| Commit | 功能 | 狀態 |
|--------|------|------|
| `7d7410f` | 日K 預設範圍 1年→2年（週K→5年、月K→10年）| ✅ |
| `53eb059` | `finmind_service.py` 加 4 個新函式（sync kline、PER/PBR、損益表、現金流）| ✅ |
| `53eb059` | `technical.py` 台股換 FinMind OHLCV | ✅ |
| `53eb059` | `ai_analysis.py` 台股 OHLCV 換 FinMind | ✅ |
| `53eb059` | `fundamental.py` A+C：FinMind PE/PB + yfinance background | ✅ |
| `53eb059` | `financials.py` 台股全換 FinMind 財報 | ✅ |

### ⚠️ 關鍵坑：台股 yfinance 在 Render 上不穩定且慢

Yahoo Finance 對雲端 provider IP（AWS/Render 等）有限速或偶爾封鎖，台股資料（`.TW` suffix）在 Render 上：
- **技術面**：有時能跑出來，但要等 10~30 秒（timeout 邊緣）
- **基本面 / 財報**：`Ticker.info` / `Ticker.financials` 更容易被封，常回傳空資料 → 404

本機開發時 yfinance 台股正常，上 Render 就不穩定。

**解法**：台股資料統一走 FinMind API（穩定、快速），yfinance 只保留美股用途。
