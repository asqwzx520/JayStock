"use client";

interface PriceTagProps {
  price: number;
  change: number;       // 漲跌金額
  changePct: number;    // 漲跌百分比
  size?: "sm" | "md" | "lg";
}

export function PriceTag({ price, change, changePct, size = "md" }: PriceTagProps) {
  const isUp   = change > 0;
  const isDown = change < 0;
  const colorClass = isUp ? "text-up" : isDown ? "text-down" : "text-flat";

  const priceSize = { sm: "text-[16px]", md: "text-[22px]", lg: "text-[28px]" }[size];
  const changeSize = { sm: "text-[11px]", md: "text-[13px]", lg: "text-[15px]" }[size];

  return (
    <div className="flex items-baseline gap-2">
      <span className={`num font-bold ${priceSize} ${colorClass}`}>
        {price.toFixed(2)}
      </span>
      <span className={`num ${changeSize} ${colorClass}`}>
        {isUp ? "▲" : isDown ? "▼" : "―"}
        {" "}{Math.abs(change).toFixed(2)}
        {" "}({isUp ? "+" : ""}{changePct.toFixed(2)}%)
      </span>
    </div>
  );
}
