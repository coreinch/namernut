import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks cross-origin requests to the dev server by default,
  // accepting only the hostname it was started with (localhost) — needed
  // here so a LAN device hitting this machine's IP directly isn't rejected.
  // Dev-only; has no effect on `next build`/production.
  allowedDevOrigins: ["192.168.2.7"],

  // Traces the minimal set of files/node_modules each route actually needs
  // into .next/standalone, including a self-contained server.js. Without
  // this, a Docker runtime stage would need the full node_modules tree
  // (all devDependencies-free but still much larger) rather than just
  // what's traced. .next/static and public/ are NOT included in the trace
  // and must be copied in separately — see the Dockerfile.
  output: "standalone",
};

export default nextConfig;
