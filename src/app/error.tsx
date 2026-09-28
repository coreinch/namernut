"use client";

import { useEffect } from "react";
import { FOCUS_RING } from "@/components/constants";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      {/* role="alert" so a screen reader announces this the instant it
          replaces whatever was on screen — this boundary swaps in for the
          whole page's content with no navigation event to trigger a
          re-scan, the same reason page.tsx's own error banner uses the same
          role. */}
      <p role="alert" className="text-lg font-semibold">
        Something went wrong.
      </p>
      <p className="max-w-sm text-sm text-muted">
        The page hit an unexpected error. Trying again usually fixes it.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className={`min-h-12 shrink-0 whitespace-nowrap rounded-full bg-accent px-6 text-base font-semibold text-white transition-all active:scale-95 hover:opacity-90 ${FOCUS_RING}`}
      >
        Try again
      </button>
    </div>
  );
}
