# 部署指南：Tier 雙層快取架構

> 本文件配合 `docs/TIER-CACHE-REFACTOR.md` 一起服用
> 適用於：Render Free + Supabase Free 的生產環境

---

## 部署狀態（2026-06-10 完成）

| 項目 | 狀態 |
|------|------|
| 8 個 commit push | ✅ |
| Supabase migration（7 張新表） | ✅ |
| Supabase RLS 權限修復 | ✅ |
| Render 3 個新 env vars | ✅ |
| 10 個排程 job 掛上 | ✅ |
| UptimeRobot keepalive（每 5 分鐘） | ✅ |
| 冷啟動 backfill 90 天 | ✅ 零失敗 |

---

## 1. Supabase Schema migration

1. 進入 Supabase Dashboard → **SQL Editor** → **New query**
2. 將 `supabase/migrations/20260610_tier_cache_architecture.sql` 全部複製貼上
3. **Run**
4. 驗證：左側 **Table Editor** 應看到 7 張新表：
   - `daily_snapshot`
   - `financials_quarterly`
   - `monthly_revenue`
   - `news_cache`
   - `tdcc_ownership`
   - `tier1_universe`
   - `cache_failures`

### ⚠️ 已知坑：news_cache 表衝突

若遇到錯誤 `ERROR: 42703: column "published_at" does not exist`，原因是舊的 `news_cache` 表 schema 不同。

**修法**：先在 SQL Editor 執行：
```sql
DROP TABLE IF EXISTS news_cache CASCADE;
```
然後重新貼上完整 migration SQL 再 Run。

### ⚠️ 已知坑：service_role 權限不足

若 admin endpoint 回傳 `permission denied for table ...`，執行以下 GRANT 修復：

```sql
-- service_role 寫入權限（API job 用）
GRANT ALL ON public.cache_failures       TO service_role;
GRANT ALL ON public.daily_snapshot       TO service_role;
GRANT ALL ON public.financials_quarterly TO service_role;
GRANT ALL ON public.monthly_revenue      TO service_role;
GRANT ALL ON public.news_cache           TO service_role;
GRANT ALL ON public.tdcc_ownership       TO service_role;
GRANT ALL ON public.tier1_universe       TO service_role;

-- anon 公開讀取（前端用）
GRANT SELECT ON public.daily_snapshot       TO anon;
GRANT SELECT ON public.financials_quarterly TO anon;
GRANT SELECT ON public.monthly_revenue      TO anon;
GRANT SELECT ON public.news_cache           TO anon;
GRANT SELECT ON public.tdcc_ownership       TO anon;
GRANT SELECT ON public.tier1_universe       TO anon;
```

---

## 2. Render 環境變數

到 Render Dashboard → 你的 API service → **Environment**，新增 3 個（**不要動現有的**）：

```
ADMIN_TOKEN=<生一個 32 字元隨機字串>
FINNHUB_API_KEY=           # 留空，之後申請了再填
ENABLE_MOPS_SCRAPER=true
```

> PowerShell 產生隨機 token：
> ```powershell
> -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
> ```

現有 env vars 維持不動：`SUPABASE_URL`、`SUPABASE_KEY`、`SUPABASE_SERVICE_KEY`、`FINMIND_TOKEN`、`GEMINI_API_KEY`、`GROQ_API_KEY`、`CORS_ORIGINS`。

---

## 3. 部署 + 冷啟動

```powershell
# Windows PowerShell（用 curl.exe，不是 curl）

# 1. 確認服務活著
curl.exe https://jaystock.onrender.com/api/v1/health/ping
# 預期回: {"status":"alive"}

# 2. 確認 10 個排程 job 都掛上
curl.exe https://jaystock.onrender.com/api/v1/admin/schedule-status `
  -H "X-Admin-Token: <你的ADMIN_TOKEN>"

# 3. 冷啟動 backfill（背景跑，~30 分鐘，跑完後 PowerShell 可以關）
curl.exe -X POST "https://jaystock.onrender.com/api/v1/admin/backfill?days=90" `
  -H "X-Admin-Token: <你的ADMIN_TOKEN>"

# 4. 30 分鐘後查失敗清單（應回 {"rows":[],"total":0}）
curl.exe https://jaystock.onrender.com/api/v1/admin/cache-failures `
  -H "X-Admin-Token: <你的ADMIN_TOKEN>"
```

Supabase 驗證：
```sql
SELECT date, COUNT(*) as cnt FROM kline_daily   GROUP BY date ORDER BY date DESC LIMIT 5;
SELECT date, COUNT(*) as cnt FROM chips_daily   GROUP BY date ORDER BY date DESC LIMIT 5;
SELECT date, COUNT(*) as cnt FROM daily_snapshot GROUP BY date ORDER BY date DESC LIMIT 5;
SELECT COUNT(*) FROM tier1_universe;
```

---

## 4. Render Free spin-down 防護（UptimeRobot keepalive）

Render Free 服務 15 分鐘沒流量會 spin down → APScheduler 在 sleep 期間不會跑。

**解法**：用免費 [UptimeRobot](https://uptimerobot.com) 每 5 分鐘 ping `/api/v1/health/ping`。

設定步驟：
1. 登入 uptimerobot.com（免費）
2. **+ Add New Monitor**
3. Monitor Type：**HTTP(s)**
4. URL：`https://jaystock.onrender.com/api/v1/health/ping`
5. Monitoring Interval：**5 minutes**
6. 建議開啟 Email Alert，服務掛掉時自動通知

> 備選：[cron-job.org](https://cron-job.org) 每 10 分鐘也可以（免費）。
> 長期建議：升級 Render Starter ($7/月)，無 spin-down 問題且效能更好。

---

## 5. 排程任務驗證

| 排程 | 時間 | 預期 |
|------|------|------|
| `intraday_indices` | 盤中每 5 分鐘 | in-process cache 預熱 |
| `check_price_alerts` | 每 5 分鐘 | 價格警示推播 |
| `daily_chips_full` | 週一~五 14:10 | `chips_daily` 新增 ~1700 筆當日資料 |
| `daily_snapshot_full` | 週一~五 14:35 | `daily_snapshot` 新增 ~1700 筆 |
| `daily_kline_tier1` | 週一~五 15:00 | `kline_daily` 新增 ~250 筆 |
| `daily_financials_tier1` | 週一~五 15:30 | `financials_quarterly` 新增 ~250 筆 |
| `daily_news_tier1` | 週一~五 15:45 | `news_cache` 新增上百筆（去重後） |
| `monthly_revenue` | 每月 11 日 09:00 | `monthly_revenue` 新增上月 |
| `weekly_tdcc` | 週四 17:30 | `tdcc_ownership` 新增一週資料 |
| `weekly_recompute_tier1` | 週日 02:00 | `tier1_universe` 全部 refresh |

---

## 6. 故障排除

| 症狀 | 排查 |
|------|------|
| API 5xx 持續 | `GET /api/v1/admin/cache-failures` 看哪個 job 連續失敗 |
| 某 job 沒跑 | `GET /api/v1/admin/schedule-status` 看 `next_run` 是否未來時間 |
| 想手動補資料 | `POST /api/v1/admin/trigger-job/{job_id}` 立即執行 |
| Tier1 universe 不更新 | `POST /api/v1/admin/recompute-tier1` 強制重算 |
| 單檔資料缺 | `POST /api/v1/admin/backfill/{symbol}?days=90` lazy backfill |
| MOPS 爬蟲全失敗 | 暫時設 `ENABLE_MOPS_SCRAPER=false`，會自動 fallback FinMind |
| permission denied for table | 執行第 1 節的 GRANT SQL |

---

## 7. 後續可選任務

### A. ChipsTab 前端顯示 TDCC 資料

後端 `/api/v1/ownership/{symbol}` 已可回傳 TDCC 持股分布，但前端 `ChipsTab.tsx` 的「券商分點」區塊尚未更新。

待做事項：
- 呼叫 `getOwnership(symbol)` API（`apps/web/lib/api.ts` 已有型別定義）
- 在 ChipsTab 新增 TDCC 持股分布圖表（散戶% vs 大戶% 歷史趨勢）
- 移除或保留舊的「券商分點」顯示，改為顯示 TDCC 週資料

### B. Finnhub API key（美股新聞補強）

1. 註冊 [finnhub.io](https://finnhub.io)（免費，60 req/min）
2. Dashboard 拿 API key
3. Render → Environment → 設 `FINNHUB_API_KEY=xxx`
4. 重啟服務，StockNews 來源篩選自動多出「Finnhub」選項
