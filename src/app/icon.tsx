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
          background: "linear-gradient(135deg, #0a0a0a 0%, #142620 100%)",
          borderRadius: 96,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 240,
            fontWeight: 700,
            fontFamily: "sans-serif",
            color: "#34d399",
            letterSpacing: -6,
          }}
        >
          .d
        </div>
      </div>
    ),
    { ...size }
  );
}
