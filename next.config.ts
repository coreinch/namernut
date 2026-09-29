import type { NextConfig } from "next";

// One id per build, shared by the server (/api/version) and the client
// bundle (inlined via `env`), so an open tab can tell when the server it
// talks to has been redeployed. `??=` keeps it stable if this config is
// evaluated more than once during a single build.
process.env.APP_BUILD_ID ??= Date.now().toString(36);
const buildId = process.env.APP_BUILD_ID;

// Fast Refresh (HMR) in `next dev` needs 'unsafe-eval'; production doesn't.
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  generateBuildId: async () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },

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
          // 'unsafe-inline' on script-src is needed for Next.js's own
          // inline bootstrap scripts. 'unsafe-eval' was verified
          // unnecessary against a real production build (npm run build +
          // npm run start) — dev-mode HMR needs it, production doesn't.
          // There's no external ad/analytics script this app loads that a
          // stricter policy would be protecting against. connect-src
          // covers the client's direct calls to this app's own /api/*
          // routes only — no third-party API is called from the browser.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self' data:",
              isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // This app never uses any of these browser features, and has no
          // cross-origin popups/embeds (no OAuth, no third-party iframes),
          // so the stricter COOP/CORP defaults are safe here.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
