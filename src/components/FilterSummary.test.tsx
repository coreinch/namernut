// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FilterSummary, totalFiltered } from "./FilterSummary";

afterEach(cleanup);

describe("FilterSummary", () => {
  it("renders nothing when no candidate was filtered", () => {
    const { container } = render(<FilterSummary counts={{}} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists non-zero reasons behind a collapsed toggle", () => {
    render(<FilterSummary counts={{ typo: 3, instagram: 2 }} />);
    const toggle = screen.getByRole("button", { name: /why names were filtered out \(5\)/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Looked like a typo of a common word")).toBeTruthy();
    expect(screen.getByText("Instagram handle taken or unchecked")).toBeTruthy();
    expect(screen.queryByText("Hard to pronounce")).toBeNull();
  });

  it("totals every reason", () => {
    expect(totalFiltered({ tooLong: 1, npm: 4 })).toBe(5);
  });
});
