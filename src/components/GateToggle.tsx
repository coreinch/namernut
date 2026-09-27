import { FOCUS_RING } from "./constants";

/** A labeled on/off switch for one DiscoveryGates flag (or any other boolean
 * setting) — accent-colored when on, with the thumb position (not just
 * color) carrying the state. `disabled` grays it out and makes it inert
 * (e.g. "Dictionary pairing" is always on and can't be turned off, or an AI
 * toggle needs a keyword typed first) — `disabledReason` is required
 * alongside it, since a disabled control with no stated reason is a dead
 * end for a screen-reader user, who can't see the grayed-out styling
 * sighted users use to infer why. */
export function GateToggle({
  label,
  checked,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 text-xs text-muted">
      <span className={disabled ? "text-black/35 dark:text-white/35" : undefined}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={disabled && disabledReason ? `${label} — ${disabledReason}` : label}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${FOCUS_RING} ${
          disabled
            ? "cursor-not-allowed bg-black/10 dark:bg-white/10"
            : checked
              ? "bg-accent"
              : "bg-black/15 dark:bg-white/20"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full transition-transform ${
            disabled ? "bg-white/60 dark:bg-white/30" : "bg-white"
          } ${checked ? "translate-x-5" : "translate-x-0"}`}
        />
      </button>
    </div>
  );
}
