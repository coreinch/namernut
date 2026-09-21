import type { LogStatus } from "@/lib/types";

// Accent orange marks the one positive outcome ("available"); every other
// status is grayscale, told apart by motion ("checking" pulses, nothing
// else does) and by the status word LOG_STATUS_LABEL prints next to it —
// never by hue alone, so the log stays legible without relying on color
// perception.
export const LOG_STATUS_LABEL: Record<LogStatus, string> = {
  checking: "checking…",
  taken: "taken",
  unknown: "unknown",
  available: "available",
  filtered: "filtered",
};

export function LogDot({ status }: { status: LogStatus }) {
  const className =
    status === "checking"
      ? "bg-black/40 animate-pulse dark:bg-white/40"
      : status === "available"
        ? "bg-accent"
        : "bg-black/30 dark:bg-white/30";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${className}`} />;
}
