import { ImageResponse } from "next/og";
import { DESCRIPTION } from "@/lib/copy";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #241a4d 0%, #100a29 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 120,
              height: 120,
              borderRadius: 28,
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #2b2158 0%, #100a29 100%)",
              fontSize: 76,
              fontWeight: 700,
              color: "#ff6b35",
            }}
          >
            n
          </div>
          <div style={{ display: "flex", fontSize: 88, fontWeight: 700, color: "#f7f5ff", letterSpacing: -2 }}>
            namernut
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 48,
            fontSize: 40,
            lineHeight: 1.4,
            color: "#c9c2e8",
            maxWidth: 980,
          }}
        >
          {DESCRIPTION}
        </div>
      </div>
    ),
    { ...size }
  );
}
