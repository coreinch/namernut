// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Footer } from "./Footer";

afterEach(cleanup);

describe("Footer", () => {
  it("renders nothing while no search is running", () => {
    const { container } = render(<Footer isRunning={false} statusText="12 checked this search" onStop={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the live statusText in the visible (aria-hidden) status span while running", () => {
    render(<Footer isRunning={true} statusText="12 checked this search" onStop={() => {}} />);
    // Both the visible aria-hidden span and the sr-only aria-live span start
    // out showing the same text (the announcer's initial state mirrors the
    // prop immediately) — query the visible one specifically rather than by
    // text, which would otherwise match both.
    const visible = document.querySelector('[aria-hidden="true"]');
    expect(visible?.textContent).toBe("12 checked this search");
  });

  it("calls onStop when the Stop button is clicked", () => {
    const onStop = vi.fn();
    render(<Footer isRunning={true} statusText="12 checked this search" onStop={onStop} />);
    screen.getByRole("button", { name: "Stop" }).click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  describe("throttled aria-live announcer", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("announces the initial statusText as soon as a run starts", () => {
      render(<Footer isRunning={true} statusText="1 checked this search" onStop={() => {}} />);
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent).toBe("1 checked this search");
    });

    it("does not update the announced text until 4 seconds have passed, even if statusText changes sooner", () => {
      const { rerender } = render(
        <Footer isRunning={true} statusText="1 checked this search" onStop={() => {}} />
      );
      rerender(<Footer isRunning={true} statusText="50 checked this search" onStop={() => {}} />);
      const live = document.querySelector('[aria-live="polite"]');
      // Still the value from when the 4s interval last sampled it (at mount),
      // not the just-rerendered prop — the whole point of the throttle.
      expect(live?.textContent).toBe("1 checked this search");
    });

    it("updates the announced text to the latest statusText once 4 seconds elapse", () => {
      const { rerender } = render(
        <Footer isRunning={true} statusText="1 checked this search" onStop={() => {}} />
      );
      rerender(<Footer isRunning={true} statusText="50 checked this search" onStop={() => {}} />);
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent).toBe("50 checked this search");
    });

    it("stops announcing once the run is no longer active (component unmounts and renders nothing)", () => {
      const { rerender, container } = render(
        <Footer isRunning={true} statusText="1 checked this search" onStop={() => {}} />
      );
      rerender(<Footer isRunning={false} statusText="1 checked this search" onStop={() => {}} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
