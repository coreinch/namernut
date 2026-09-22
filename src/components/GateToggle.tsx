import { FOCUS_RING } from "./constants";

/** A labeled on/off switch for one DiscoveryGates flag — accent-colored when on, with the thumb position (not just color) carrying the state. */
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
  /** Renders the switch inert and dimmed — e.g. "AI synonyms" has nothing to synonym-expand without a keyword typed, but still stays visible (rather than disappearing) so it never reads as if a different toggle took its place. */
  disabled?: boolean;
  /** Same "announced (via aria-label) and shown as a tooltip when disabled" convention as StyleChip's disabledReason — a disabled switch with no stated reason is a dead end for a screen-reader user. */
  disabledReason?: string;
}) {
  return (
    <div className={`flex min-h-9 items-center justify-between gap-3 text-xs text-muted ${disabled ? "opacity-40" : ""}`}>
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={disabled && disabledReason ? `${label} — ${disabledReason}` : label}
        title={disabled ? disabledReason : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${disabled ? "cursor-not-allowed" : ""} ${FOCUS_RING} ${
          checked ? "bg-accent" : "bg-black/15 dark:bg-white/20"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
