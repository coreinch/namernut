import { useEffect } from "react";

const CURRENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Reloads the page in place when a newer build has been deployed, so open
 * tabs pick up frontend changes without a manual refresh. Never reloads
 * while `busy` (a search is running); it retries on the next check. App
 * state is persisted (usePersistedAppState), so a reload keeps it. */
export function useAutoUpdate(busy: boolean) {
  useEffect(() => {
    if (!CURRENT_BUILD_ID || busy) return;
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = await res.json();
        if (!cancelled && buildId && buildId !== CURRENT_BUILD_ID) window.location.reload();
      } catch {
        // Offline or mid-deploy; try again on the next check.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [busy]);
}
