"use client";

/**
 * AlertModal — K 線圖工具列「🔔 設警報」按鈕觸發的浮動 Modal
 *
 * 功能：
 *  - 顯示所有已存在的警示規則
 *  - 快速新增 / 編輯規則（預填當前股票名稱）
 *  - 使用與 HomeDashboard 相同的 alertRulesApi
 */

import { useCallback, useEffect, useState } from "react";
import {
  alertRulesApi,
  ALERT_RULE_FIELDS,
  getUserId,
  type AlertRule,
  type AlertRuleCondition,
  type AlertRuleLogic,
  type AlertRuleOperator,
  type CreateAlertRulePayload,
} from "@/lib/api";

// ── Condition row ─────────────────────────────────────────────────────────────

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
  cond:       AlertRuleCondition;
  index:      number;
  onChange:   (i: number, c: AlertRuleCondition) => void;
  onRemove:   (i: number) => void;
  showRemove: boolean;
}) {
  const fieldMeta = ALERT_RULE_FIELDS.find((f) => f.value === cond.field);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <select
        className="text-xs px-2 py-1 rounded border"
        style={{
          background:  "var(--bg-surface)",
          color:       "var(--text-primary)",
          borderColor: "var(--border)",
          minWidth:    "110px",
        }}
        value={cond.field}
        onChange={(e) => onChange(index, { ...cond, field: e.target.value })}
      >
        {ALERT_RULE_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      <select
        className="text-xs px-2 py-1 rounded border w-14"
        style={{
          background:  "var(--bg-surface)",
          color:       "var(--text-primary)",
          borderColor: "var(--border)",
        }}
        value={cond.operator}
        onChange={(e) =>
          onChange(index, { ...cond, operator: e.target.value as AlertRuleOperator })
        }
      >
        {OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <input
        type="number"
        step="any"
        className="text-xs px-2 py-1 rounded border w-20"
        style={{
          background:  "var(--bg-surface)",
          color:       "var(--text-primary)",
          borderColor: "var(--border)",
        }}
        value={cond.value}
        onChange={(e) =>
          onChange(index, { ...cond, value: parseFloat(e.target.value) || 0 })
        }
      />
      {fieldMeta?.unit && (
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {fieldMeta.unit}
        </span>
      )}
      {fieldMeta?.hint && (
        <span className="text-[10px] hidden sm:inline" style={{ color: "var(--text-tertiary)" }}>
          ({fieldMeta.hint})
        </span>
      )}

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

// ── Rule form ─────────────────────────────────────────────────────────────────

function RuleForm({
  initial,
  defaultName,
  onSave,
  onCancel,
}: {
  initial?:    AlertRule;
  defaultName: string;
  onSave:      (p: CreateAlertRulePayload) => void;
  onCancel:    () => void;
}) {
  const [name, setName]       = useState(initial?.name ?? defaultName);
  const [logic, setLogic]     = useState<AlertRuleLogic>(initial?.logic ?? "AND");
  const [conditions, setConds] = useState<AlertRuleCondition[]>(
    initial?.conditions ?? [{ field: "rsi14", operator: "<", value: 30 }]
  );

  const updateCond = (i: number, c: AlertRuleCondition) =>
    setConds((prev) => prev.map((x, idx) => (idx === i ? c : x)));
  const removeCond = (i: number) =>
    setConds((prev) => prev.filter((_, idx) => idx !== i));
  const addCond = () => {
    if (conditions.length < 10)
      setConds((prev) => [...prev, { field: "vol_ratio", operator: ">", value: 2 }]);
  };

  return (
    <div className="space-y-3">
      {/* 名稱 */}
      <div>
        <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>
          規則名稱
        </label>
        <input
          type="text"
          maxLength={60}
          className="w-full text-sm px-2.5 py-1.5 rounded border"
          style={{
            background:  "var(--bg-elevated)",
            color:       "var(--text-primary)",
            borderColor: "var(--border)",
          }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* 邏輯 + 條件 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>條件</span>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>邏輯：</span>
            {(["AND", "OR"] as AlertRuleLogic[]).map((l) => (
              <button
                key={l}
                onClick={() => setLogic(l)}
                className="text-xs px-2 py-0.5 rounded font-medium transition-colors"
                style={{
                  background:  logic === l ? "var(--color-brand)" : "var(--bg-elevated)",
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

        {conditions.length < 10 && (
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
          onClick={() =>
            name.trim() &&
            onSave({ name: name.trim(), conditions, logic, is_active: true })
          }
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

// ── Main Modal ────────────────────────────────────────────────────────────────

interface Props {
  symbol: string;
  name?:  string;
  onClose: () => void;
}

export default function AlertModal({ symbol, name, onClose }: Props) {
  const userId = typeof window !== "undefined" ? getUserId() : "";
  const [rules,       setRules]       = useState<AlertRule[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [editTarget,  setEditTarget]  = useState<AlertRule | null>(null);
  const [saving,      setSaving]      = useState(false);

  const stockLabel  = name ? `${symbol} ${name}` : symbol;
  const defaultName = `${stockLabel} 警示`;

  // ── Load rules ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await alertRulesApi.list();
      setRules(res.rules);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const handleSave = async (payload: CreateAlertRulePayload) => {
    setSaving(true);
    try {
      if (editTarget) {
        const updated = await alertRulesApi.update(editTarget.id, payload);
        setRules((prev) => prev.map((r) => (r.id === editTarget.id ? updated : r)));
      } else {
        const created = await alertRulesApi.create(payload);
        setRules((prev) => [...prev, created]);
      }
      setShowForm(false);
      setEditTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string) => {
    const updated = await alertRulesApi.toggle(id);
    setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
  };

  const handleDelete = async (id: string) => {
    await alertRulesApi.delete(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Panel */}
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl overflow-hidden"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              🔔 設定警示規則
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {stockLabel} ・ 規則會套用至全部自選股掃描
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded text-lg leading-none"
            style={{ color: "var(--text-tertiary)", background: "var(--bg-elevated)" }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* 新增表單 */}
          {showForm && (
            <div
              className="rounded-lg p-3"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              <div className="text-xs font-medium mb-3" style={{ color: "var(--color-brand)" }}>
                {editTarget ? "編輯規則" : "新增規則"}
              </div>
              <RuleForm
                initial={editTarget ?? undefined}
                defaultName={defaultName}
                onSave={handleSave}
                onCancel={() => { setShowForm(false); setEditTarget(null); }}
              />
            </div>
          )}

          {/* 載入中 */}
          {loading && !showForm && (
            <div className="flex justify-center py-8">
              <div
                className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: "var(--color-brand)", borderTopColor: "transparent" }}
              />
            </div>
          )}

          {/* 規則列表 */}
          {!loading && rules.length === 0 && !showForm && (
            <p className="text-sm text-center py-6" style={{ color: "var(--text-tertiary)" }}>
              尚未設定任何警示規則
            </p>
          )}

          {rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-lg px-3 py-2.5 flex items-start gap-2"
              style={{
                background: "var(--bg-elevated)",
                border:     `1px solid ${rule.is_active ? "var(--border)" : "transparent"}`,
                opacity:    rule.is_active ? 1 : 0.5,
              }}
            >
              {/* Toggle */}
              <button
                onClick={() => handleToggle(rule.id)}
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

              {/* Info */}
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
                  onClick={() => { setEditTarget(rule); setShowForm(true); }}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: "var(--text-secondary)", background: "rgba(255,255,255,0.05)" }}
                >
                  編輯
                </button>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: "var(--color-down)", background: "rgba(239,68,68,0.08)" }}
                >
                  刪除
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="shrink-0 px-4 py-3 flex items-center justify-between border-t"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            {rules.filter((r) => r.is_active).length}/{rules.length} 條規則啟用
          </span>
          {!showForm && rules.length < 20 && (
            <button
              onClick={() => { setShowForm(true); setEditTarget(null); }}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded font-medium disabled:opacity-40"
              style={{ background: "var(--color-brand)", color: "#fff" }}
            >
              ＋ 新增規則
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
