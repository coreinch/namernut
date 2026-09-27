"use client";

import { useEffect } from "react";

// error.tsx only catches errors thrown by children of the root layout — an
// error thrown by the layout itself (or by error.tsx while rendering) needs
// this separate boundary, which replaces the entire document (hence its own
// <html>/<body>) since the layout that would normally provide them is what
// failed.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        {/* error.tsx/not-found.tsx inherit the app's light/dark theme via
            globals.css's --background/--foreground; this boundary can't,
            since it renders its own bare <html>/<body> (see comment above).
            Without this, a dark-mode visitor got the browser's default
            white-page fallback here — a jarring flash inconsistent with
            the rest of the app. Values match globals.css's --background/
            --foreground for each mode. */}
        <style>{`
          body { background: #f7f5ff; color: #1b1533; }
          @media (prefers-color-scheme: dark) {
            body { background: #181233; color: #ede9fb; }
          }
        `}</style>
      </head>
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            minHeight: "100vh",
            padding: "0 1rem",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <p style={{ fontSize: "1.125rem", fontWeight: 600 }}>Something went wrong.</p>
          <p style={{ maxWidth: "24rem", fontSize: "0.875rem", opacity: 0.7 }}>
            The page hit an unexpected error. Trying again usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              minHeight: "3rem",
              padding: "0 1.5rem",
              borderRadius: "9999px",
              border: "none",
              // Matches globals.css's --accent (light mode) — hardcoded
              // rather than var(--accent) since this boundary renders its
              // own <html>/<body>, bypassing globals.css entirely. White
              // text on #ff6b35 (the pre-round-5 accent) measured ~2.8:1,
              // under WCAG AA's 4.5:1; this value measures ~5.1:1.
              background: "#c2440a",
              color: "#fff",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
