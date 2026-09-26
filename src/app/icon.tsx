import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #2b2158 0%, #100a29 100%)",
          borderRadius: 96,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 300,
            fontWeight: 700,
            fontFamily: "sans-serif",
            // Matches globals.css's dark-mode --accent (this icon renders on
            // a dark gradient, so the dark-mode shade applies) — was the
            // pre-round-5 accent, since drifted from the live app's color.
            color: "#c24618",
            letterSpacing: -8,
          }}
        >
          n
        </div>
      </div>
    ),
    { ...size }
  );
}
