"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/layout/Header";
import LeftPanel from "@/components/layout/LeftPanel";
import RightPanel from "@/components/layout/RightPanel";
import KLineChart, { type IndicatorType } from "@/components/chart/KLineChart";
import IndicatorSelector from "@/components/chart/IndicatorSelector";
import PeriodSelector, { type Period } from "@/components/chart/PeriodSelector";
import { getQuote, getKline, type Quote, type KlineBar } from "@/lib/api";

const DEFAULT_SYMBOL = "2330";

export default function Home() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [stockName, setStockName] = useState("台積電");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [klineData, setKlineData] = useState<KlineBar[]>([]);
  const [period, setPeriod] = useState<Period>("daily");
  const [indicators, setIndicators] = useState<IndicatorType[]>(["MA"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(
    async (sym: string, prd: string) => {
      setLoading(true);
      setError("");
      try {
        const [q, k] = await Promise.all([
          getQuote(sym).catch(() => null),
          getKline(sym, prd),
        ]);
        if (q) {
          setQuote(q);
          setStockName(q.name);
        }
        setKlineData(k.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "載入失敗");
        setKlineData([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadData(symbol, period);
  }, [symbol, period, loadData]);

  useEffect(() => {
    if (!symbol) return;
    const interval = setInterval(async () => {
      try {
        const q = await getQuote(symbol);
        setQuote(q);
      } catch {
        // silent
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [symbol]);

  function handleSelectStock(sym: string, name?: string) {
    setSymbol(sym);
    if (name) setStockName(name);
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        currentSymbol={`${symbol} ${stockName}`}
        onSelectStock={handleSelectStock}
      />

      <div className="flex flex-1 min-h-0">
        <LeftPanel
          currentSymbol={symbol}
          onSelectStock={(sym) => handleSelectStock(sym)}
        />

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <div
            className="flex items-center justify-between gap-3 px-4 py-2 border-b"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border)",
            }}
          >
            <div className="flex items-center gap-4">
              <div className="flex items-baseline gap-2">
                <span
                  className="num text-sm font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {symbol}
                </span>
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {stockName}
                </span>
                {quote && (
                  <span
                    className="num text-lg font-bold"
                    style={{
                      color:
                        quote.change > 0
                          ? "var(--color-up)"
                          : quote.change < 0
                            ? "var(--color-down)"
                            : "var(--color-flat)",
                    }}
                  >
                    {quote.price.toFixed(2)}
                    <span className="text-sm ml-1.5">
                      {quote.change > 0 ? "+" : ""}
                      {quote.change_pct.toFixed(2)}%
                    </span>
                  </span>
                )}
              </div>
              <PeriodSelector active={period} onChange={setPeriod} />
            </div>
            <IndicatorSelector active={indicators} onChange={setIndicators} />
          </div>

          <div className="flex-1 min-h-0 relative">
            {loading && klineData.length === 0 && (
              <div
                className="absolute inset-0 flex items-center justify-center z-10"
                style={{ background: "var(--bg-surface)" }}
              >
                <span style={{ color: "var(--text-tertiary)" }}>載入中...</span>
              </div>
            )}
            {error && (
              <div
                className="absolute inset-0 flex items-center justify-center z-10"
                style={{ background: "var(--bg-surface)" }}
              >
                <span style={{ color: "var(--color-up)" }}>{error}</span>
              </div>
            )}
            {klineData.length > 0 && (
              <KLineChart data={klineData} indicators={indicators} />
            )}
          </div>
        </main>

        <RightPanel quote={quote} />
      </div>
    </div>
  );
}
