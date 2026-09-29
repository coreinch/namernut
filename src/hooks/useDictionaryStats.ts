import { useEffect, useState } from "react";
import type { DictionaryStats } from "@/lib/searchConfig";

// Live pool-size stats for the current language/length/keyword selection,
// shown in the settings panel. Null until the first response arrives.
export function useDictionaryStats(langsParam: string, maxLength: number, keywordParam: string) {
  const [stats, setStats] = useState<DictionaryStats | null>(null);

  useEffect(() => {
    // Abort the previous in-flight request on every re-run (including on
    // unmount): without this, the very first fetch — dispatched on mount
    // with the default all-languages selection, before localStorage
    // hydration restores the real one a moment later — can resolve *after*
    // the second, correct-filters request and silently overwrite it with
    // the stale, unfiltered pool size. Aborting means only the latest
    // request's response can ever reach setStats.
    const controller = new AbortController();
    // keywordParam changes on every keystroke in the keyword field — debounce
    // so typing doesn't fire a request per character.
    const id = setTimeout(() => {
      fetch(
        `/api/stats?langs=${encodeURIComponent(langsParam)}&maxLength=${maxLength}&keyword=${encodeURIComponent(keywordParam)}`,
        { signal: controller.signal }
      )
        // A non-2xx response (e.g. STATS_RATE_LIMIT hit) is a plain
        // {error: "..."} JSON body, not a DictionaryStats shape — passing
        // it straight to setStats crashed SettingsPanel's
        // formatNumber(stats.totalCombinations) on the resulting
        // `undefined`. Match the res.ok guard already used by the
        // discover/brandability fetches below.
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) setStats(data);
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [langsParam, maxLength, keywordParam]);

  return stats;
}
