"use client";

/**
 * 個人化首頁儀錶板
 *
 * Block ① 自選股報價列表    — 現價、漲跌幅、量比、連買 badge
 * Block ② 今日警示摘要      — 8 種預設信號 + 用戶自訂規則
 * Block ③ 重要日期提醒      — 7 日內除息 / 財報
 * 自訂警示規則編輯器         — CRUD（A+B 複雜度）
 */

import { useState, useEffect, useCallback } from "react";
import {
  getDashboardSummary,
  alertRulesApi,
  watchlistApi,
  getUserId,
  ALERT_RULE_FIELDS,
  type DashboardSummaryResponse,
  type DashboardSymbolData,
  type DashboardSignal,
  type AlertRule,
  type AlertRuleCondition,
  type AlertRuleOperator,
  type AlertRuleLogic,
  type CreateAlertRulePayload,
  type WatchlistState,
} from "@/lib/api";

// ─── localStorage helpers (same as LeftPanel) ───────────────────────────────
const LS_KEY = "stockpulse_watchlist_v2";
function lsLoadWatchlist(): WatchlistState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as WatchlistState) : null;
  } catch {
    return null;
  }
}

function getAllSymbols(state: WatchlistState): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  Object.values(state.items).forEach((items) => {
    items.forEach((it) => {
      if (!seen.has(it.symbol)) {
        seen.add(it.symbol);
        result.push(it.symbol);
      }
    });
  });
  return result;
}

// ─── Design tokens ──────────────────────────────────────────────────────────
const SIGNAL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  positive: {
    bg:     "rgba(34,197,94,0.08)",
    text:   "var(--color-up)",
    border: "rgba(34,197,94,0.3)",
  },
  warning: {
    bg:     "rgba(239,68,68,0.08)",
    text:   "var(--color-down)",
    border: "rgba(239,68,68,0.3)",
  },
  info: {
    bg:     "rgba(59,130,246,0.08)",
    text:   "#60a5fa",
    border: "rgba(59,130,246,0.3)",
  },
  custom: {
    bg:     "rgba(139,92,246,0.08)",
    text:   "#a78bfa",
    border: "rgba(139,92,246,0.3)",
  },
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function SignalBadge({ signal }: { signal: DashboardSignal }) {
  const c = SIGNAL_COLORS[signal.severity] ?? SIGNAL_COLORS.info;
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {signal.label}
    </span>
  );
}

function ChangePct({ pct }: { pct: number }) {
  const color =
    pct > 0 ? "var(--color-up)" : pct < 0 ? "var(--color-down)" : "var(--text-tertiary)";
  return (
    <span className="num text-xs font-semibold" style={{ color }}>
      {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

function VolRatioBadge({ ratio }: { ratio: number }) {
  if (ratio < 1.5) return null;
  const hot = ratio >= 2;
  return (
    <span
      className="text-[10px] px-1 py-0.5 rounded font-semibold"
      style={{
        background: hot ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
        color:      hot ? "var(--color-down)" : "#f59e0b",
        border:     `1px solid ${hot ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)"}`,
      }}
    >
      量{ratio.toFixed(1)}x
    </span>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h2>
      {count !== undefined && (
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Block ① 自選股報價列表 ──────────────────────────────────────────────────

function WatchlistBlock({
  symbols,
  data,
  onSelectStock,
}: {
  symbols: string[];
  data: Record<string, DashboardSymbolData>;
  onSelectStock: (symbol: string) => void;
}) {
  if (symbols.length === 0) {
    return (
      <div
        className="rounded-xl p-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <SectionHeader title="📋 自選股" />
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
          請先在左側自選股欄位新增股票
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <div className="px-4 pt-4 pb-2">
        <SectionHeader title="📋 自選股" count={symbols.length} />
      </div>

      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        {symbols.map((sym) => {
          const d = data[sym];
          if (!d?.quote?.price) {
            return (
              <div key={sym} className="px-4 py-2.5 flex items-center gap-3">
                <span className="num text-sm font-medium" style={{ color: "var(--text-secondary)" }}>{sym}</span>
                <div className="flex-1 h-3 rounded animate-pulse" style={{ background: "var(--bg-elevated)" }} />
              </div>
            );
          }
          const q = d.quote;
          return (
            <button
              key={sym}
              onClick={() => onSelectStock(sym)}
              className="w-full px-4 py-2.5 flex items-center gap-2 text-left transition-colors hover:bg-[var(--bg-elevated)]"
            >
              {/* 代號 + 名稱 */}
              <div className="w-20 shrink-0">
                <div className="num text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{sym}</div>
                <div className="text-[10px] truncate" style={{ color: "var(--text-tertiary)" }}>
                  {q.name !== sym ? q.name : ""}
                </div>
              </div>

              {/* 價格 */}
              <div className="flex-1 min-w-0">
                <span className="num text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {q.price.toFixed(2)}
                </span>
              </div>

              {/* 漲跌 + 量比 */}
              <div className="flex items-center gap-1.5 shrink-0">
                <ChangePct pct={q.change_pct} />
                <VolRatioBadge ratio={q.vol_ratio} />
              </div>

              {/* 信號 badges（最多 2 個）*/}
              {d.signals.length > 0 && (
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  {d.signals.slice(0, 2).map((s) => (
                    <SignalBadge key={s.id} signal={s} />
                  ))}
                  {d.signals.length > 2 && (
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                      +{d.signals.length - 2}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Block ② 今日警示摘要 ────────────────────────────────────────────────────

function AlertsBlock({
  symbols,
  data,
  onSelectStock,
}: {
  symbols: string[];
  data: Record<string, DashboardSymbolData>;
  onSelectStock: (symbol: string) => void;
}) {
  // 收集所有有警示的股票
  const alertItems = symbols
    .filter((s) => (data[s]?.signals?.length ?? 0) > 0)
    .map((s) => ({ symbol: s, data: data[s] }));

  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <div className="px-4 pt-4 pb-2">
        <SectionHeader title="🔔 今日警示" count={alertItems.length} />
      </div>

      {alertItems.length === 0 ? (
        <div className="px-4 pb-4">
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            目前無警示訊號
          </p>
        </div>
      ) : (
        <div className="divide-y pb-1" style={{ borderColor: "var(--border)" }}>
          {alertItems.map(({ symbol, data: d }) => (
            <button
              key={symbol}
              onClick={() => onSelectStock(symbol)}
              className="w-full px-4 py-2.5 flex items-start gap-3 text-left hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <div className="shrink-0 w-14">
                <span className="num text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {symbol}
                </span>
              </div>
              <div className="flex-1 flex flex-wrap gap-1">
                {d.signals.map((s) => (
                  <SignalBadge key={s.id} signal={s} />
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Block ③ 重要日期提醒 ────────────────────────────────────────────────────

function UpcomingDatesBlock({
  symbols,
  data,
}: {
  symbols: string[];
  data: Record<string, DashboardSymbolData>;
}) {
  type DateEntry = {
    symbol:  string;
    type:    "exdiv" | "earnings";
    label:   string;
    date:    string;
    days_until: number;
    value?:  number;
  };

  const entries: DateEntry[] = [];
  symbols.forEach((sym) => {
    (data[sym]?.upcoming_dates ?? []).forEach((ev) => {
      entries.push({ symbol: sym, ...ev });
    });
  });
  entries.sort((a, b) => a.days_until - b.days_until);

  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <div className="px-4 pt-4 pb-2">
        <SectionHeader title="📅 重要日期（7日內）" count={entries.length} />
      </div>

      {entries.length === 0 ? (
        <div className="px-4 pb-4">
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            7 日內無除息或財報公布
          </p>
        </div>
      ) : (
        <div className="divide-y pb-1" style={{ borderColor: "var(--border)" }}>
          {entries.map((ev, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center gap-3">
              {/* 日期 chip */}
              <div
                className="shrink-0 text-center w-10 rounded py-0.5"
                style={{
                  background: ev.days_until === 0 ? "rgba(239,68,68,0.15)" : "var(--bg-elevated)",
                  color:      ev.days_until === 0 ? "var(--color-down)" : "var(--text-secondary)",
                }}
              >
                <div className="text-[10px] font-medium">
                  {ev.days_until === 0 ? "今天" : `${ev.days_until}天後`}
                </div>
              </div>

              {/* 代號 + 事件 */}
              <div className="flex-1 min-w-0">
                <span className="num text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {ev.symbol}
                </span>
                <span className="mx-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
                  {ev.type === "exdiv" ? "💰 除息" : "📊 財報"}
                </span>
                {ev.value != null && (
                  <span className="num text-xs" style={{ color: "var(--color-up)" }}>
                    ${ev.value}
                  </span>
                )}
              </div>

              {/* 日期 */}
              <div className="num text-xs shrink-0" style={{ color: "var(--text-tertiary)" }}>
                {ev.date}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 自訂警示規則編輯器 ──────────────────────────────────────────────────────

const OPERATORS: { value: AlertRuleOperator; label: string }[] = [
  { value: ">",  label: ">" },
  { value: "<",  label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "=",  label: "=" },
];

function ConditionRow({
  cond,
  index,
  onChange,
  onRemove,
  showRemove,
}: {
  cond:      AlertRuleCondition;
  index:     number;
  onChange:  (i: number, c: AlertRuleCondition) => void;
  onRemove:  (i: number) => void;
  showRemove: boolean;
}) {
  const fieldMeta = ALERT_RULE_FIELDS.find((f) => f.value === cond.field);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Field */}
      <select
        className="text-xs px-2 py-1 rounded border"
        style={{
          background:   "var(--bg-elevated)",
          color:        "var(--text-primary)",
          borderColor:  "var(--border)",
          minWidth:     "110px",
        }}
        value={cond.field}
        onChange={(e) => onChange(index, { ...cond, field: e.target.value })}
      >
        {ALERT_RULE_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {/* Operator */}
      <select
        className="text-xs px-2 py-1 rounded border w-14"
        style={{
          background:  "var(--bg-elevated)",
          color:       "var(--text-primary)",
          borderColor: "var(--border)",
        }}
        value={cond.operator}
        onChange={(e) => onChange(index, { ...cond, operator: e.target.value as AlertRuleOperator })}
      >
        {OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* Value */}
      <input
        type="number"
        step="any"
        className="text-xs px-2 py-1 rounded border w-20"
        style={{
          background:  "var(--bg-elevated)",
          color:       "var(--text-primary)",
          borderColor: "var(--border)",
        }}
        value={cond.value}
        onChange={(e) => onChange(index, { ...cond, value: parseFloat(e.target.value) || 0 })}
      />
      {fieldMeta?.unit && (
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{fieldMeta.unit}</span>
      )}

      {/* Remove */}
      {showRemove && (
        <button
          onClick={() => onRemove(index)}
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ color: "var(--color-down)", background: "rgba(239,68,68,0.08)" }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function AlertRuleForm({
  onSave,
  onCancel,
  initial,
}: {
  onSave:   (payload: CreateAlertRulePayload) => void;
  onCancel: () => void;
  initial?: AlertRule;
}) {
  const [name, setName]       = useState(initial?.name ?? "");
  const [logic, setLogic]     = useState<AlertRuleLogic>(initial?.logic ?? "AND");
  const [conditions, setConds] = useState<AlertRuleCondition[]>(
    initial?.conditions ?? [{ field: "rsi14", operator: "<", value: 30 }]
  );

  const updateCond = (i: number, c: AlertRuleCondition) => {
    setConds((prev) => prev.map((x, idx) => (idx === i ? c : x)));
  };
  const removeCond = (i: number) => setConds((prev) => prev.filter((_, idx) => idx !== i));
  const addCond = () => {
    if (conditions.length < 3) {
      setConds((prev) => [...prev, { field: "vol_ratio", operator: ">", value: 2 }]);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), conditions, logic, is_active: true });
  };

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
    >
      {/* 規則名稱 */}
      <div>
        <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>
          規則名稱
        </label>
        <input
          type="text"
          placeholder="例：RSI超賣＋外資買"
          maxLength={50}
          className="w-full text-sm px-2.5 py-1.5 rounded border"
          style={{
            background:  "var(--bg-surface)",
            color:       "var(--text-primary)",
            borderColor: "var(--border)",
          }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* 條件 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>條件</label>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>邏輯：</span>
            {(["AND", "OR"] as AlertRuleLogic[]).map((l) => (
              <button
                key={l}
                onClick={() => setLogic(l)}
                className="text-xs px-2 py-0.5 rounded font-medium transition-colors"
                style={{
                  background:  logic === l ? "var(--color-brand)" : "var(--bg-surface)",
                  color:       logic === l ? "#fff" : "var(--text-secondary)",
                  border:      `1px solid ${logic === l ? "var(--color-brand)" : "var(--border)"}`,
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {conditions.map((c, i) => (
            <ConditionRow
              key={i}
              cond={c}
              index={i}
              onChange={updateCond}
              onRemove={removeCond}
              showRemove={conditions.length > 1}
            />
          ))}
        </div>

        {conditions.length < 3 && (
          <button
            onClick={addCond}
            className="mt-2 text-xs px-2 py-1 rounded"
            style={{ color: "var(--color-brand)", background: "rgba(59,130,246,0.08)" }}
          >
            ＋ 新增條件
          </button>
        )}
      </div>

      {/* 按鈕 */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded border"
          style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className="text-xs px-3 py-1.5 rounded font-medium disabled:opacity-40"
          style={{ background: "var(--color-brand)", color: "#fff" }}
        >
          {initial ? "儲存修改" : "新增規則"}
        </button>
      </div>
    </div>
  );
}

function AlertRulesBlock({
  rules,
  onAdd,
  onToggle,
  onDelete,
  onEdit,
}: {
  rules:    AlertRule[];
  onAdd:    (p: CreateAlertRulePayload) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit:   (id: string, p: CreateAlertRulePayload) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<AlertRule | null>(null);

  const handleEdit = (rule: AlertRule) => {
    setEditTarget(rule);
    setShowForm(true);
  };

  const handleSave = (payload: CreateAlertRulePayload) => {
    if (editTarget) {
      onEdit(editTarget.id, payload);
    } else {
      onAdd(payload);
    }
    setShowForm(false);
    setEditTarget(null);
  };

  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      {/* Header — 可折疊 */}
      <button
        className="w-full px-4 py-3 flex items-center justify-between"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            ⚡ 自訂警示規則
          </span>
          {rules.length > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
            >
              {rules.filter((r) => r.is_active).length}/{rules.length} 啟用
            </span>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          style={{
            color:     "var(--text-tertiary)",
            transform: expanded ? "rotate(180deg)" : "",
            transition: "transform 0.2s",
          }}
        >
          <path d="M2 5l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {/* 規則列表 */}
          {rules.length === 0 && !showForm && (
            <p className="text-sm py-1" style={{ color: "var(--text-tertiary)" }}>
              尚未設定自訂規則
            </p>
          )}

          {rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-lg px-3 py-2 flex items-start gap-2"
              style={{
                background:  "var(--bg-elevated)",
                border:      `1px solid ${rule.is_active ? "var(--border)" : "transparent"}`,
                opacity:     rule.is_active ? 1 : 0.5,
              }}
            >
              {/* Toggle */}
              <button
                onClick={() => onToggle(rule.id)}
                className="mt-0.5 shrink-0 w-8 h-4 rounded-full transition-colors"
                style={{
                  background: rule.is_active ? "var(--color-brand)" : "var(--bg-surface)",
                  border:     "1px solid var(--border)",
                  position:   "relative",
                }}
                title={rule.is_active ? "點擊停用" : "點擊啟用"}
              >
                <span
                  className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                  style={{ left: rule.is_active ? "calc(100% - 14px)" : "2px" }}
                />
              </button>

              {/* Rule info */}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                  {rule.name}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {rule.conditions
                    .map((c) => {
                      const f = ALERT_RULE_FIELDS.find((x) => x.value === c.field);
                      return `${f?.label ?? c.field} ${c.operator} ${c.value}${f?.unit ?? ""}`;
                    })
                    .join(` ${rule.logic} `)}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleEdit(rule)}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: "var(--text-secondary)", background: "rgba(255,255,255,0.05)" }}
                >
                  編輯
                </button>
                <button
                  onClick={() => onDelete(rule.id)}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: "var(--color-down)", background: "rgba(239,68,68,0.08)" }}
                >
                  刪除
                </button>
              </div>
            </div>
          ))}

          {/* 新增表單 */}
          {showForm && (
            <AlertRuleForm
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditTarget(null); }}
              initial={editTarget ?? undefined}
            />
          )}

          {/* 新增按鈕（未開表單時顯示）*/}
          {!showForm && rules.length < 20 && (
            <button
              onClick={() => { setShowForm(true); setEditTarget(null); }}
              className="w-full py-2 text-xs rounded-lg border border-dashed transition-colors"
              style={{
                color:       "var(--color-brand)",
                borderColor: "rgba(59,130,246,0.4)",
                background:  "rgba(59,130,246,0.04)",
              }}
            >
              ＋ 新增警示規則
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 主元件 ──────────────────────────────────────────────────────────────────

interface HomeDashboardProps {
  onSelectStock: (symbol: string) => void;
}

export default function HomeDashboard({ onSelectStock }: HomeDashboardProps) {
  const [summary, setSummary]     = useState<DashboardSummaryResponse | null>(null);
  const [symbols, setSymbols]     = useState<string[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [rules, setRules]         = useState<AlertRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);

  const userId = typeof window !== "undefined" ? getUserId() : "";

  // ── 載入自訂規則 ───────────────────────────────────────────────────────────
  const loadRules = useCallback(async () => {
    if (!userId) return;
    setRulesLoading(true);
    try {
      const resp = await alertRulesApi.list();
      setRules(resp.rules);
    } catch {
      // silent fail — rules not critical
    } finally {
      setRulesLoading(false);
    }
  }, [userId]);

  // ── 載入 dashboard summary ─────────────────────────────────────────────────
  const loadDashboard = useCallback(async (syms: string[]) => {
    if (syms.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await getDashboardSummary(syms, userId);
      setSummary(resp);
    } catch (e) {
      setError("無法載入儀錶板資料，請稍後再試");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // ── 初始化：讀取 watchlist 並載入 ──────────────────────────────────────────
  useEffect(() => {
    // 嘗試從 localStorage 讀取（快）
    const cached = lsLoadWatchlist();
    if (cached) {
      const syms = getAllSymbols(cached);
      setSymbols(syms);
      loadDashboard(syms);
    } else {
      // fallback：從 API 讀取
      watchlistApi.get().then((state) => {
        const syms = getAllSymbols(state);
        setSymbols(syms);
        loadDashboard(syms);
      }).catch(() => {
        setLoading(false);
        setError("無法讀取自選股清單");
      });
    }

    loadRules();
  }, [loadDashboard, loadRules, userId]);

  // ── 自訂規則 CRUD handlers ─────────────────────────────────────────────────
  const handleAddRule = async (payload: CreateAlertRulePayload) => {
    try {
      const newRule = await alertRulesApi.create(payload);
      setRules((prev) => [...prev, newRule]);
      // 重新載入 dashboard 以應用新規則
      if (symbols.length > 0) loadDashboard(symbols);
    } catch (e) {
      console.error("Failed to create rule", e);
    }
  };

  const handleToggleRule = async (id: string) => {
    try {
      const updated = await alertRulesApi.toggle(id);
      setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
      if (symbols.length > 0) loadDashboard(symbols);
    } catch (e) {
      console.error("Failed to toggle rule", e);
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await alertRulesApi.delete(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      console.error("Failed to delete rule", e);
    }
  };

  const handleEditRule = async (id: string, payload: CreateAlertRulePayload) => {
    try {
      const updated = await alertRulesApi.update(id, payload);
      setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
      if (symbols.length > 0) loadDashboard(symbols);
    } catch (e) {
      console.error("Failed to update rule", e);
    }
  };

  // ── 手動刷新 ───────────────────────────────────────────────────────────────
  const handleRefresh = () => {
    if (symbols.length > 0) loadDashboard(symbols);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex-1 overflow-y-auto p-3 sm:p-4"
      style={{ background: "var(--bg-elevated)" }}
    >
      <div className="max-w-3xl mx-auto space-y-3">

        {/* 頂列：標題 + 刷新 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              我的首頁
            </h1>
            {summary && (
              <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {new Date(summary.updated_at * 1000).toLocaleTimeString("zh-TW", {
                  hour:   "2-digit",
                  minute: "2-digit",
                })} 更新
              </p>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            {loading ? "載入中…" : "🔄 刷新"}
          </button>
        </div>

        {/* 錯誤提示 */}
        {error && (
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-down)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            {error}
          </div>
        )}

        {/* Skeleton 載入中 */}
        {loading && !summary && (
          <div className="space-y-3">
            {[80, 60, 50].map((h, i) => (
              <div
                key={i}
                className="rounded-xl animate-pulse"
                style={{ height: `${h}px`, background: "var(--bg-surface)" }}
              />
            ))}
          </div>
        )}

        {/* Block ① 自選股報價列表 */}
        {(!loading || summary) && (
          <WatchlistBlock
            symbols={symbols}
            data={summary?.data ?? {}}
            onSelectStock={onSelectStock}
          />
        )}

        {/* Block ② 今日警示 */}
        {(!loading || summary) && (
          <AlertsBlock
            symbols={symbols}
            data={summary?.data ?? {}}
            onSelectStock={onSelectStock}
          />
        )}

        {/* Block ③ 重要日期 */}
        {(!loading || summary) && (
          <UpcomingDatesBlock
            symbols={symbols}
            data={summary?.data ?? {}}
          />
        )}

        {/* 自訂警示規則 */}
        <AlertRulesBlock
          rules={rules}
          onAdd={handleAddRule}
          onToggle={handleToggleRule}
          onDelete={handleDeleteRule}
          onEdit={handleEditRule}
        />

      </div>
    </div>
  );
}
