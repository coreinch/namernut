import type { RunStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: RunStatus }) {
  // Accent orange is reserved for "found" (the one positive outcome) and
  // red for "error" (the one failure state) — every other status is
  // grayscale, told apart by its label and (for "running") motion rather
  // than a third color.
  const map: Record<RunStatus, { label: string; dot: string }> = {
    idle: { label: "Idle", dot: "bg-black/35 dark:bg-white/35" },
    running: { label: "Running", dot: "bg-black/50 animate-pulse dark:bg-white/50" },
    stopped: { label: "Stopped", dot: "bg-black/35 dark:bg-white/35" },
    found: { label: "Found", dot: "bg-accent" },
    error: { label: "Error", dot: "bg-red-500" },
  };
  const { label, dot } = map[status];
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
