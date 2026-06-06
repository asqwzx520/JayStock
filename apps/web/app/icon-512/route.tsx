import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export function GET(_req: NextRequest) {
  return new ImageResponse(
    (
      <div
        style={{
          width:           512,
          height:          512,
          background:      "linear-gradient(135deg, #0a0e17 0%, #0f172a 100%)",
          display:         "flex",
          flexDirection:   "column",
          alignItems:      "center",
          justifyContent:  "center",
          gap:             8,
        }}
      >
        {/* 外圈光暈 */}
        <div
          style={{
            position:  "absolute",
            width:     260,
            height:    260,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)",
          }}
        />
        <div
          style={{
            fontSize:      280,
            fontWeight:    800,
            fontFamily:    "monospace",
            color:         "#3B82F6",
            lineHeight:    1,
            letterSpacing: "-12px",
            zIndex:        1,
          }}
        >
          J
        </div>
        <div
          style={{
            fontSize:      52,
            fontWeight:    600,
            fontFamily:    "monospace",
            color:         "#60A5FA",
            letterSpacing: "8px",
            zIndex:        1,
          }}
        >
          STOCK
        </div>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
