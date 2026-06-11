"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DSLStrategy {
  type: "dsl";
  entry_dsl: string;
  exit_dsl:  string;
}

interface ValidationResult {
  ok: boolean;
  error: string | null;
}

interface DSLEditorProps {
  value: DSLStrategy;
  onChange: (v: DSLStrategy) => void;
}

// ── Reference data ────────────────────────────────────────────────────────────

const FIELDS = [
  { label: "價量",     items: ["close", "open", "high", "low", "volume"] },
  { label: "均線",     items: ["ma5", "ma10", "ma20", "ma60", "ema12", "ema26"] },
  { label: "動能",     items: ["rsi14", "k", "d", "macd", "macd_s"] },
  { label: "通道",     items: ["bb_upper", "bb_middle", "bb_lower"] },
  { label: "跨日量價", items: ["vol_ratio", "consec_up", "consec_down", "body_pct", "upper_wick_pct", "lower_wick_pct", "is_52w_high", "consec_52w_hi"] },
  { label: "K棒形態",  items: ["hammer", "shooting_star", "doji", "bull_engulf", "bear_engulf"] },
];

const FUNCTIONS = [
  { sig: "ma(N)",               desc: "N 日移動平均" },
  { sig: "ema(N)",              desc: "N 日指數移動平均" },
  { sig: "rsi(N)",              desc: "N 日 RSI" },
  { sig: "shift(field, N)",     desc: "前 N 日的欄位值" },
  { sig: "highest(field, N)",   desc: "N 日最高值" },
  { sig: "lowest(field, N)",    desc: "N 日最低值" },
  { sig: "cross_above(a, b)",   desc: "a 向上穿越 b（金叉）" },
  { sig: "cross_below(a, b)",   desc: "a 向下穿越 b（死叉）" },
];

const TEMPLATES: { label: string; entry: string; exit: string }[] = [
  {
    label: "MA 黃金交叉",
    entry: "cross_above(ma(5), ma(20))",
    exit:  "cross_below(ma(5), ma(20))",
  },
  {
    label: "RSI 超賣反彈",
    entry: "rsi(14) < 30 AND close > ma(20)",
    exit:  "rsi(14) > 70",
  },
  {
    label: "布林突破",
    entry: "close > bb_upper AND vol_ratio > 1.5",
    exit:  "close < bb_middle",
  },
  {
    label: "錘頭 + 連跌後反彈",
    entry: "hammer == 1 AND consec_down >= 3",
    exit:  "close > ma(20)",
  },
  {
    label: "多頭吞噬 + 量增",
    entry: "bull_engulf == 1 AND vol_ratio > 1.2",
    exit:  "bear_engulf == 1",
  },
  {
    label: "52週新高突破",
    entry: "is_52w_high == 1 AND consec_52w_hi == 1 AND vol_ratio > 1.5",
    exit:  "close < shift(close, 5)",
  },
];

// ── Syntax highlight (lightweight token coloring) ─────────────────────────────

const KW_RE   = /\b(AND|OR|NOT)\b/gi;
const FUNC_RE = /\b(ma|ema|rsi|shift|highest|lowest|cross_above|cross_below)\s*\(/gi;
const NUM_RE  = /-?\d+(?:\.\d+)?/g;
const OP_RE   = />=|<=|==|!=|>|<|=/g;

function highlight(text: string): React.ReactNode {
  // Simple linear tokenizer producing spans
  const parts: React.ReactNode[] = [];
  let i = 0;
  const len = text.length;

  const patterns: [RegExp, string][] = [
    [new RegExp(KW_RE.source, "gi"),   "text-violet-400 font-semibold"],
    [new RegExp(FUNC_RE.source, "gi"), "text-yellow-400"],
    [new RegExp(NUM_RE.source, "g"),   "text-green-400"],
    [new RegExp(OP_RE.source, "g"),    "text-orange-400"],
  ];

  // Build an ordered list of (start, end, class) from all patterns
  const ranges: { s: number; e: number; cls: string }[] = [];
  for (const [re, cls] of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      ranges.push({ s: m.index, e: m.index + m[0].length, cls });
    }
  }
  ranges.sort((a, b) => a.s - b.s || b.e - a.e);

  // Emit non-overlapping spans
  for (const r of ranges) {
    if (r.s < i) continue;
    // Plain text before this range
    if (r.s > i) parts.push(text.slice(i, r.s));
    parts.push(<span key={r.s} className={r.cls}>{text.slice(r.s, r.e)}</span>);
    i = r.e;
  }
  if (i < len) parts.push(text.slice(i));
  return <>{parts}</>;
}

// ── Debounce hook ─────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Single textarea with highlight overlay ────────────────────────────────────

function SyntaxTextarea({
  value,
  onChange,
  placeholder,
  label,
  validation,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  validation: ValidationResult | null;
  rows?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const borderCls = !value
    ? "border-border"
    : validation === null
    ? "border-muted"
    : validation.ok
    ? "border-green-500"
    : "border-red-500";

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        {/* Highlight layer (behind textarea) */}
        <pre
          aria-hidden
          className={`absolute inset-0 m-0 overflow-hidden rounded-md border ${borderCls} bg-muted/30 p-2 font-mono text-sm leading-relaxed pointer-events-none whitespace-pre-wrap break-all`}
        >
          <code>{value ? highlight(value) : <span className="text-muted-foreground">{placeholder}</span>}</code>
          {/* Extra line so the pre and textarea heights match */}
          {"\n"}
        </pre>

        {/* Actual textarea (transparent background) */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          spellCheck={false}
          className={`relative w-full rounded-md border ${borderCls} bg-transparent p-2 font-mono text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 text-transparent caret-foreground placeholder:text-muted-foreground/60`}
        />
      </div>
      {validation && !validation.ok && value && (
        <p className="text-xs text-red-500 flex items-start gap-1">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>{validation.error}</span>
        </p>
      )}
      {validation?.ok && value && (
        <p className="text-xs text-green-600">✓ 語法正確</p>
      )}
    </div>
  );
}

// ── Reference panel ───────────────────────────────────────────────────────────

function ReferencePanel({ onInsert }: { onInsert: (text: string, target: "entry" | "exit") => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-md text-xs">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left font-medium hover:bg-muted/50"
      >
        <span>📖 欄位 / 函數參考</span>
        <span className="text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-border p-3 space-y-3">
          {/* Fields */}
          <div className="space-y-1.5">
            <p className="font-semibold text-muted-foreground">可用欄位</p>
            {FIELDS.map(g => (
              <div key={g.label} className="flex flex-wrap gap-1 items-center">
                <span className="text-muted-foreground/70 w-16 shrink-0">{g.label}</span>
                {g.items.map(f => (
                  <button
                    key={f}
                    type="button"
                    title="點擊插入到進場條件"
                    onClick={() => onInsert(f, "entry")}
                    className="px-1.5 py-0.5 rounded bg-muted font-mono hover:bg-primary/20 hover:text-primary transition-colors"
                  >
                    {f}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Functions */}
          <div className="space-y-1">
            <p className="font-semibold text-muted-foreground">可用函數</p>
            <div className="grid grid-cols-1 gap-1">
              {FUNCTIONS.map(f => (
                <div key={f.sig} className="flex items-baseline gap-2">
                  <code className="text-yellow-600 dark:text-yellow-400 w-44 shrink-0">{f.sig}</code>
                  <span className="text-muted-foreground">{f.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Operators */}
          <div>
            <p className="font-semibold text-muted-foreground mb-1">運算子</p>
            <div className="flex flex-wrap gap-2 font-mono text-orange-600 dark:text-orange-400">
              {[">", "<", ">=", "<=", "==", "!="].map(op => (
                <code key={op}>{op}</code>
              ))}
              <code className="text-violet-500">AND</code>
              <code className="text-violet-500">OR</code>
              <code className="text-violet-500">NOT</code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main DSLEditor component ──────────────────────────────────────────────────

export default function DSLEditor({ value, onChange }: DSLEditorProps) {
  const [entryVal, setEntryVal] = useState<ValidationResult | null>(null);
  const [exitVal,  setExitVal]  = useState<ValidationResult | null>(null);
  const [_validating, setValidating] = useState(false);

  const debouncedEntry = useDebounce(value.entry_dsl, 500);
  const debouncedExit  = useDebounce(value.exit_dsl,  500);

  // Validate entry DSL
  useEffect(() => {
    if (!debouncedEntry.trim()) { setEntryVal(null); return; }
    setValidating(true);
    fetch("/api/backtest/dsl/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dsl: debouncedEntry }),
    })
      .then(r => r.json())
      .then(setEntryVal)
      .catch(() => setEntryVal({ ok: false, error: "無法連線到伺服器" }))
      .finally(() => setValidating(false));
  }, [debouncedEntry]);

  // Validate exit DSL
  useEffect(() => {
    if (!debouncedExit.trim()) { setExitVal(null); return; }
    fetch("/api/backtest/dsl/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dsl: debouncedExit }),
    })
      .then(r => r.json())
      .then(setExitVal)
      .catch(() => setExitVal({ ok: false, error: "無法連線到伺服器" }));
  }, [debouncedExit]);

  const setEntry = useCallback((v: string) => onChange({ ...value, entry_dsl: v }), [value, onChange]);
  const setExit  = useCallback((v: string) => onChange({ ...value, exit_dsl:  v }), [value, onChange]);

  const applyTemplate = useCallback((tpl: (typeof TEMPLATES)[number]) => {
    onChange({ ...value, entry_dsl: tpl.entry, exit_dsl: tpl.exit });
  }, [value, onChange]);

  const handleInsert = useCallback((text: string, target: "entry" | "exit") => {
    if (target === "entry") setEntry((value.entry_dsl ? value.entry_dsl + " " : "") + text);
    else                    setExit( (value.exit_dsl  ? value.exit_dsl  + " " : "") + text);
  }, [value, setEntry, setExit]);

  return (
    <div className="space-y-4 p-1">
      {/* Template selector */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          範例策略模板
        </p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map(tpl => (
            <button
              key={tpl.label}
              type="button"
              onClick={() => applyTemplate(tpl)}
              className="px-2.5 py-1 rounded-full border border-border text-xs hover:border-primary hover:text-primary transition-colors"
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entry DSL */}
      <SyntaxTextarea
        label="進場條件（Entry）"
        value={value.entry_dsl}
        onChange={setEntry}
        placeholder="例：close > ma(20) AND rsi(14) < 35"
        validation={entryVal}
        rows={3}
      />

      {/* Exit DSL */}
      <SyntaxTextarea
        label="出場條件（Exit）— 留空則純靠停損/停利出場"
        value={value.exit_dsl}
        onChange={setExit}
        placeholder="例：close < ma(20) OR rsi(14) > 70"
        validation={exitVal}
        rows={3}
      />

      {/* Reference panel */}
      <ReferencePanel onInsert={handleInsert} />

      {/* Syntax hint */}
      <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2.5 space-y-1 font-mono">
        <p className="font-sans font-semibold not-italic text-foreground/80 mb-1.5">語法提示</p>
        <p><span className="text-violet-400">AND</span> / <span className="text-violet-400">OR</span> / <span className="text-violet-400">NOT</span> — 條件邏輯</p>
        <p><span className="text-yellow-400">cross_above</span>(close, ma(20)) — 向上突破，獨立成行不需 == 1</p>
        <p><span className="text-yellow-400">shift</span>(close, 1) — 前一日收盤，可比較前後日</p>
        <p>( ) — 括號改變優先順序</p>
        <p className="pt-1 text-muted-foreground/70 font-sans not-italic">
          DSL 不支援加減乘除運算，如需「漲幅 &gt; 5%」請用 body_pct &gt; 5
        </p>
      </div>
    </div>
  );
}
