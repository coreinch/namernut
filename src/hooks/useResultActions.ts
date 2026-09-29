import { useCallback } from "react";
import type { FoundEntry } from "@/lib/types";

// TODO(affiliate): once we're signed up with Namecheap's affiliate program,
// tag this URL with whatever tracking it requires. Left as a single named
// spot rather than guessing now, since the exact mechanism (a query param
// appended here vs. wrapping the whole URL in a redirect through the
// affiliate network's own domain, e.g. Awin/CJ) depends on which program we
// actually join.
function namecheapRegisterUrl(domain: string): string {
  return `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(domain)}`;
}

// The per-result actions wired into ResultCard: search the name on Google,
// open the registrar, star/unstar, and remove from the archive.
export function useResultActions({
  setFavorites,
  setFoundHistory,
  foundDomainsRef,
}: {
  setFavorites: React.Dispatch<React.SetStateAction<FoundEntry[]>>;
  setFoundHistory: React.Dispatch<React.SetStateAction<FoundEntry[]>>;
  foundDomainsRef: React.RefObject<Set<string>>;
}) {
  const searchDomain = useCallback((entry: FoundEntry) => {
    // Search the bare name, not the TLD (e.g. "swiftfox", not "swiftfox.com") —
    // domain here is always name + "." + tld, no subdomains, so splitting on
    // the first "." reliably strips it.
    const name = entry.domain.split(".")[0];
    const url = `https://www.google.com/search?q=${encodeURIComponent(name)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const registerDomain = useCallback((entry: FoundEntry) => {
    window.open(namecheapRegisterUrl(entry.domain), "_blank", "noopener,noreferrer");
  }, []);

  const toggleFavorite = useCallback((entry: FoundEntry) => {
    setFavorites((prev) =>
      prev.some((f) => f.domain === entry.domain)
        ? prev.filter((f) => f.domain !== entry.domain)
        : [entry, ...prev]
    );
  }, [setFavorites]);

  // Only ever wired to the Current/Archive tabs (see ResultCard's own
  // comment on why Favorites omits this) — doesn't touch `favorites`,
  // which is intentionally a separate, durable copy (see toggleFavorite
  // above) rather than a reference into foundHistory. Also drops the
  // domain from foundDomainsRef: without this, a later run that
  // legitimately rediscovers the same available domain would have its
  // "found" handler see isNewFind === false (see useDiscoveryRun's start())
  // and silently skip re-adding it — removal would look like it worked
  // once, then quietly made that domain unreachable forever.
  const removeEntry = useCallback((entry: FoundEntry) => {
    setFoundHistory((prev) => prev.filter((e) => e.id !== entry.id));
    foundDomainsRef.current.delete(entry.domain);
  }, [setFoundHistory, foundDomainsRef]);

  return { searchDomain, registerDomain, toggleFavorite, removeEntry };
}
