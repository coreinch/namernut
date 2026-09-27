import { useEffect, useRef, type ReactNode } from "react";
import { FOCUS_RING } from "./constants";

/**
 * Mobile/`<lg` home for SettingsPanel (see page.tsx) — a bottom-sheet
 * overlay reached via SearchBar's "Customize" button. `lg:hidden` on the
 * outer wrapper is a deliberate second guard, not just page.tsx choosing not
 * to open it there: the desktop settings rail already shows the same
 * SettingsPanel content inline and permanently, so this must never stack a
 * second copy on top of it even if `open` were somehow still true at that
 * width (e.g. a resize while it was open). Renders nothing at all while
 * closed, same "return null" pattern LiveLogSection already uses — no
 * portal, consistent with the rest of this codebase, which doesn't use one
 * either.
 */
export function SettingsDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: the backdrop button and everything in SettingsPanel's
      // form controls are still real, tabbable DOM elements sitting behind
      // this overlay in z-index only, not in tab order — without this, Tab
      // from the last control (or Shift+Tab from the first) escapes the
      // open dialog into the page underneath it, which a sighted mouse user
      // never notices but leaves a keyboard/screen-reader user acting on
      // controls they can't see.
      if (e.key !== "Tab" || !containerRef.current) return;
      const focusable = containerRef.current.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    // Moves focus into the dialog on open — without this, focus stays on
    // whatever was under it (usually the "Customize" trigger, now visually
    // covered by the overlay), which is disorienting for keyboard/screen
    // reader users.
    closeButtonRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 flex items-end justify-center lg:hidden">
      <button
        type="button"
        aria-label="Close search options"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search options"
        className="animate-fade-in-up relative z-10 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-background p-4 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Search options</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close search options"
            className={`flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-black/50 transition-colors hover:bg-black/5 hover:text-black/80 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/80 ${FOCUS_RING}`}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
