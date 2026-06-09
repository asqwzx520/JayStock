# 部署指南：Tier 雙層快取架構

> 本文件配合 `docs/TIER-CACHE-REFACTOR.md` 一起服用
> 適用於：Render Free + Supabase Free 的生產環境

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

---

## 2. Render 環境變數

到 Render Dashboard → 你的 API service → **Environment**，新增：

```
ADMIN_TOKEN=<生一個 32 字元隨機字串，e.g. openssl rand -hex 16>
FINNHUB_API_KEY=                       # 留空即可，之後申請了再填
ENABLE_MOPS_SCRAPER=true
```

舊有的 env vars（`SUPABASE_URL`、`SUPABASE_KEY`、`SUPABASE_SERVICE_KEY`、`FINMIND_TOKEN`）維持不動。

---

## 3. 部署 + 冷啟動

```bash
# 1. Push 觸發 Render auto-deploy
git push origin main

# 2. 等 Render build 完成（看 dashboard）

# 3. 冷啟動 backfill（背景跑，~30 分鐘）
curl -X POST https://your-api.onrender.com/api/v1/admin/backfill?days=90 \
  -H "X-Admin-Token: $ADMIN_TOKEN"

# 4. 查 backfill 狀態
curl https://your-api.onrender.com/api/v1/admin/schedule-status \
  -H "X-Admin-Token: $ADMIN_TOKEN"

# 5. 查未解決失敗（看哪些股沒抓到）
curl https://your-api.onrender.com/api/v1/admin/cache-failures \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

---

## 4. Render Free spin-down 防護（cron-job.org keepalive）

Render Free 服務 15 分鐘沒流量會 spin down → APScheduler 在 sleep 期間不會跑。

**解法**：用免費 [cron-job.org](https://cron-job.org) 每 10 分鐘 ping `/api/v1/health/ping`。

設定步驟：
1. 註冊 cron-job.org（免費）
2. **Create cronjob**
3. URL：`https://your-api.onrender.com/api/v1/health/ping`
4. Schedule：**every 10 minutes**
5. Save

驗證：cron-job.org dashboard 應顯示連續成功的 200 OK ping。

> 長期建議：升級 Render Starter ($7/月)，無 spin-down 問題且效能更好。

---

## 5. 排程任務驗證

| 排程 | 時間 | 預期 |
|------|------|------|
| `daily_chips_full` | 14:10 | `chips_daily` 新增 ~1700 筆當日資料 |
| `daily_snapshot_full` | 14:35 | `daily_snapshot` 新增 ~1700 筆 |
| `daily_kline_tier1` | 15:00 | `kline_daily` 新增 ~250 × 90 筆 |
| `daily_financials_tier1` | 15:30 | `financials_quarterly` 新增 ~250 筆 |
| `daily_news_tier1` | 15:45 | `news_cache` 新增上百筆（去重後） |
| `weekly_tdcc` | 週四 17:30 | `tdcc_ownership` 新增一週資料 |
| `weekly_recompute_tier1` | 週日 02:00 | `tier1_universe` 全部 refresh |
| `monthly_revenue` | 每月 11 日 09:00 | `monthly_revenue` 新增上月 |
| `intraday_indices` | 盤中每 5 分鐘 | in-process cache 預熱 |

驗證查詢（Supabase SQL Editor）：
```sql
SELECT date, COUNT(*) FROM chips_daily   GROUP BY date ORDER BY date DESC LIMIT 5;
SELECT date, COUNT(*) FROM daily_snapshot GROUP BY date ORDER BY date DESC LIMIT 5;
SELECT COUNT(*) FROM tier1_universe;
SELECT * FROM cache_failures WHERE resolved = false ORDER BY created_at DESC LIMIT 20;
```

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

---

## 7. Finnhub 申請（之後再做）

1. 註冊 [finnhub.io](https://finnhub.io)（免費）
2. Dashboard 拿 API key
3. Render → Environment → 設 `FINNHUB_API_KEY=xxx`
4. 重啟服務，美股新聞自動加入 Finnhub 源
