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

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // 'unsafe-inline'/'unsafe-eval' on script-src are needed for
          // Next.js's own inline bootstrap scripts and dev-mode HMR; there's
          // no external ad/analytics script this app loads that a stricter
          // policy would be protecting against. connect-src covers the
          // client's direct calls to this app's own /api/* routes only —
          // no third-party API is called from the browser.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
