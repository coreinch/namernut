// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Error from "./error";

afterEach(cleanup);

describe("Error", () => {
  it("logs the error to the console on mount", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new globalThis.Error("boom"), { digest: "abc123" });

    render(<Error error={error} retry={() => {}} />);

    expect(consoleError).toHaveBeenCalledWith(error);
    consoleError.mockRestore();
  });

  it("calls retry when the Try again button is clicked", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const error = Object.assign(new globalThis.Error("boom"), { digest: "abc123" });

    render(<Error error={error} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("announces itself to screen readers via role=alert, since it replaces the page with no navigation event", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new globalThis.Error("boom"), { digest: "abc123" });

    render(<Error error={error} retry={() => {}} />);

    expect(screen.getByRole("alert").textContent).toBe("Something went wrong.");
  });
});
