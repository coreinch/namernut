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
            color: "#ff6b35",
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
