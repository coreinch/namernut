import { useEffect, useRef } from "react";

// Keeps keyboard/screen-reader focus from being dropped to <body> when the
// element that had it unmounts as the page changes state.
export function useFocusHandoff(isRunning: boolean, isFirstVisit: boolean) {
  // The Footer (see below) only renders while isRunning — its own "Stop"
  // button unmounts the instant a run ends, whether from actually finishing
  // or from that same button being clicked. A mouse user never notices
  // (there's nothing left to click there anyway), but a keyboard/screen-
  // reader user who had focus on it gets silently dropped to <body> — the
  // same failure mode ResultCard's onRemove and SettingsDrawer's onClose
  // both hand focus off explicitly to avoid. Unlike those two, there's no
  // single natural "next" element already in hand here, so this checks
  // whether focus actually landed on <body> (the one-node signature of an
  // unmounted-out-from-under-you focus loss) before redirecting it — never
  // steals focus from something the user is legitimately doing elsewhere.
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    if (wasRunningRef.current && !isRunning && document.activeElement === document.body) {
      document.getElementById("primary-search-action")?.focus();
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  // Starting the very first search flips isFirstVisit false in the same
  // render that starts the run — swapping the entire hero layout (including
  // the very "Generate" button just clicked) for the compact layout below,
  // whose SearchBar is a structurally different subtree, not an update to
  // the same one. React has no reason to preserve identity across that, so
  // the hero's Generate button unmounts along with the rest of the hero,
  // dropping a keyboard/screen-reader user's focus to <body> on literally
  // their first interaction with the app — confirmed directly (activeElement
  // was <body> right after firing this click in isolation). Same guarded-
  // redirect shape as the isRunning effect above (only ever act once focus
  // has actually landed on <body>, never steal it preemptively): once the
  // compact layout mounts, its own primary button (now reading "Stop",
  // since the run isFirstVisit was gating on already started) is the
  // closest equivalent to what was just clicked.
  const wasFirstVisitRef = useRef(isFirstVisit);
  useEffect(() => {
    if (wasFirstVisitRef.current && !isFirstVisit && document.activeElement === document.body) {
      document.getElementById("primary-search-action")?.focus();
    }
    wasFirstVisitRef.current = isFirstVisit;
  }, [isFirstVisit]);
}
