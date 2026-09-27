// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Error from "./error";

afterEach(cleanup);

describe("Error", () => {
  it("logs the error to the console on mount", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new globalThis.Error("boom"), { digest: "abc123" });

    render(<Error error={error} reset={() => {}} />);

    expect(consoleError).toHaveBeenCalledWith(error);
    consoleError.mockRestore();
  });

  it("calls reset when the Try again button is clicked", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const error = Object.assign(new globalThis.Error("boom"), { digest: "abc123" });

    render(<Error error={error} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
