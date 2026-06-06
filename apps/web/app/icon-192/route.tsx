import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export function GET(_req: NextRequest) {
  return new ImageResponse(
    (
      <div
        style={{
          width:           192,
          height:          192,
          background:      "#0a0e17",
          display:         "flex",
          flexDirection:   "column",
          alignItems:      "center",
          justifyContent:  "center",
          gap:             4,
        }}
      >
        <div
          style={{
            fontSize:      104,
            fontWeight:    800,
            fontFamily:    "monospace",
            color:         "#3B82F6",
            lineHeight:    1,
            letterSpacing: "-4px",
          }}
        >
          J
        </div>
        <div
          style={{
            fontSize:      20,
            fontWeight:    600,
            fontFamily:    "monospace",
            color:         "#60A5FA",
            letterSpacing: "2px",
          }}
        >
          STOCK
        </div>
      </div>
    ),
    { width: 192, height: 192 }
  );
}
