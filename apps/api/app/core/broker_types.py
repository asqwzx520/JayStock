"""
券商分點分類器

三種分點類型：
  1. 外資分點   — 國際投行名稱（美林、摩根等）
  2. 投信分點   — 國內基金機構
  3. 隔日沖分點 — 已知名單 + 演算法偵測（買今賣明 or 賣今買明）
"""
from __future__ import annotations

# ── 外資慣用分點（國際投行子字串，模糊比對）────────────────────────────────────
FOREIGN_BROKER_SUBSTRINGS: list[str] = [
    "美林", "摩根士丹利", "摩根大通", "高盛", "花旗",
    "瑞銀", "野村", "德意志", "匯豐", "法興",
    "巴克萊", "瑞信", "麥格里", "渣打", "里昂",
    "港商", "外商",
]

# ── 投信慣用分點 ───────────────────────────────────────────────────────────────
TRUST_BROKER_SUBSTRINGS: list[str] = [
    "投信", "基金", "asset", "fund",
]

# ── 已知隔日沖分點（名稱子字串）───────────────────────────────────────────────
DAYTRADE_BROKER_SUBSTRINGS: list[str] = [
    "凱基", "元大", "富邦", "群益金鼎", "群益",
    "統一", "永豐金", "永豐", "台新", "兆豐",
    "第一金", "華南", "合庫", "玉山", "日盛",
    "大展", "大昌", "宏遠", "新光", "高橋",
    "康和", "大慶", "萬寶", "信昌", "亨泰",
]


def classify_broker(broker_name: str) -> str:
    """
    回傳 'foreign' | 'trust' | 'daytrade' | 'general'
    優先級：外資 > 投信 > 隔日沖 > 一般
    """
    low = broker_name.lower()
    if any(s in low for s in FOREIGN_BROKER_SUBSTRINGS):
        return "foreign"
    if any(s in low for s in TRUST_BROKER_SUBSTRINGS):
        return "trust"
    if any(s in low for s in DAYTRADE_BROKER_SUBSTRINGS):
        return "daytrade"
    return "general"


def is_known_daytrade(broker_name: str) -> bool:
    low = broker_name.lower()
    return any(s in low for s in DAYTRADE_BROKER_SUBSTRINGS)


def detect_daytrade_rate(
    records: list[dict],   # [{"date": "2024-01-02", "buy": 500, "sell": 200}, ...]
    threshold: int = 100,  # 至少幾張才算有效交易
) -> float:
    """
    計算隔日沖逆轉率 0.0–1.0。
    買方隔日沖：今天買 ≥ threshold，隔天賣 ≥ 今天買 × 50%。
    賣方隔日沖：今天賣 ≥ threshold，隔天買 ≥ 今天賣 × 50%。
    """
    if len(records) < 3:
        return 0.0

    sorted_r = sorted(records, key=lambda r: r["date"])
    hit = 0
    eligible = 0

    for i in range(len(sorted_r) - 1):
        b0 = sorted_r[i].get("buy", 0)
        s0 = sorted_r[i].get("sell", 0)
        b1 = sorted_r[i + 1].get("buy", 0)
        s1 = sorted_r[i + 1].get("sell", 0)

        if b0 >= threshold:
            eligible += 1
            if s1 >= b0 * 0.5:
                hit += 1
        if s0 >= threshold:
            eligible += 1
            if b1 >= s0 * 0.5:
                hit += 1

    return round(hit / eligible, 3) if eligible > 0 else 0.0
