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
          background: "linear-gradient(135deg, #0a0a0a 0%, #142620 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 84,
            fontWeight: 700,
            fontFamily: "sans-serif",
            color: "#34d399",
            letterSpacing: -2,
          }}
        >
          N
        </div>
      </div>
    ),
    { ...size }
  );
}
