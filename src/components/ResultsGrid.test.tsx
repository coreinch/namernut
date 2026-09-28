// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResultsGrid } from "./ResultsGrid";
import type { FoundEntry } from "@/lib/types";

afterEach(cleanup);

function makeEntry(overrides: Partial<FoundEntry> = {}): FoundEntry {
  return {
    id: "1",
    domain: "glowtastic.com",
    meaning: "glow + tastic",
    checkedCount: 1,
    runId: "run-1",
    ...overrides,
  };
}

describe("ResultsGrid", () => {
  it("renders one ResultCard per entry, deriving the checked/favorited name from the domain", () => {
    const entries = [makeEntry({ id: "1", domain: "glowtastic.com" }), makeEntry({ id: "2", domain: "coffeeup.io" })];
    render(
      <ResultsGrid
        entries={entries}
        favoriteDomains={new Set(["coffeeup.io"])}
        checkingBrandabilityNames={new Set()}
        brandabilityErrors={{}}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
      />
    );
    expect(screen.getByText("glowtastic")).toBeTruthy();
    expect(screen.getByText("coffeeup")).toBeTruthy();
    // coffeeup.io was passed as a favorite domain — its star button should
    // read as pressed/"Remove from favorites"; glowtastic.com was not.
    expect(screen.getByRole("button", { name: "Remove from favorites" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to favorites" })).toBeTruthy();
  });

  it("passes the domain's name (not the full domain) to onCheckBrandability, along with entry.parts", () => {
    const onCheckBrandability = vi.fn();
    const entries = [makeEntry({ domain: "glowtastic.com", parts: ["glow", "tastic"] })];
    render(
      <ResultsGrid
        entries={entries}
        favoriteDomains={new Set()}
        checkingBrandabilityNames={new Set()}
        brandabilityErrors={{}}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={onCheckBrandability}
        onRegister={() => {}}
      />
    );
    screen.getByRole("button", { name: "Brandability" }).click();
    expect(onCheckBrandability).toHaveBeenCalledWith("glowtastic", ["glow", "tastic"]);
  });

  it("looks up loading/error brandability state by the entry's derived name", () => {
    const entries = [makeEntry({ domain: "glowtastic.com" })];
    render(
      <ResultsGrid
        entries={entries}
        favoriteDomains={new Set()}
        checkingBrandabilityNames={new Set(["glowtastic"])}
        brandabilityErrors={{}}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
      />
    );
    expect(screen.getByText("Checking…")).toBeTruthy();
  });

  it("renders pendingCount dashed placeholder rows after the real cards, with no extra props required", () => {
    const entries = [makeEntry({ id: "1", domain: "glowtastic.com" })];
    const { container } = render(
      <ResultsGrid
        entries={entries}
        favoriteDomains={new Set()}
        checkingBrandabilityNames={new Set()}
        brandabilityErrors={{}}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
        pendingCount={3}
      />
    );
    // 1 real card + 3 pending placeholders = 4 top-level row divs.
    expect(container.firstChild?.childNodes).toHaveLength(4);
  });

  it("wires onSearch/onToggleFavorite/onRegister to the clicked entry", () => {
    const onSearch = vi.fn();
    const onToggleFavorite = vi.fn();
    const onRegister = vi.fn();
    const entries = [makeEntry({ id: "1", domain: "glowtastic.com" })];
    render(
      <ResultsGrid
        entries={entries}
        favoriteDomains={new Set()}
        checkingBrandabilityNames={new Set()}
        brandabilityErrors={{}}
        onSearch={onSearch}
        onToggleFavorite={onToggleFavorite}
        onCheckBrandability={() => {}}
        onRegister={onRegister}
      />
    );
    screen.getByRole("button", { name: "Open a Google search for this name in a new tab" }).click();
    screen.getByRole("button", { name: "Add to favorites" }).click();
    screen.getByRole("button", { name: "Register" }).click();
    expect(onSearch).toHaveBeenCalledWith(entries[0]);
    expect(onToggleFavorite).toHaveBeenCalledWith(entries[0]);
    expect(onRegister).toHaveBeenCalledWith(entries[0]);
  });

  it("omits the Remove button on every card when onRemove isn't passed", () => {
    const entries = [makeEntry({ id: "1", domain: "glowtastic.com" })];
    render(
      <ResultsGrid
        entries={entries}
        favoriteDomains={new Set()}
        checkingBrandabilityNames={new Set()}
        brandabilityErrors={{}}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: "Remove from results" })).toBeNull();
  });

  it("wires onRemove to the clicked entry when passed", () => {
    const onRemove = vi.fn();
    const entries = [makeEntry({ id: "1", domain: "glowtastic.com" })];
    render(
      <ResultsGrid
        entries={entries}
        favoriteDomains={new Set()}
        checkingBrandabilityNames={new Set()}
        brandabilityErrors={{}}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
        onRemove={onRemove}
      />
    );
    screen.getByRole("button", { name: "Remove from results" }).click();
    expect(onRemove).toHaveBeenCalledWith(entries[0]);
  });

  it("defaults pendingCount to 0 — no placeholder rows when omitted", () => {
    const { container } = render(
      <ResultsGrid
        entries={[]}
        favoriteDomains={new Set()}
        checkingBrandabilityNames={new Set()}
        brandabilityErrors={{}}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
      />
    );
    expect(container.firstChild?.childNodes).toHaveLength(0);
  });
});
