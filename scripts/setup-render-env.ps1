# ============================================================
# JayStock Render 環境變數一鍵設定腳本
# 執行前：填入下方 === 設定區 === 內的值
# 執行方式：在 PowerShell 執行 .\scripts\setup-render-env.ps1
# ============================================================

# === 設定區（填入你的資訊）===========================

# Render API Key — 從 https://dashboard.render.com/u/settings#api-keys 取得
$RENDER_API_KEY = "rnd_xxxxxxxxxxxxxxxx"

# Render 前端服務 ID — 在 JayStock-Web 服務頁面 URL 中找（srv-xxxxx）
$FRONTEND_SERVICE_ID = "srv-xxxxxxxxxxxxxxxx"

# Render 後端服務 ID — 在 JayStock 後端服務頁面 URL 中找（srv-xxxxx）
$BACKEND_SERVICE_ID  = "srv-xxxxxxxxxxxxxxxx"

# Google OAuth（前端服務）
$AUTH_SECRET         = ""   # 執行 npx auth secret 產生，或用 openssl rand -base64 32
$AUTH_GOOGLE_ID      = ""   # Google Cloud Console → OAuth Client ID
$AUTH_GOOGLE_SECRET  = ""   # Google Cloud Console → OAuth Client Secret

# Daily AI Email（後端服務）
$SMTP_USER           = ""   # 你的 Gmail 地址（如 xxx@gmail.com）
$SMTP_PASS           = ""   # Gmail App Password（16位，如 xxxx xxxx xxxx xxxx）
$SMTP_RECIPIENTS     = ""   # 收件信箱，多個以逗號分隔（如 a@b.com,c@d.com）

# ====================================================

$headers = @{
    "Authorization" = "Bearer $RENDER_API_KEY"
    "Content-Type"  = "application/json"
}

function Set-RenderEnvVars {
    param(
        [string]$ServiceId,
        [hashtable]$EnvVars,
        [string]$ServiceName
    )

    Write-Host "`n🔧 設定 $ServiceName ($ServiceId)..."

    # 先取得現有 env vars（Render API 需要全量更新）
    $existing = Invoke-RestMethod `
        -Uri "https://api.render.com/v1/services/$ServiceId/env-vars" `
        -Headers $headers `
        -Method GET

    # 合併：保留現有，用新值覆蓋
    $merged = @{}
    foreach ($item in $existing) {
        $merged[$item.envVar.key] = $item.envVar.value
    }
    foreach ($kv in $EnvVars.GetEnumerator()) {
        if ($kv.Value -ne "") {
            $merged[$kv.Key] = $kv.Value
        }
    }

    # 組成 PUT body
    $body = @{
        envVars = @(
            foreach ($kv in $merged.GetEnumerator()) {
                @{ key = $kv.Key; value = $kv.Value }
            }
        )
    } | ConvertTo-Json -Depth 10

    $result = Invoke-RestMethod `
        -Uri "https://api.render.com/v1/services/$ServiceId/env-vars" `
        -Headers $headers `
        -Method PUT `
        -Body $body

    Write-Host "✅ $ServiceName 環境變數已更新（$($merged.Count) 個）"
}

# ── 前端：設定 Google OAuth ──────────────────────────────────
$frontendVars = @{
    "AUTH_SECRET"        = $AUTH_SECRET
    "AUTH_GOOGLE_ID"     = $AUTH_GOOGLE_ID
    "AUTH_GOOGLE_SECRET" = $AUTH_GOOGLE_SECRET
}
Set-RenderEnvVars -ServiceId $FRONTEND_SERVICE_ID -EnvVars $frontendVars -ServiceName "JayStock-Web（前端）"

# ── 後端：設定 SMTP Email ────────────────────────────────────
$backendVars = @{
    "DIGEST_SMTP_USER"  = $SMTP_USER
    "DIGEST_SMTP_PASS"  = $SMTP_PASS
    "DIGEST_RECIPIENTS" = $SMTP_RECIPIENTS
}
Set-RenderEnvVars -ServiceId $BACKEND_SERVICE_ID -EnvVars $backendVars -ServiceName "JayStock（後端）"

Write-Host "`n🚀 完成！Render 將自動觸發 redeploy（約 3-5 分鐘）"
Write-Host "📌 前端：https://jaystock-web.onrender.com"
Write-Host "📌 後端：https://jaystock.onrender.com/docs"
