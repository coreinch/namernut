// Consistent keyboard-focus styling for every interactive element, so tab
// navigation reads as one deliberate system instead of the browser default.
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Shared by the header, main content, and footer's inner wrappers so all
// three stay center-aligned to the same column. Deliberately narrow and
// fixed (not growing on larger breakpoints) — the guided, one-thing-at-a-
// time flow reads as conversational at any width, not a dashboard that
// stretches to fill a monitor.
export const CONTENT_WIDTH = "max-w-2xl";
