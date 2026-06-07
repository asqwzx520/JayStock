"""
盤前 AI 精選推播服務 — M5 延遲項目

功能：
  1. 每日 08:00（台灣時間）取出 screener 快取中「外資連買 + RSI<60 + 突破 MA20」得分前 5 名
  2. 呼叫 Gemini API 為每檔生成 60 字中文理由
  3. 組裝成 HTML email 並透過 Resend API 送出（走 HTTPS，避免 Render 封鎖 SMTP port）

環境變數：
  RESEND_API_KEY     = re_xxxxxxx        (Resend 控制台取得)
  DIGEST_SMTP_USER   = your@gmail.com    (作為寄件人顯示地址，需在 Resend 驗證網域或用 onboarding@resend.dev)
  DIGEST_RECIPIENTS  = a@b.com,c@d.com   (逗號分隔)
  GEMINI_API_KEY     = ...               (已在 config.py)
"""

import asyncio
import logging
import os
import traceback
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)


# ── 取得選股快取（直接讀模組層級 dict，不觸發 refresh）─────────────────────────
def _get_cached_metrics() -> dict:
    try:
        from app.services import screener_service          # type: ignore
        return screener_service._metrics                   # type: ignore[attr-defined]
    except Exception as exc:
        logger.warning("digest: cannot read screener cache — %s", exc)
        return {}


# ── 選出 Top-5 精選個股 ────────────────────────────────────────────────────────
def _pick_top5(metrics: dict) -> list[dict]:
    """
    評分邏輯（與 screener 一致）：
      +30  外資連買 ≥ 3 天
      +20  投信連買 ≥ 3 天
      +20  突破 MA20
      +15  RSI < 60
      +15  量比 > 1.5
    取 score 前 5，依漲跌幅排序
    """
    scored = []
    for sym, m in metrics.items():
        score = 0
        fs = m.get("foreign_streak", {})
        ts = m.get("trust_streak", {})
        if fs.get("direction") == "buy" and fs.get("days", 0) >= 3:
            score += 30
        if ts.get("direction") == "buy" and ts.get("days", 0) >= 3:
            score += 20
        if m.get("above_ma20"):
            score += 20
        rsi = m.get("rsi14", 50)
        if rsi < 60:
            score += 15
        if m.get("vol_ratio", 1.0) > 1.5:
            score += 15

        if score >= 30:   # 至少要有基本門檻才入選
            scored.append({
                "symbol":         sym,
                "name":           m.get("name", sym),
                "price":          m.get("price", 0),
                "change_pct":     m.get("change_pct", 0.0),
                "rsi14":          rsi,
                "foreign_streak": fs,
                "trust_streak":   ts,
                "above_ma20":     m.get("above_ma20", False),
                "vol_ratio":      m.get("vol_ratio", 1.0),
                "score":          score,
            })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:5]


# ── Gemini：為個股生成 60 字理由 ──────────────────────────────────────────────
async def _generate_reason(stock: dict) -> str:
    """呼叫 Gemini Flash 生成 60 字內選股理由"""
    from app.core.config import settings  # type: ignore

    if not settings.gemini_api_key:
        return _fallback_reason(stock)

    prompt = (
        f"以下是一檔台股的量化數據，請用繁體中文撰寫60字以內的選股理由，"
        f"著重籌碼與技術面優勢，語氣簡潔專業：\n"
        f"股票：{stock['symbol']} {stock['name']}\n"
        f"現價：{stock['price']} 元，漲跌：{stock['change_pct']:+.2f}%\n"
        f"RSI(14)：{stock['rsi14']:.1f}\n"
        f"外資：{'連買' + str(stock['foreign_streak'].get('days',0)) + '日' if stock['foreign_streak'].get('direction')=='buy' else '無明顯買超'}\n"
        f"投信：{'連買' + str(stock['trust_streak'].get('days',0)) + '日' if stock['trust_streak'].get('direction')=='buy' else '無明顯買超'}\n"
        f"突破均線：{'是' if stock['above_ma20'] else '否'}，量比：{stock['vol_ratio']:.1f}\n"
        f"請以「{stock['name']}」開頭直接描述理由，不要加任何前綴或標號。"
    )

    try:
        import google.generativeai as genai  # type: ignore
        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None, lambda: model.generate_content(prompt)
        )
        text = resp.text.strip()
        # 截斷確保不超過 80 字（buffer for display）
        return text[:80] if len(text) > 80 else text
    except Exception as exc:
        logger.warning("Gemini reason generation failed: %s", exc)
        return _fallback_reason(stock)


def _fallback_reason(stock: dict) -> str:
    parts = []
    if stock["foreign_streak"].get("direction") == "buy":
        parts.append(f"外資連買 {stock['foreign_streak'].get('days',0)} 日")
    if stock["trust_streak"].get("direction") == "buy":
        parts.append(f"投信連買 {stock['trust_streak'].get('days',0)} 日")
    if stock["above_ma20"]:
        parts.append("站上月線")
    if stock["vol_ratio"] > 1.5:
        parts.append(f"量比 {stock['vol_ratio']:.1f} 倍放大")
    if stock["rsi14"] < 60:
        parts.append(f"RSI {stock['rsi14']:.0f} 未過熱")
    reason = "，".join(parts) or "具多項技術面優勢"
    return f"{stock['name']}：{reason}，籌碼持續改善值得關注。"


# ── 組裝 HTML email ───────────────────────────────────────────────────────────
def _build_html(picks: list[dict]) -> str:
    today = date.today().strftime("%Y/%m/%d")
    rows  = ""
    for i, s in enumerate(picks, start=1):
        change_color = "#FF3B30" if s["change_pct"] >= 0 else "#34C759"
        change_str   = f"{s['change_pct']:+.2f}%"
        reason       = s.get("reason", "")
        rows += f"""
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #1e1e2e;color:#aaa;font-size:12px">{i}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #1e1e2e">
            <strong style="color:#fff">{s['symbol']}</strong>
            <span style="color:#aaa;margin-left:6px;font-size:12px">{s['name']}</span>
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #1e1e2e;font-family:monospace;
                     color:{change_color};text-align:right">
            NT${s['price']:.2f}<br>
            <span style="font-size:11px">{change_str}</span>
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #1e1e2e;color:#ccc;font-size:12px">
            {reason}
          </td>
        </tr>"""

    return f"""
<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="UTF-8"><title>StockPulse 盤前 AI 精選 {today}</title></head>
<body style="background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans TC',sans-serif;
             margin:0;padding:20px">
  <div style="max-width:680px;margin:0 auto">
    <div style="background:#13131e;border:1px solid #1e1e2e;border-radius:12px;padding:24px">

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <div style="width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                    border-radius:8px;display:flex;align-items:center;justify-content:center;
                    font-size:18px">📊</div>
        <div>
          <h1 style="margin:0;font-size:18px;color:#fff">StockPulse AI 精選</h1>
          <p  style="margin:0;font-size:12px;color:#666">{today} 盤前精選 Top 5</p>
        </div>
      </div>

      <p style="color:#aaa;font-size:13px;line-height:1.6;margin-bottom:20px">
        以下 5 檔個股由 AI 綜合籌碼面（三大法人動向）+ 技術面（均線突破、RSI、量比）
        評分篩選，供盤前參考，非投資建議。
      </p>

      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#1a1a2e">
            <th style="padding:8px;text-align:left;color:#666;font-size:11px;font-weight:500">#</th>
            <th style="padding:8px;text-align:left;color:#666;font-size:11px;font-weight:500">股票</th>
            <th style="padding:8px;text-align:right;color:#666;font-size:11px;font-weight:500">現價</th>
            <th style="padding:8px;text-align:left;color:#666;font-size:11px;font-weight:500">AI 理由</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>

      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #1e1e2e;
                  text-align:center;color:#555;font-size:11px">
        <a href="https://stockpulse.tw" style="color:#6366f1;text-decoration:none">
          前往 StockPulse 查看完整分析 →
        </a>
        <br><br>
        本信件由 StockPulse 自動產生，僅供資訊參考，不構成投資建議。
        <a href="https://stockpulse.tw/unsubscribe" style="color:#555;text-decoration:none">取消訂閱</a>
      </div>
    </div>
  </div>
</body>
</html>"""


# ── 發送 Email（Resend API，走 HTTPS 避開 Render SMTP 封鎖）─────────────────
def _send_email(subject: str, html: str, recipients: list[str]) -> bool:
    import urllib.request
    import json

    api_key = os.environ.get("RESEND_API_KEY", "")
    from_addr = os.environ.get("DIGEST_SMTP_USER", "StockPulse <onboarding@resend.dev>")

    if not api_key:
        logger.warning("RESEND_API_KEY not configured; skipping email send")
        return False

    # 若 from_addr 只是 email 不含名稱，補上顯示名稱
    if "<" not in from_addr:
        from_addr = f"StockPulse <{from_addr}>"

    payload = json.dumps({
        "from":    from_addr,
        "to":      recipients,
        "subject": subject,
        "html":    html,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read())
            logger.info("Resend: email sent, id=%s, to=%d recipients", body.get("id"), len(recipients))
            return True
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        logger.error("Resend send failed: HTTP %s — %s\n%s", exc.code, err_body, traceback.format_exc())
        return False
    except Exception as exc:
        logger.error("Resend send failed: %s\n%s", exc, traceback.format_exc())
        return False


# ── 主入口：供 scheduler 呼叫 ─────────────────────────────────────────────────
async def run_daily_digest() -> None:
    """
    盤前 AI 精選主流程：
      1. 取快取 metrics
      2. 選出 Top-5
      3. 為每檔生成 Gemini 理由
      4. 送 email
    """
    logger.info("Daily digest: starting")

    metrics = _get_cached_metrics()
    if not metrics:
        logger.warning("Daily digest: screener cache empty, abort")
        return

    picks = _pick_top5(metrics)
    if not picks:
        logger.warning("Daily digest: no qualifying stocks, abort")
        return

    # 並行生成理由
    reasons = await asyncio.gather(
        *[_generate_reason(s) for s in picks],
        return_exceptions=True,
    )
    for s, r in zip(picks, reasons):
        s["reason"] = r if isinstance(r, str) else _fallback_reason(s)

    html = _build_html(picks)
    today = date.today().strftime("%Y/%m/%d")
    subject = f"📊 StockPulse 盤前 AI 精選 Top5 — {today}"

    recipients_raw = os.environ.get("DIGEST_RECIPIENTS", "")
    recipients = [e.strip() for e in recipients_raw.split(",") if e.strip()]
    if not recipients:
        logger.warning("DIGEST_RECIPIENTS not set; email not sent")
        # 仍視為成功（不阻塞排程）
    else:
        _send_email(subject, html, recipients)

    logger.info("Daily digest: completed, %d stocks picked", len(picks))
