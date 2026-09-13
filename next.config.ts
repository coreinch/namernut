import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks cross-origin requests to the dev server by default,
  // accepting only the hostname it was started with (localhost) — needed
  // here so a LAN device hitting this machine's IP directly isn't rejected.
  // Dev-only; has no effect on `next build`/production.
  allowedDevOrigins: ["192.168.2.7"],
};

export default nextConfig;
