#!/usr/bin/env bash
# ============================================================
# JayStock Render 環境變數一鍵設定腳本（Bash 版）
# 執行前：填入下方 === 設定區 === 內的值
# 執行方式：chmod +x scripts/setup-render-env.sh && ./scripts/setup-render-env.sh
# ============================================================

# === 設定區（填入你的資訊）===========================

RENDER_API_KEY="rnd_xxxxxxxxxxxxxxxx"       # https://dashboard.render.com/u/settings#api-keys
FRONTEND_SERVICE_ID="srv-xxxxxxxxxxxxxxxx"  # JayStock-Web 服務 URL 中的 ID
BACKEND_SERVICE_ID="srv-xxxxxxxxxxxxxxxx"   # JayStock 後端服務 URL 中的 ID

# Google OAuth（前端）
AUTH_SECRET=""         # npx auth secret
AUTH_GOOGLE_ID=""      # Google Cloud Console Client ID
AUTH_GOOGLE_SECRET=""  # Google Cloud Console Client Secret

# Daily AI Email（後端）
SMTP_USER=""           # xxx@gmail.com
SMTP_PASS=""           # xxxx xxxx xxxx xxxx  (Gmail App Password)
SMTP_RECIPIENTS=""     # a@b.com,c@d.com

# ====================================================

set_env() {
  local SERVICE_ID=$1
  local SERVICE_NAME=$2
  shift 2
  local ENV_JSON="["
  local first=true
  while [[ $# -gt 0 ]]; do
    local KEY=$1; local VAL=$2; shift 2
    [[ -z "$VAL" ]] && continue
    $first || ENV_JSON+=","
    ENV_JSON+="{\"key\":\"$KEY\",\"value\":\"$VAL\"}"
    first=false
  done
  ENV_JSON+="]"

  echo ""
  echo "🔧 設定 $SERVICE_NAME ($SERVICE_ID)..."
  curl -s -X PUT \
    "https://api.render.com/v1/services/$SERVICE_ID/env-vars" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"envVars\":$ENV_JSON}" | python3 -c "
import sys,json
r=json.load(sys.stdin)
print(f'✅ 已更新 {len(r)} 個環境變數')
" 2>/dev/null || echo "✅ 請求已送出"
}

# 前端 OAuth
set_env "$FRONTEND_SERVICE_ID" "JayStock-Web（前端）" \
  AUTH_SECRET        "$AUTH_SECRET" \
  AUTH_GOOGLE_ID     "$AUTH_GOOGLE_ID" \
  AUTH_GOOGLE_SECRET "$AUTH_GOOGLE_SECRET"

# 後端 SMTP
set_env "$BACKEND_SERVICE_ID" "JayStock（後端）" \
  DIGEST_SMTP_USER  "$SMTP_USER" \
  DIGEST_SMTP_PASS  "$SMTP_PASS" \
  DIGEST_RECIPIENTS "$SMTP_RECIPIENTS"

echo ""
echo "🚀 完成！Render 將自動觸發 redeploy（約 3-5 分鐘）"
echo "📌 前端：https://jaystock-web.onrender.com"
echo "📌 後端：https://jaystock.onrender.com/docs"
