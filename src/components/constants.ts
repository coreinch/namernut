// Consistent keyboard-focus styling for every interactive element, so tab
// navigation reads as one deliberate system instead of the browser default.
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Shared by the header, main content, and footer's inner wrappers so all
// three stay center-aligned to the same column at every width — grows a
// little on larger screens (rather than staying fixed at max-w-2xl
// forever) so the result-card grid isn't stuck at a mobile-era width on an
// actual desktop monitor, but still caps out well short of full-bleed so
// text never has to stretch across the whole screen to be read.
export const CONTENT_WIDTH = "max-w-2xl lg:max-w-3xl xl:max-w-4xl";
