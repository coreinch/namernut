import Link from "next/link";
import { FOCUS_RING } from "@/components/constants";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg font-semibold">Page not found.</p>
      <p className="max-w-sm text-sm text-muted">
        That link doesn&apos;t match anything here — try generating a name from the homepage instead.
      </p>
      <Link
        href="/"
        className={`min-h-12 shrink-0 whitespace-nowrap rounded-full bg-accent px-6 text-base font-semibold text-white transition-all active:scale-95 hover:opacity-90 ${FOCUS_RING}`}
      >
        Back to namernut
      </Link>
    </div>
  );
}
