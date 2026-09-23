import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 100,
            fontWeight: 700,
            fontFamily: "sans-serif",
            color: "#ff6b35",
            letterSpacing: -3,
          }}
        >
          n
        </div>
      </div>
    ),
    { ...size }
  );
}
