// Consistent keyboard-focus styling for every interactive element, so tab
// navigation reads as one deliberate system instead of the browser default.
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// The single-column width used for the first-visit hero (see page.tsx's
// isFirstVisit) and, within the wider layout below, the actual search/
// results column — deliberately narrow and fixed even on desktop, so that
// column itself still reads as conversational, not a dashboard stretched to
// fill a monitor.
export const CONTENT_WIDTH = "max-w-2xl";

// The page's overall width once there's a settings rail alongside the
// content column (see page.tsx's two-pane, non-first-visit layout) —
// CONTENT_WIDTH plus room for that rail on `lg:` screens. Header and Footer
// use this (not CONTENT_WIDTH) whenever they're rendered alongside that
// wider layout, so their own edges land under the rail+content pair's
// combined edges instead of only the narrower content column's — otherwise
// the header/footer read as narrower than the body between them on desktop.
export const PAGE_WIDTH = "max-w-2xl lg:max-w-5xl";
