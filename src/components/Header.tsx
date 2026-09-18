import type { RunStatus } from "@/lib/types";
import { CONTENT_WIDTH } from "./constants";
import { StatusBadge } from "./StatusBadge";

export function Header({ status, subtitle }: { status: RunStatus; subtitle: string }) {
  return (
    <header className="shrink-0 border-b border-black/15 bg-background/80 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3 backdrop-blur-md dark:border-white/15">
      <div className={`mx-auto flex w-full items-center gap-3 ${CONTENT_WIDTH}`}>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight">Namerag</h1>
          <p className="truncate text-xs text-black/65 dark:text-white/65">{subtitle}</p>
        </div>
        <div className="ml-auto shrink-0">
          <StatusBadge status={status} />
        </div>
      </div>
    </header>
  );
}
