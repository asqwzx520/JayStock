# Bug 復盤：K 線圖 + 子指標面板無法顯示

> **日期**：2026-06-10
> **症狀**：用戶反映「MACD/KD/RSI 按了沒反應」、「放大按鈕不見」，反覆 6+ 次修改失敗
> **真因（最後一次才找到）**：`apps/web/app/dashboard/page.tsx:645` 內層 div 缺少 `flex-1`，導致整個 K 線圖表區實際只有 ~24px 寬

---

## 為什麼花了 6+ 次才找到

每次都「猜測症狀的最近因」就動手改，沒有**直接打開瀏覽器看實際 DOM 寬高**。前 5 次的修改：

| 嘗試 | 改動 | 為什麼沒解決 |
|------|------|------------|
| #1 | KLineChart `handleScroll/handleScale` 改成 object 格式 | 修了滾輪縮放，但 sub panel 還是看不到 |
| #2 | 加 +/−/⛶ 縮放按鈕 | 跟 MACD 顯示無關 |
| #3 | ChartWithPanels 高度分配演算法重寫（記憶歷史值、防壓縮） | 演算法本來就 OK，問題不在這 |
| #4 | 子面板 wrapper 加 explicit px height、扣 divider px | 在 24px 寬的容器內，再怎麼計算高度都看不到 |
| #5 | 改成 flex-grow 比例分配 + `overflow-hidden` | 把舊有「主圖視覺溢出蓋過真實壞 layout」這個假象也修掉了，反而讓 24px 寬的 bug 暴露出來 |
| #6 | (本次) `chrome-devtools` 直接 inspect DOM | **才發現整個 chart area 只有 24px 寬** |

### 教訓

1. **症狀「看不到」≠ 元件沒 render**。應該先 `document.querySelector(...).offsetWidth/Height` 確認**實際渲染尺寸**，再判斷是 render 失敗、layout 壞還是其他。
2. **`overflow-hidden` 是雙面刃**：它可以隱藏 bug（讓溢出元素看起來像「正常顯示」），也可以暴露 bug（拿掉 overflow:visible 的視覺欺騙）。要時刻清楚父層 overflow 設定。
3. **flex 巢狀容器**：父 flex row 的子元素沒有 `flex-1` / `w-full` 時，子元素**只長到內容寬度**。如果內容是「另一個 flex-1 的子元素」，會出現 paradox — flex-1 子元素想填滿父，但父因為沒 flex-1 又只長到子元素內容寬。
4. **screenshot ≠ DOM rect**：用戶傳來的截圖看起來「主圖滿版」，其實是 canvas 溢出被外層 overflow:hidden 截邊的視覺效果。`offsetWidth` 才是真相。

---

## 真因詳細

### 破版的 layout chain

從瀏覽器 DOM 抓回的實測寬度（jaystock-web.onrender.com/dashboard）：

```
<main class="flex-1 flex flex-col min-w-0 min-h-0"     w=1920>
  <div class="flex flex-1 min-h-0"                     w=1920>
    <div class="flex h-full min-h-0 overflow-hidden"   w=1920>  ← dashboard line 644
      <div class="flex h-full min-h-0 overflow-hidden" w= 214>  ← line 645 ❌ 沒 flex-1
        <aside style="width:190px">                              ← 左側 OHLCV 欄
        <div class="flex-1 relative ..."                w=  24>  ← 圖表區（被擠成 24px）
          <ChartWithPanels>                              w=  24
            <主圖 flex 82>                              w=  24
            <MACD 子面板 flex 18>                        w=  24
```

### 為什麼用戶之前覺得 K 線圖「正常」

舊版 `ChartWithPanels` root **沒有 `overflow-hidden`**。lightweight-charts 用 `container.clientWidth` 創建 chart，得到 24px。但 chart 本身的 canvas 元素是 `position: absolute`，會**視覺上溢出**到 ChartWithPanels 外。最外層 `overflow-hidden` 把溢出截到視窗邊緣，看起來像「全寬」。

但是：
- **MACD 子面板** 被嚴格綁定在 24px 寬的 flex column 內 → 看不到
- **滑鼠互動** 只在那 24px 寬的「真實」chart 區內有效 → 用戶覺得「按了沒反應」

當我為了讓 layout 「乾淨」而加上 `overflow-hidden` 到 ChartWithPanels root（commit 70f7c45）時，主圖也被截到 24px 顯示了 — 這時破版才視覺上暴露。

---

## 修法

```diff
- <div className="flex h-full min-h-0 overflow-hidden">
+ <div className="flex flex-1 h-full min-h-0 overflow-hidden">
```

加 `flex-1` 讓 line 645 內層 div 撐滿外層的 1920px 寬度。chart-area 的 flex-1 才能真的拿到 ~1730px (1920 - 190 aside)，所有子面板才有空間。

---

## 防止再發生的工具流程

下次「元件看不到」時，**先做這 3 件事再動手改 code**：

1. `mcp__chrome-devtools__new_page` 開實際 URL
2. `evaluate_script` 跑 `document.querySelector('...').offsetWidth/Height` 確認元件**真的存在於 DOM**、實際**渲染尺寸**
3. 沿著 parent chain 一路 walk up，找出「寬度/高度突然不對」的那一層

只有當實測 DOM 確認沒問題時，才往下查 React state / store / API。
