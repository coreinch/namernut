// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ResultCard, type BrandabilityDisplay } from "./ResultCard";
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

const idleBrandability: BrandabilityDisplay = {
  score: undefined,
  summary: undefined,
  loading: false,
  error: undefined,
};

describe("ResultCard", () => {
  it("splits the domain into name and tld for display", () => {
    render(
      <ResultCard
        entry={makeEntry({ domain: "glowtastic.io" })}
        favorited={false}
        brandability={idleBrandability}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
      />
    );
    expect(screen.getByText("glowtastic")).toBeTruthy();
    expect(screen.getByText(".io")).toBeTruthy();
  });

  it("shows the star as pressed/filled when favorited, hollow otherwise", () => {
    const { rerender } = render(
      <ResultCard
        entry={makeEntry()}
        favorited={false}
        brandability={idleBrandability}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Add to favorites" }).textContent).toBe("☆");
    rerender(
      <ResultCard
        entry={makeEntry()}
        favorited={true}
        brandability={idleBrandability}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Remove from favorites" }).textContent).toBe("★");
  });

  it("calls onToggleFavorite, onSearch, and onRegister when their respective buttons are clicked", () => {
    const onToggleFavorite = vi.fn();
    const onSearch = vi.fn();
    const onRegister = vi.fn();
    render(
      <ResultCard
        entry={makeEntry()}
        favorited={false}
        brandability={idleBrandability}
        onSearch={onSearch}
        onToggleFavorite={onToggleFavorite}
        onCheckBrandability={() => {}}
        onRegister={onRegister}
      />
    );
    screen.getByRole("button", { name: "Add to favorites" }).click();
    screen.getByRole("button", { name: "Open a Google search for this name in a new tab" }).click();
    screen.getByRole("button", { name: "Register" }).click();
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  it("renders no Remove button when onRemove is omitted", () => {
    render(
      <ResultCard
        entry={makeEntry()}
        favorited={false}
        brandability={idleBrandability}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: "Remove from results" })).toBeNull();
  });

  it("calls onRemove when the Remove button is clicked", () => {
    const onRemove = vi.fn();
    render(
      <ResultCard
        entry={makeEntry()}
        favorited={false}
        brandability={idleBrandability}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
        onRemove={onRemove}
      />
    );
    screen.getByRole("button", { name: "Remove from results" }).click();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the next card's Remove button after this card unmounts, instead of dropping it to <body>", async () => {
    // A minimal stand-in for ResultsGrid: two sibling cards, with state that
    // actually drops the removed one on click — the DOM-sibling-based focus
    // handoff in ResultCard only makes sense with real siblings and a real
    // unmount, which a single-card render (the test above) can't exercise.
    function TwoCards() {
      const [entries, setEntries] = useState([makeEntry({ id: "1", domain: "first.com" }), makeEntry({ id: "2", domain: "second.com" })]);
      return (
        <>
          {entries.map((entry) => (
            <ResultCard
              key={entry.id}
              entry={entry}
              favorited={false}
              brandability={idleBrandability}
              onSearch={() => {}}
              onToggleFavorite={() => {}}
              onCheckBrandability={() => {}}
              onRegister={() => {}}
              onRemove={() => setEntries((prev) => prev.filter((e) => e.id !== entry.id))}
            />
          ))}
        </>
      );
    }
    render(<TwoCards />);
    const removeButtons = screen.getAllByRole("button", { name: "Remove from results" });
    removeButtons[0].focus();
    removeButtons[0].click();
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Remove from results" })).toHaveLength(1);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove from results" }));
    });
  });

  it("moves focus to the next card's favorite toggle when un-favoriting unmounts this card (the Favorites tab)", async () => {
    // Mirrors page.tsx's Favorites tab: entries ARE the favorites array
    // itself, so toggling one off removes it from the list the same way
    // onRemove does above — unlike the Current/Archive tabs, where the same
    // toggle only flips the star in place (see the next test).
    function TwoFavorites() {
      const [favorites, setFavorites] = useState([makeEntry({ id: "1", domain: "first.com" }), makeEntry({ id: "2", domain: "second.com" })]);
      return (
        <>
          {favorites.map((entry) => (
            <ResultCard
              key={entry.id}
              entry={entry}
              favorited={true}
              brandability={idleBrandability}
              onSearch={() => {}}
              onToggleFavorite={() => setFavorites((prev) => prev.filter((e) => e.id !== entry.id))}
              onCheckBrandability={() => {}}
              onRegister={() => {}}
            />
          ))}
        </>
      );
    }
    render(<TwoFavorites />);
    const unfavoriteButtons = screen.getAllByRole("button", { name: "Remove from favorites" });
    unfavoriteButtons[0].focus();
    unfavoriteButtons[0].click();
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Remove from favorites" })).toHaveLength(1);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove from favorites" }));
    });
  });

  it("leaves focus on the favorite toggle itself when toggling doesn't unmount the card (Current/Archive tabs)", async () => {
    const onToggleFavorite = vi.fn();
    render(
      <ResultCard
        entry={makeEntry()}
        favorited={false}
        brandability={idleBrandability}
        onSearch={() => {}}
        onToggleFavorite={onToggleFavorite}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
      />
    );
    const favoriteButton = screen.getByRole("button", { name: "Add to favorites" });
    favoriteButton.focus();
    favoriteButton.click();
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    // No unmount happens in this test (the card stays put, same as the real
    // Current/Archive tabs when the parent's onToggleFavorite doesn't
    // remove the entry) — focus must stay exactly where it was rather than
    // being redirected preemptively.
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.activeElement).toBe(favoriteButton);
  });

  it("only renders a social badge for a platform whose status is exactly 'taken'", () => {
    render(
      <ResultCard
        entry={makeEntry({
          instagram: "taken",
          github: "available",
          tiktok: "unknown",
          npm: "taken",
          youtube: "available",
          twitter: "unknown",
        })}
        favorited={false}
        brandability={idleBrandability}
        onSearch={() => {}}
        onToggleFavorite={() => {}}
        onCheckBrandability={() => {}}
        onRegister={() => {}}
      />
    );
    expect(screen.getByText("IG taken")).toBeTruthy();
    expect(screen.queryByText("GH taken")).toBeNull();
    expect(screen.queryByText("TT taken")).toBeNull();
    expect(screen.getByText("npm taken")).toBeTruthy();
    expect(screen.queryByText("YT taken")).toBeNull();
    expect(screen.queryByText("X taken")).toBeNull();
  });

  describe("BrandabilityBadge", () => {
    it("shows a Brandability button to trigger the check when unscored", () => {
      const onCheckBrandability = vi.fn();
      render(
        <ResultCard
          entry={makeEntry()}
          favorited={false}
          brandability={idleBrandability}
          onSearch={() => {}}
          onToggleFavorite={() => {}}
          onCheckBrandability={onCheckBrandability}
          onRegister={() => {}}
        />
      );
      screen.getByRole("button", { name: "Brandability" }).click();
      expect(onCheckBrandability).toHaveBeenCalledTimes(1);
    });

    it("shows a loading indicator while checking, with no clickable action", () => {
      render(
        <ResultCard
          entry={makeEntry()}
          favorited={false}
          brandability={{ ...idleBrandability, loading: true }}
          onSearch={() => {}}
          onToggleFavorite={() => {}}
          onCheckBrandability={() => {}}
          onRegister={() => {}}
        />
      );
      expect(screen.getByText("Checking…")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Brandability" })).toBeNull();
    });

    it("shows the error and a Retry button that re-invokes onCheckBrandability", () => {
      const onCheckBrandability = vi.fn();
      render(
        <ResultCard
          entry={makeEntry()}
          favorited={false}
          brandability={{ ...idleBrandability, error: "Service unavailable" }}
          onSearch={() => {}}
          onToggleFavorite={() => {}}
          onCheckBrandability={onCheckBrandability}
          onRegister={() => {}}
        />
      );
      expect(screen.getByText("Service unavailable")).toBeTruthy();
      screen.getByRole("button", { name: "Retry" }).click();
      expect(onCheckBrandability).toHaveBeenCalledTimes(1);
    });

    it("shows the score as a percentage with an accessible label, plus a Rescore button", () => {
      const onCheckBrandability = vi.fn();
      render(
        <ResultCard
          entry={makeEntry()}
          favorited={false}
          brandability={{ ...idleBrandability, score: 87, summary: "Strong, unique." }}
          onSearch={() => {}}
          onToggleFavorite={() => {}}
          onCheckBrandability={onCheckBrandability}
          onRegister={() => {}}
        />
      );
      expect(screen.getByLabelText("87% brandable")).toBeTruthy();
      expect(screen.getByText("Strong, unique.")).toBeTruthy();
      screen.getByRole("button", { name: "Rescore" }).click();
      expect(onCheckBrandability).toHaveBeenCalledTimes(1);
    });

    it("colors a saturated (0-19) score red, distinct from a merely crowded (20-39) one", () => {
      const { rerender } = render(
        <ResultCard
          entry={makeEntry()}
          favorited={false}
          brandability={{ ...idleBrandability, score: 10, summary: "Direct collision." }}
          onSearch={() => {}}
          onToggleFavorite={() => {}}
          onCheckBrandability={() => {}}
          onRegister={() => {}}
        />
      );
      expect(screen.getByLabelText("10% brandable").className).toContain("text-red-700");

      rerender(
        <ResultCard
          entry={makeEntry()}
          favorited={false}
          brandability={{ ...idleBrandability, score: 30, summary: "Crowded space." }}
          onSearch={() => {}}
          onToggleFavorite={() => {}}
          onCheckBrandability={() => {}}
          onRegister={() => {}}
        />
      );
      expect(screen.getByLabelText("30% brandable").className).toContain("text-orange-700");
    });
  });
});
