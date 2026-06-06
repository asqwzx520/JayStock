import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size    = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width:           32,
          height:          32,
          background:      "#0a0e17",
          borderRadius:    6,
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          fontFamily:      "monospace",
          fontSize:        18,
          fontWeight:      700,
          color:           "#3B82F6",
          letterSpacing:   "-1px",
        }}
      >
        J
      </div>
    ),
    { ...size }
  );
}
