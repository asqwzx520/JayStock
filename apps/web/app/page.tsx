"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

/* ─── Ticker data ──────────────────────────────────────────────────── */
const TICKER_ITEMS = [
  { sym: "2330", price: "NT$935.00", pct: "+2.14%", up: true },
  { sym: "2454", price: "NT$1,065",  pct: "+1.38%", up: true },
  { sym: "2317", price: "NT$193.5",  pct: "-0.77%", up: false },
  { sym: "2382", price: "NT$246.5",  pct: "+3.21%", up: true },
  { sym: "2308", price: "NT$38.50",  pct: "-1.02%", up: false },
  { sym: "3008", price: "NT$632.0",  pct: "+0.95%", up: true },
  { sym: "6505", price: "NT$385.0",  pct: "-0.26%", up: false },
  { sym: "2412", price: "NT$116.5",  pct: "+1.74%", up: true },
  { sym: "TAIEX", price: "23,412",   pct: "+1.08%", up: true },
  { sym: "2303", price: "NT$49.60",  pct: "-2.17%", up: false },
];

/* ─── Metrics ──────────────────────────────────────────────────────── */
const METRICS = [
  { label: "追蹤個股", val: "900+",   sub: "涵蓋全台上市上櫃" },
  { label: "AI 分析準確率", val: "87.3%", sub: "vs. 上季 ↑4.2%" },
  { label: "每日精選推播", val: "08:00", sub: "盤前 AI Top-5 選股" },
  { label: "資料延遲",   val: "<15s",  sub: "即時 WebSocket 推播" },
];

/* ─── Features ─────────────────────────────────────────────────────── */
const FEATURES = [
  { icon: "📈", title: "即時 K 線圖", body: "基於 lightweight-charts 的高效能圖表，支援 K 線、面積圖、成交量直方圖，滑順呈現千根 K 棒毫無卡頓。", tag: "lightweight-charts v5" },
  { icon: "🤖", title: "Gemini AI 分析", body: "每日盤前自動分析 Top-5 精選個股，結合外資、投信籌碼與技術面，生成 60 字專業選股理由，直達信箱。", tag: "Gemini Flash" },
  { icon: "⚖️", title: "多股比較走勢", body: "最多 4 檔個股同場競技，以同一基準點標準化，讓真正的強勢標的無所遁形，搭配 AI 比較報告。", tag: "1M / 3M / 1Y / 5Y" },
  { icon: "🔍", title: "籌碼選股器", body: "外資連買 ≥3 日 × RSI<60 × 突破 MA20 × 量比>1.5，多維度加權評分，快速定位強勢潛力股。", tag: "Momentum Template" },
  { icon: "📡", title: "Web Push 通知", body: "VAPID 推播協議，無需 APP 即可接收盤中重大訊號、突破提醒，真正做到盤前掌握先機。", tag: "VAPID + Service Worker" },
  { icon: "⚡", title: "極速骨架加載", body: "所有頁面皆配置 Next.js 14 Streaming Skeleton，視覺回饋即時，告別白屏等待，感受飛快的交互節奏。", tag: "Next.js 14 Streaming" },
];

/* ─── Compare stocks ───────────────────────────────────────────────── */
const COMPARE_STOCKS = [
  { sym: "2382", name: "廣達", sub: "外資連買 7 日｜突破 MA20", pct: "+24.3%", up: true,  color: "#22c55e" },
  { sym: "2330", name: "台積電", sub: "AI 題材持續加持",        pct: "+18.7%", up: true,  color: "#4f6ef7" },
  { sym: "2454", name: "聯發科", sub: "整理格局，量縮觀望",     pct: "+11.2%", up: true,  color: "#f59e0b" },
  { sym: "2317", name: "鴻海",   sub: "外資持續賣超，偏弱",     pct: "-12.8%", up: false, color: "#f43f5e" },
];

/* ─── AI picks ─────────────────────────────────────────────────────── */
const AI_PICKS = [
  { rank: "01", sym: "6669", name: "緯穎科技", score: "95分" },
  { rank: "02", sym: "3034", name: "聯詠",     score: "88分" },
  { rank: "03", sym: "2379", name: "瑞昱",     score: "82分" },
  { rank: "04", sym: "2382", name: "廣達",     score: "79分" },
  { rank: "05", sym: "6415", name: "矽力-KY",  score: "74分" },
];

/* ─── Scroll-reveal hook ───────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add("lp-visible"); io.disconnect(); } },
      { threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/* ─── Reveal wrapper ───────────────────────────────────────────────── */
function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useReveal();
  return (
    <div
      ref={ref}
      className="lp-reveal"
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   LANDING PAGE
══════════════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <>
      {/* ── Inline CSS (landing-only; won't bleed into /dashboard) ── */}
      <style>{`
        /* Google Fonts */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&family=JetBrains+Mono:wght@300;400;600&display=swap');

        :root {
          --lp-bg:      #03030a;
          --lp-bg1:     #07070f;
          --lp-bg2:     #0d0d1a;
          --lp-accent:  #4f6ef7;
          --lp-accent2: #7c5cfa;
          --lp-up:      #00e5a0;
          --lp-down:    #ff3b5c;
          --lp-text:    #f0f0f8;
          --lp-muted:   #555576;
          --lp-border:  rgba(255,255,255,0.06);
        }

        .lp-root {
          background: var(--lp-bg);
          color: var(--lp-text);
          font-family: 'Inter', 'Noto Sans TC', sans-serif;
          overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
          min-height: 100vh;
        }

        /* scroll reveal */
        .lp-reveal {
          opacity: 0;
          transform: translateY(28px);
          transition: opacity .7s ease, transform .7s ease;
        }
        .lp-reveal.lp-visible {
          opacity: 1;
          transform: none;
        }

        /* nav */
        .lp-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 100;
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 48px;
          background: rgba(3,3,10,.75);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--lp-border);
        }
        .lp-logo {
          display: flex; align-items: center; gap: 10px;
          font-size: 14px; font-weight: 700; letter-spacing: .1em;
          text-transform: uppercase; color: var(--lp-text); text-decoration: none;
        }
        .lp-logo-mark {
          width: 28px; height: 28px;
          background: linear-gradient(135deg, var(--lp-accent), var(--lp-accent2));
          border-radius: 7px;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px;
        }
        .lp-nav-links { display: flex; gap: 32px; }
        .lp-nav-links a {
          color: var(--lp-muted); text-decoration: none;
          font-size: 13px; font-weight: 500; letter-spacing: .04em;
          transition: color .2s;
        }
        .lp-nav-links a:hover { color: var(--lp-text); }
        .lp-nav-cta {
          padding: 9px 22px;
          background: var(--lp-accent);
          border-radius: 6px; color: #fff;
          font-size: 13px; font-weight: 600;
          text-decoration: none; transition: opacity .2s;
        }
        .lp-nav-cta:hover { opacity: .85; }

        /* hero */
        .lp-hero {
          min-height: 100vh;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          position: relative; overflow: hidden;
          padding: 140px 48px 80px; text-align: center;
        }
        .lp-hero::before {
          content: '';
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(79,110,247,.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(79,110,247,.04) 1px, transparent 1px);
          background-size: 64px 64px;
          animation: lpGridDrift 20s linear infinite;
        }
        .lp-hero::after {
          content: ''; position: absolute; inset: 0;
          background: radial-gradient(ellipse 70% 50% at 50% 40%,
            rgba(79,110,247,.14) 0%, rgba(124,92,250,.05) 50%, transparent 100%);
          pointer-events: none;
        }
        @keyframes lpGridDrift {
          from { transform: translateY(0); } to { transform: translateY(64px); }
        }

        .lp-badge {
          position: relative; z-index: 1;
          display: inline-flex; align-items: center; gap: 7px;
          padding: 5px 14px; border-radius: 99px;
          border: 1px solid rgba(79,110,247,.4);
          background: rgba(79,110,247,.08);
          font-size: 11px; font-weight: 700; letter-spacing: .12em;
          text-transform: uppercase; color: var(--lp-accent);
          margin-bottom: 32px;
          animation: lpFadeUp .8s ease both;
        }
        .lp-badge-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: var(--lp-accent); animation: lpPulse 2s infinite;
        }
        @keyframes lpPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes lpFadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:none} }

        .lp-h1 {
          position: relative; z-index: 1;
          font-size: clamp(52px, 9vw, 112px);
          font-weight: 900; line-height: .95; letter-spacing: -.03em;
          animation: lpFadeUp .9s .1s ease both;
        }
        .lp-h1-grad {
          background: linear-gradient(135deg,#6b8fff 0%,#a78bfa 50%,#c9a94a 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .lp-hero-sub {
          position: relative; z-index: 1;
          margin-top: 28px; max-width: 520px;
          font-size: 17px; line-height: 1.75; color: var(--lp-muted);
          animation: lpFadeUp 1s .2s ease both;
        }
        .lp-hero-btns {
          position: relative; z-index: 1;
          display: flex; gap: 14px; margin-top: 44px;
          animation: lpFadeUp 1s .3s ease both;
        }
        .lp-btn-primary {
          padding: 14px 32px;
          background: linear-gradient(135deg, var(--lp-accent), var(--lp-accent2));
          border-radius: 8px; color: #fff;
          font-size: 15px; font-weight: 700; text-decoration: none;
          letter-spacing: .02em;
          box-shadow: 0 0 40px rgba(79,110,247,.35);
          transition: transform .2s, box-shadow .2s;
        }
        .lp-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 0 60px rgba(79,110,247,.5); }
        .lp-btn-ghost {
          padding: 14px 32px; border-radius: 8px; color: var(--lp-muted);
          font-size: 15px; font-weight: 500;
          border: 1px solid var(--lp-border); text-decoration: none;
          transition: color .2s, border-color .2s;
        }
        .lp-btn-ghost:hover { color: var(--lp-text); border-color: rgba(255,255,255,.2); }

        /* ticker */
        .lp-ticker-wrap {
          position: relative; z-index: 1;
          margin-top: 72px; width: 100%; overflow: hidden;
          border-top: 1px solid var(--lp-border);
          border-bottom: 1px solid var(--lp-border);
          padding: 13px 0;
          animation: lpFadeUp 1s .4s ease both;
        }
        .lp-ticker { display: flex; gap: 52px; animation: lpTickerScroll 32s linear infinite; width: max-content; }
        .lp-ticker:hover { animation-play-state: paused; }
        @keyframes lpTickerScroll { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        .lp-tick { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
        .lp-tick-sym { font-family:'JetBrains Mono',monospace; font-size:12px; font-weight:700; color:var(--lp-text); }
        .lp-tick-price { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--lp-muted); }
        .lp-tick-chg {
          font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:700;
          padding:2px 7px; border-radius:4px;
        }
        .lp-chg-up   { color: var(--lp-up);   background: rgba(0,229,160,.1); }
        .lp-chg-down { color: var(--lp-down);  background: rgba(255,59,92,.1); }

        /* metrics */
        .lp-metrics {
          display: grid; grid-template-columns: repeat(4,1fr);
          border-top: 1px solid var(--lp-border);
          border-bottom: 1px solid var(--lp-border);
        }
        .lp-metric {
          padding: 44px 48px;
          border-right: 1px solid var(--lp-border);
          transition: background .3s;
        }
        .lp-metric:last-child { border-right: none; }
        .lp-metric:hover { background: var(--lp-bg2); }
        .lp-metric-label {
          font-size: 10px; font-weight: 700; letter-spacing: .14em;
          text-transform: uppercase; color: var(--lp-muted); margin-bottom: 14px;
        }
        .lp-metric-val {
          font-family: 'JetBrains Mono', monospace;
          font-size: clamp(28px, 3.5vw, 46px); font-weight: 600; line-height: 1;
          background: linear-gradient(135deg,#fff 60%,var(--lp-muted));
          -webkit-background-clip:text; -webkit-text-fill-color:transparent;
        }
        .lp-metric-sub { margin-top: 8px; font-size: 12px; color: var(--lp-muted); }

        /* section shared */
        .lp-section { padding: 120px 48px; }
        .lp-section-label {
          font-size: 11px; font-weight: 700; letter-spacing: .14em;
          text-transform: uppercase; color: var(--lp-accent); margin-bottom: 16px;
        }
        .lp-section-title {
          font-size: clamp(34px,5vw,62px);
          font-weight: 900; line-height: 1.05; letter-spacing: -.025em;
          max-width: 640px;
        }
        .lp-section-body {
          font-size: 16px; line-height: 1.75; color: var(--lp-muted);
          max-width: 520px; margin-top: 20px;
        }

        /* dashboard preview */
        .lp-preview-wrap { padding: 0 48px 120px; display:flex; flex-direction:column; align-items:center; }
        .lp-preview-frame {
          width:100%; max-width:1160px;
          border-radius:16px; border:1px solid var(--lp-border);
          background:var(--lp-bg1); overflow:hidden;
          box-shadow: 0 0 0 1px rgba(255,255,255,.03),
                      0 60px 120px -20px rgba(0,0,0,.8),
                      0 0 80px rgba(79,110,247,.07);
        }
        .lp-frame-bar {
          display:flex; align-items:center; gap:8px;
          padding:13px 18px; border-bottom:1px solid var(--lp-border);
          background:rgba(255,255,255,.02);
        }
        .lp-dot { width:11px; height:11px; border-radius:50%; }
        .lp-frame-url {
          flex:1; text-align:center;
          font-size:11px; color:var(--lp-muted); font-family:'JetBrains Mono',monospace;
        }
        .lp-dash-inner {
          display:grid;
          grid-template-columns:210px 1fr 250px;
          grid-template-rows:52px 1fr;
          height:540px;
        }
        .lp-topbar {
          grid-column:1/-1;
          display:flex; align-items:center; gap:16px; padding:0 18px;
          border-bottom:1px solid var(--lp-border); background:var(--lp-bg1);
        }
        .lp-tab {
          padding:6px 14px; border-radius:6px; font-size:12px;
          color:var(--lp-muted); cursor:pointer;
        }
        .lp-tab-active { background:rgba(79,110,247,.15); color:var(--lp-accent); font-weight:700; }
        .lp-sidebar {
          border-right:1px solid var(--lp-border);
          background:var(--lp-bg1); overflow-y:auto;
          padding:14px 0;
        }
        .lp-sidebar-hd {
          padding:0 14px 7px;
          font-size:9px; letter-spacing:.12em; text-transform:uppercase;
          color:var(--lp-muted); font-weight:700;
        }
        .lp-sidebar-item {
          display:flex; align-items:center; justify-content:space-between;
          padding:7px 14px; font-size:12px; cursor:pointer; transition:background .15s;
        }
        .lp-sidebar-item:hover, .lp-sidebar-item-active { background:rgba(79,110,247,.08); }
        .lp-si-sym { font-family:'JetBrains Mono',monospace; font-weight:700; color:var(--lp-text); }
        .lp-si-active { color:var(--lp-accent); }
        .lp-si-pct { font-family:'JetBrains Mono',monospace; font-size:11px; }
        .lp-chart-area { flex:1; position:relative; overflow:hidden; }
        .lp-price-overlay { position:absolute; top:18px; left:22px; }
        .lp-price-big { font-family:'JetBrains Mono',monospace; font-size:30px; font-weight:600; color:var(--lp-text); }
        .lp-price-chg { font-size:13px; margin-top:4px; }
        .lp-main-area {
          display:flex; flex-direction:column;
          overflow:hidden; position:relative;
        }
        .lp-period-bar {
          display:flex; gap:3px; padding:9px 14px;
          border-top:1px solid var(--lp-border); background:var(--lp-bg1);
        }
        .lp-period {
          padding:3px 10px; border-radius:5px; font-size:11px; font-weight:700;
          cursor:pointer; color:var(--lp-muted); font-family:'JetBrains Mono',monospace;
        }
        .lp-period-active { background:rgba(79,110,247,.15); color:var(--lp-accent); }
        .lp-right-panel {
          border-left:1px solid var(--lp-border);
          background:var(--lp-bg1); overflow-y:auto;
          font-size:12px; display:flex; flex-direction:column;
        }
        .lp-rp-sec { padding:14px; border-bottom:1px solid var(--lp-border); }
        .lp-rp-hd { font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:var(--lp-muted); font-weight:700; margin-bottom:10px; }
        .lp-rp-row { display:flex; justify-content:space-between; padding:4px 0; color:var(--lp-muted); }
        .lp-rp-row span:last-child { font-family:'JetBrains Mono',monospace; color:var(--lp-text); }
        .lp-heatmap { display:grid; grid-template-columns:repeat(3,1fr); gap:3px; margin-top:7px; }
        .lp-hm-cell { border-radius:4px; padding:6px 4px; text-align:center; font-size:10px; font-weight:700; display:flex; flex-direction:column; gap:2px; }

        /* features */
        .lp-features { display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--lp-border); border:1px solid var(--lp-border); border-radius:16px; overflow:hidden; }
        .lp-feat { background:var(--lp-bg1); padding:44px 36px; position:relative; overflow:hidden; transition:background .3s; }
        .lp-feat:hover { background:var(--lp-bg2); }
        .lp-feat::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,var(--lp-accent),transparent); opacity:0; transition:.3s; }
        .lp-feat:hover::before { opacity:1; }
        .lp-feat-icon { width:42px; height:42px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:19px; margin-bottom:18px; }
        .lp-feat-title { font-size:16px; font-weight:700; margin-bottom:9px; }
        .lp-feat-body { font-size:13px; line-height:1.7; color:var(--lp-muted); }
        .lp-feat-tag { display:inline-block; margin-top:14px; font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--lp-accent); padding:3px 9px; border-radius:4px; background:rgba(79,110,247,.1); }

        /* compare section */
        .lp-compare-grid { display:grid; grid-template-columns:1fr 1fr; gap:48px; align-items:center; margin-top:56px; }
        .lp-compare-demo { border-radius:12px; border:1px solid var(--lp-border); background:var(--lp-bg1); overflow:hidden; }
        .lp-cc-bar { padding:11px 14px; border-bottom:1px solid var(--lp-border); display:flex; gap:7px; align-items:center; }
        .lp-chip { padding:3px 10px; border-radius:99px; font-size:11px; font-weight:700; }
        .lp-compare-stats { display:flex; flex-direction:column; gap:18px; }
        .lp-cstat { display:flex; align-items:center; gap:14px; padding:18px 22px; border-radius:10px; background:var(--lp-bg1); border:1px solid var(--lp-border); transition:.2s; }
        .lp-cstat:hover { border-color:rgba(79,110,247,.3); background:var(--lp-bg2); }
        .lp-cstat-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
        .lp-cstat-name { font-size:13px; font-weight:700; }
        .lp-cstat-sub { font-size:11px; color:var(--lp-muted); margin-top:2px; }
        .lp-cstat-pct { font-family:'JetBrains Mono',monospace; font-size:14px; font-weight:700; }

        /* AI section */
        .lp-ai-section { background:var(--lp-bg1); border-top:1px solid var(--lp-border); border-bottom:1px solid var(--lp-border); }
        .lp-ai-inner { display:grid; grid-template-columns:1fr 1fr; gap:80px; align-items:center; }
        .lp-ai-card { border-radius:14px; border:1px solid var(--lp-border); background:var(--lp-bg); overflow:hidden; }
        .lp-ai-card-hd { padding:13px 17px; border-bottom:1px solid var(--lp-border); font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--lp-muted); display:flex; align-items:center; gap:8px; }
        .lp-ai-dot { width:6px; height:6px; border-radius:50%; background:var(--lp-accent); animation:lpPulse 2s infinite; }
        .lp-ai-body { padding:17px; font-size:13px; line-height:1.8; color:var(--lp-muted); }
        .lp-ai-picks { display:flex; flex-direction:column; gap:7px; padding:0 17px 17px; }
        .lp-ai-pick { display:flex; align-items:center; gap:10px; padding:8px 11px; border-radius:8px; background:rgba(255,255,255,.03); border:1px solid var(--lp-border); }
        .lp-ap-rank { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--lp-muted); width:16px; }
        .lp-ap-sym { font-family:'JetBrains Mono',monospace; font-size:13px; font-weight:700; }
        .lp-ap-name { font-size:11px; color:var(--lp-muted); flex:1; }
        .lp-ap-score { font-family:'JetBrains Mono',monospace; font-size:11px; padding:2px 7px; border-radius:4px; background:rgba(0,229,160,.1); color:var(--lp-up); font-weight:700; }

        /* CTA */
        .lp-cta { text-align:center; padding:160px 48px; position:relative; overflow:hidden; }
        .lp-cta::before { content:''; position:absolute; inset:0; background:radial-gradient(ellipse 60% 70% at 50% 50%,rgba(79,110,247,.11) 0%,transparent 70%); }
        .lp-cta h2 { position:relative; z-index:1; font-size:clamp(40px,7vw,92px); font-weight:900; line-height:.95; letter-spacing:-.03em; }
        .lp-cta p { position:relative; z-index:1; font-size:17px; color:var(--lp-muted); margin:24px auto 48px; max-width:460px; line-height:1.7; }

        /* footer */
        .lp-footer { border-top:1px solid var(--lp-border); padding:36px 48px; display:flex; align-items:center; justify-content:space-between; font-size:12px; color:var(--lp-muted); }

        /* responsive */
        @media (max-width: 900px) {
          .lp-nav { padding: 16px 24px; }
          .lp-nav-links { display: none; }
          .lp-hero { padding: 120px 24px 60px; }
          .lp-section { padding: 80px 24px; }
          .lp-preview-wrap { padding: 0 24px 80px; }
          .lp-metrics { grid-template-columns: repeat(2,1fr); }
          .lp-metric { padding: 28px 24px; }
          .lp-features { grid-template-columns: 1fr; }
          .lp-compare-grid { grid-template-columns: 1fr; }
          .lp-ai-inner { grid-template-columns: 1fr; gap: 40px; }
          .lp-dash-inner { height: 400px; grid-template-columns: 0 1fr 0; }
          .lp-sidebar, .lp-right-panel { display: none; }
          .lp-topbar { grid-column: 1/-1; }
          .lp-cta { padding: 100px 24px; }
          .lp-footer { flex-direction: column; gap: 12px; text-align: center; }
        }
      `}</style>

      <div className="lp-root" data-theme="dark">

        {/* ── NAV ── */}
        <nav className="lp-nav">
          <Link href="/" className="lp-logo">
            <div className="lp-logo-mark">📊</div>
            StockPulse
          </Link>
          <div className="lp-nav-links">
            <a href="#features">功能</a>
            <a href="#compare">比較圖</a>
            <a href="#ai">AI 精選</a>
          </div>
          <Link href="/dashboard" className="lp-nav-cta">開始使用</Link>
        </nav>

        {/* ── HERO ── */}
        <section className="lp-hero">
          <div className="lp-badge">
            <div className="lp-badge-dot" />
            AI 驅動的台股分析平台
          </div>

          <h1 className="lp-h1">
            掌握市場<br />
            <span className="lp-h1-grad">的每一秒</span>
          </h1>

          <p className="lp-hero-sub">
            結合 Gemini AI、三大法人籌碼、技術指標，
            在資訊爆炸的市場中，找到真正值得關注的訊號。
          </p>

          <div className="lp-hero-btns">
            <Link href="/dashboard" className="lp-btn-primary">免費體驗 →</Link>
            <a href="#features" className="lp-btn-ghost">了解更多</a>
          </div>

          {/* Ticker */}
          <div className="lp-ticker-wrap">
            <div className="lp-ticker">
              {doubled.map((t, i) => (
                <div key={i} className="lp-tick">
                  <span className="lp-tick-sym">{t.sym}</span>
                  <span className="lp-tick-price">{t.price}</span>
                  <span className={`lp-tick-chg ${t.up ? "lp-chg-up" : "lp-chg-down"}`}>{t.pct}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── METRICS ── */}
        <Reveal>
          <div className="lp-metrics">
            {METRICS.map((m) => (
              <div key={m.label} className="lp-metric">
                <div className="lp-metric-label">{m.label}</div>
                <div className="lp-metric-val">{m.val}</div>
                <div className="lp-metric-sub">{m.sub}</div>
              </div>
            ))}
          </div>
        </Reveal>

        {/* ── DASHBOARD PREVIEW ── */}
        <Reveal>
          <div className="lp-preview-wrap">
            <div style={{ textAlign: "center", marginBottom: "40px" }}>
              <div className="lp-section-label" style={{ justifyContent: "center", display: "flex" }}>操作介面</div>
              <div className="lp-section-title" style={{ textAlign: "center", margin: "0 auto", maxWidth: "100%" }}>
                專業交易員等級的<br />資訊密度
              </div>
            </div>
            <div className="lp-preview-frame">
              <div className="lp-frame-bar">
                <div className="lp-dot" style={{ background: "#ff5f57" }} />
                <div className="lp-dot" style={{ background: "#febc2e" }} />
                <div className="lp-dot" style={{ background: "#28c840" }} />
                <div className="lp-frame-url">jaystock.onrender.com/dashboard</div>
              </div>
              <div className="lp-dash-inner">
                {/* topbar */}
                <div className="lp-topbar">
                  <div className="lp-tab lp-tab-active">個股</div>
                  <div className="lp-tab">比較</div>
                  <div className="lp-tab">總覽</div>
                  <div className="lp-tab">選股</div>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "var(--lp-muted)" }}>
                    TAIEX &nbsp;<span style={{ color: "var(--lp-up)" }}>23,412 ▲1.08%</span>
                  </span>
                </div>
                {/* sidebar */}
                <div className="lp-sidebar">
                  <div className="lp-sidebar-hd">自選股</div>
                  {[
                    { sym: "2330", pct: "+2.14%", up: true, active: true },
                    { sym: "2454", pct: "+1.38%", up: true,  active: false },
                    { sym: "2382", pct: "+3.21%", up: true,  active: false },
                    { sym: "2317", pct: "-0.77%", up: false, active: false },
                  ].map((s) => (
                    <div key={s.sym} className={`lp-sidebar-item ${s.active ? "lp-sidebar-item-active" : ""}`}>
                      <span className={`lp-si-sym ${s.active ? "lp-si-active" : ""}`}>{s.sym}</span>
                      <span className="lp-si-pct" style={{ color: s.up ? "var(--lp-up)" : "var(--lp-down)" }}>{s.pct}</span>
                    </div>
                  ))}
                  <div className="lp-sidebar-hd" style={{ marginTop: "16px" }}>AI 精選</div>
                  {[
                    { sym: "6669", pct: "+4.50%", up: true },
                    { sym: "3034", pct: "+2.89%", up: true },
                    { sym: "2379", pct: "+1.65%", up: true },
                  ].map((s) => (
                    <div key={s.sym} className="lp-sidebar-item">
                      <span className="lp-si-sym">{s.sym}</span>
                      <span className="lp-si-pct" style={{ color: "var(--lp-up)" }}>{s.pct}</span>
                    </div>
                  ))}
                </div>
                {/* main */}
                <div className="lp-main-area">
                  <div className="lp-chart-area">
                    <div className="lp-price-overlay">
                      <div className="lp-price-big">935.00</div>
                      <div className="lp-price-chg" style={{ color: "var(--lp-up)" }}>+19.50 (+2.14%)</div>
                    </div>
                    <svg viewBox="0 0 700 300" style={{ width: "100%", height: "100%" }} preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="lpAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00e5a0" stopOpacity=".22" />
                          <stop offset="100%" stopColor="#00e5a0" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d="M0,240 C40,235 70,220 120,190 C170,160 190,175 230,155 C270,135 300,100 350,90 C400,80 420,110 460,95 C500,80 540,60 580,50 C620,40 660,55 700,45 L700,300 L0,300 Z" fill="url(#lpAreaGrad)" />
                      <path d="M0,240 C40,235 70,220 120,190 C170,160 190,175 230,155 C270,135 300,100 350,90 C400,80 420,110 460,95 C500,80 540,60 580,50 C620,40 660,55 700,45" fill="none" stroke="#00e5a0" strokeWidth="1.5" />
                      <path d="M0,250 C50,245 100,230 160,210 C220,190 260,170 320,155 C380,140 420,130 470,115 C520,100 570,85 700,75" fill="none" stroke="rgba(79,110,247,.45)" strokeWidth="1" strokeDasharray="4,3" />
                      <line x1="460" y1="0" x2="460" y2="300" stroke="rgba(255,255,255,.07)" strokeDasharray="3,3" />
                      <circle cx="460" cy="95" r="4" fill="#00e5a0" stroke="var(--lp-bg1)" strokeWidth="2" />
                    </svg>
                  </div>
                  <div className="lp-period-bar">
                    {["1D","1W","1M","3M","1Y","3Y"].map((p, i) => (
                      <div key={p} className={`lp-period ${i === 2 ? "lp-period-active" : ""}`}>{p}</div>
                    ))}
                  </div>
                </div>
                {/* right */}
                <div className="lp-right-panel">
                  <div className="lp-rp-sec">
                    <div className="lp-rp-hd">台積電 2330</div>
                    {[["開盤","918.00"],["最高","936.00"],["最低","916.00"],["成交量","42,318 張"],["RSI(14)","57.3"],["外資","連買 5 日"]].map(([k,v]) => (
                      <div key={k} className="lp-rp-row"><span>{k}</span><span>{v}</span></div>
                    ))}
                  </div>
                  <div className="lp-rp-sec">
                    <div className="lp-rp-hd">類股熱力圖</div>
                    <div className="lp-heatmap">
                      {[["半導","+2.3%","rgba(0,229,160,.2)","var(--lp-up)"],["電子","+1.1%","rgba(0,229,160,.1)","var(--lp-up)"],["金融","-0.8%","rgba(255,59,92,.15)","var(--lp-down)"],["航運","+1.8%","rgba(0,229,160,.15)","var(--lp-up)"],["傳產","-0.4%","rgba(255,59,92,.1)","var(--lp-down)"],["生醫","+0.6%","rgba(0,229,160,.08)","var(--lp-up)"]].map(([name,pct,bg,c]) => (
                        <div key={name as string} className="lp-hm-cell" style={{ background: bg as string }}>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", color: c as string }}>{name}</span>
                          <span style={{ fontSize:"9px", color: c as string }}>{pct}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* ── FEATURES ── */}
        <section className="lp-section" id="features" style={{ paddingTop: 0 }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: "56px" }}>
              <div className="lp-section-label" style={{ justifyContent: "center", display: "flex" }}>核心功能</div>
              <div className="lp-section-title" style={{ textAlign: "center", margin: "0 auto", maxWidth: "100%" }}>
                為台股量身打造的<br />每一個功能
              </div>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="lp-features">
              {FEATURES.map((f) => (
                <div key={f.title} className="lp-feat">
                  <div className="lp-feat-icon" style={{ background: "rgba(79,110,247,.1)" }}>{f.icon}</div>
                  <div className="lp-feat-title">{f.title}</div>
                  <div className="lp-feat-body">{f.body}</div>
                  <div className="lp-feat-tag">{f.tag}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ── COMPARE ── */}
        <section className="lp-section" id="compare">
          <Reveal>
            <div className="lp-section-label">多股比較</div>
            <div className="lp-section-title">一眼看穿<br />相對強弱</div>
            <p className="lp-section-body">最多 4 檔個股同場競技，以同一基準點標準化，讓真正的強勢標的無所遁形。</p>
          </Reveal>
          <Reveal delay={100}>
            <div className="lp-compare-grid">
              <div className="lp-compare-demo">
                <div className="lp-cc-bar">
                  {[["2330","rgba(79,110,247,.2)","#6b8fff"],["2454","rgba(245,158,11,.15)","#f59e0b"],["2382","rgba(34,197,94,.15)","#22c55e"],["2317","rgba(244,63,94,.15)","#f43f5e"]].map(([sym,bg,c]) => (
                    <span key={sym as string} className="lp-chip" style={{ background: bg as string, color: c as string }}>{sym}</span>
                  ))}
                  <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--lp-muted)" }}>1M</span>
                </div>
                <div style={{ padding: "16px" }}>
                  <svg viewBox="0 0 480 200" style={{ width: "100%" }}>
                    <path d="M0,100 C30,98 60,85 100,70 C140,55 170,65 210,50 C250,35 290,30 340,20 C380,12 430,18 480,10" fill="none" stroke="#4f6ef7" strokeWidth="1.5" />
                    <path d="M0,100 C30,102 70,95 110,88 C150,81 180,85 220,78 C260,71 310,60 350,52 C400,43 440,48 480,40" fill="none" stroke="#f59e0b" strokeWidth="1.5" />
                    <path d="M0,100 C40,96 80,80 120,65 C160,50 190,55 230,42 C270,29 310,15 360,8 C410,1 450,6 480,2" fill="none" stroke="#22c55e" strokeWidth="1.5" />
                    <path d="M0,100 C30,103 60,110 100,115 C140,120 175,118 210,125 C250,132 300,138 350,148 C400,158 440,155 480,162" fill="none" stroke="#f43f5e" strokeWidth="1.5" />
                    <line x1="0" y1="100" x2="480" y2="100" stroke="rgba(255,255,255,.07)" strokeDasharray="4,3" />
                  </svg>
                </div>
              </div>
              <div className="lp-compare-stats">
                {COMPARE_STOCKS.map((s) => (
                  <div key={s.sym} className="lp-cstat">
                    <div className="lp-cstat-dot" style={{ background: s.color }} />
                    <div style={{ flex: 1 }}>
                      <div className="lp-cstat-name">{s.name} {s.sym}</div>
                      <div className="lp-cstat-sub">{s.sub}</div>
                    </div>
                    <div className="lp-cstat-pct" style={{ color: s.up ? "var(--lp-up)" : "var(--lp-down)" }}>{s.pct}</div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── AI SECTION ── */}
        <section className="lp-ai-section lp-section" id="ai">
          <Reveal>
            <div className="lp-ai-inner">
              <div>
                <div className="lp-section-label">AI 盤前精選</div>
                <div className="lp-section-title">每天 8 點<br />直接送達</div>
                <p className="lp-section-body">
                  Gemini Flash 綜合三大法人籌碼 × 技術面訊號，每個交易日盤前自動計算評分，
                  Top-5 精選推送到你信箱。不需要盯盤，不錯過每一個機會。
                </p>
                <div style={{ marginTop: "36px" }}>
                  <Link href="/dashboard" className="lp-btn-primary">立即訂閱 →</Link>
                </div>
              </div>
              <div className="lp-ai-card">
                <div className="lp-ai-card-hd">
                  <div className="lp-ai-dot" />
                  StockPulse AI · 今日精選 · 2026/06/08
                </div>
                <div className="lp-ai-body">
                  <strong style={{ color: "var(--lp-text)" }}>系統已篩選 834 檔個股</strong>，
                  以外資籌碼、技術突破、量比擴大三維加權評分，為您精選今日最具潛力 5 檔標的：
                </div>
                <div className="lp-ai-picks">
                  {AI_PICKS.map((p) => (
                    <div key={p.sym} className="lp-ai-pick">
                      <span className="lp-ap-rank">{p.rank}</span>
                      <span className="lp-ap-sym">{p.sym}</span>
                      <span className="lp-ap-name">{p.name}</span>
                      <span className="lp-ap-score">{p.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── CTA ── */}
        <Reveal>
          <section className="lp-cta">
            <h2>
              開始掌握<br />
              <span className="lp-h1-grad">台股脈動</span>
            </h2>
            <p>免費使用，無需信用卡。<br />從今天起，讓 AI 幫你找到下一個機會。</p>
            <Link href="/dashboard" className="lp-btn-primary" style={{ fontSize: "16px", padding: "16px 40px", position: "relative", zIndex: 1, display: "inline-block" }}>
              立即體驗 StockPulse →
            </Link>
          </section>
        </Reveal>

        {/* ── FOOTER ── */}
        <footer className="lp-footer">
          <Link href="/" className="lp-logo" style={{ fontSize: "13px" }}>
            <div className="lp-logo-mark">📊</div>StockPulse
          </Link>
          <p>© 2026 StockPulse · 資料僅供參考，不構成投資建議</p>
          <p>Built with Next.js 14 · FastAPI · Gemini AI</p>
        </footer>

      </div>
    </>
  );
}
