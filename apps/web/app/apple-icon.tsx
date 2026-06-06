import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size    = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width:           180,
          height:          180,
          background:      "#0a0e17",
          borderRadius:    36,
          display:         "flex",
          flexDirection:   "column",
          alignItems:      "center",
          justifyContent:  "center",
          gap:             4,
        }}
      >
        {/* 大寫 J */}
        <div
          style={{
            fontSize:      96,
            fontWeight:    800,
            fontFamily:    "monospace",
            color:         "#3B82F6",
            lineHeight:    1,
            letterSpacing: "-4px",
          }}
        >
          J
        </div>
        {/* 副標 */}
        <div
          style={{
            fontSize:      18,
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
    { ...size }
  );
}
