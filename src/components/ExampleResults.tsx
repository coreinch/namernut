import type { FoundEntry } from "@/lib/types";
import { ResultCard } from "./ResultCard";

// Hardcoded on purpose: a first-visit sample of what a result looks like
// (name, source accent, brandability score) must never trigger a live
// search or a metered brandability check just by loading the page.
const EXAMPLES: { entry: FoundEntry }[] = [
  {
    entry: {
      id: "example-glowly",
      domain: "glowly.com",
      meaning: "glow + ly — a soft, friendly suffix pairing",
      checkedCount: 0,
      runId: "example",
      source: "dictionary",
      brandabilityScore: 86,
      brandabilitySummary: "Distinctive and easy to say; no major brand uses it.",
    },
  },
  {
    entry: {
      id: "example-beanery",
      domain: "beanery.io",
      meaning: "AI synonym for coffee — a place where beans are roasted",
      checkedCount: 0,
      runId: "example",
      source: "aiSynonym",
      brandabilityScore: 64,
      brandabilitySummary: "Clear meaning, but a few small cafés already use the word.",
    },
  },
  {
    entry: {
      id: "example-novaro",
      domain: "novaro.app",
      meaning: "AI-invented name inspired by nova",
      checkedCount: 0,
      runId: "example",
      source: "invented",
      brandabilityScore: 92,
      brandabilitySummary: "Invented word with no real-world usage to compete with.",
    },
  },
];

const noop = () => {};

export function ExampleResults() {
  return (
    <section aria-labelledby="example-results-heading" className="flex flex-col gap-2">
      <h2 id="example-results-heading" className="text-center text-xs font-medium text-muted">
        Example results
      </h2>
      {EXAMPLES.map(({ entry }) => (
        <div key={entry.id}>
          {/* inert: a sample, not a live result — its favorite/Register/
              Brandability buttons would otherwise look clickable but do
              nothing. */}
          <div inert className="w-full">
            <ResultCard
              entry={entry}
              favorited={false}
              brandability={{
                score: entry.brandabilityScore,
                summary: entry.brandabilitySummary,
                loading: false,
                error: undefined,
              }}
              onSearch={noop}
              onToggleFavorite={noop}
              onCheckBrandability={noop}
              onRegister={noop}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
