// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LiveLogSection } from "./LiveLogSection";
import type { LogEntry } from "@/lib/types";

afterEach(cleanup);

function expandLog() {
  fireEvent.click(screen.getByRole("button", { name: /show activity log/i }));
}

describe("LiveLogSection", () => {
  it("renders nothing when the log is empty, rather than an empty placeholder box", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<LiveLogSection log={[]} logBoxRef={ref} isRunning={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("starts collapsed, showing a toggle rather than the log itself", () => {
    const ref = createRef<HTMLDivElement>();
    const log: LogEntry[] = [{ id: "1", name: "glowtastic.com", status: "available" }];
    render(<LiveLogSection log={log} logBoxRef={ref} isRunning={false} />);
    expect(screen.getByRole("button", { name: "Show activity log (1)" })).toBeTruthy();
    // The panel is present in the DOM (hidden, not unmounted — see the ref
    // test below, which relies on that) but role queries respect the
    // `hidden` attribute the same way assistive tech does, so nothing
    // inside it is exposed until expanded.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("exposes the log as a labeled region once expanded, but NOT as its own role=log live region", () => {
    const ref = createRef<HTMLDivElement>();
    const log: LogEntry[] = [{ id: "1", name: "glowtastic.com", status: "available" }];
    render(<LiveLogSection log={log} logBoxRef={ref} isRunning={false} />);
    expandLog();
    // No role="log" here on purpose — see ANNOUNCE_INTERVAL_MS's comment in
    // LiveLogSection.tsx: a raw per-entry live region would queue up far
    // more announcements than a screen reader user could keep up with
    // during an active search. getByLabelText finds it by its aria-label
    // without asserting any particular role.
    expect(screen.queryByRole("log")).toBeNull();
    expect(screen.getByLabelText("Search activity")).toBeTruthy();
    expect(screen.getByRole("button", { name: /hide activity log/i })).toBeTruthy();
  });

  it("renders every entry's name and status label, in order, once expanded", () => {
    const ref = createRef<HTMLDivElement>();
    const log: LogEntry[] = [
      { id: "1", name: "foo.com", status: "checking" },
      { id: "2", name: "bar.com", status: "taken" },
      { id: "3", name: "baz.com", status: "available" },
    ];
    render(<LiveLogSection log={log} logBoxRef={ref} isRunning={false} />);
    expandLog();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("foo.com");
    expect(items[0].textContent).toContain("checking…");
    expect(items[2].textContent).toContain("baz.com");
    expect(items[2].textContent).toContain("available");
  });

  it("attaches the passed ref to the scrollable log container even while collapsed", () => {
    const ref = createRef<HTMLDivElement>();
    const log: LogEntry[] = [{ id: "1", name: "foo.com", status: "unknown" }];
    render(<LiveLogSection log={log} logBoxRef={ref} isRunning={false} />);
    expect(ref.current).not.toBeNull();
    expandLog();
    expect(ref.current).toBe(screen.getByLabelText("Search activity"));
  });

  describe("the throttled screen-reader announcer", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("only updates the sr-only summary once per ANNOUNCE_INTERVAL_MS while running and expanded, not on every entry", () => {
      const log: LogEntry[] = [{ id: "1", name: "foo.com", status: "checking" }];
      const ref = createRef<HTMLDivElement>();
      const { rerender } = render(<LiveLogSection log={log} logBoxRef={ref} isRunning={true} />);
      fireEvent.click(screen.getByRole("button", { name: /show activity log/i }));

      const live = () => document.querySelector('[aria-live="polite"]')!;
      expect(live().textContent).toBe("foo.com checking…");

      // A second entry arrives well within the throttle window — the
      // sr-only summary must NOT jump to it yet.
      rerender(
        <LiveLogSection
          log={[...log, { id: "2", name: "bar.com", status: "available" }]}
          logBoxRef={ref}
          isRunning={true}
        />
      );
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(live().textContent).toBe("foo.com checking…");

      // Once the interval elapses, it catches up to the latest entry.
      act(() => {
        vi.advanceTimersByTime(3500);
      });
      expect(live().textContent).toBe("bar.com available");
    });

    it("stops updating the announcer once the run ends", () => {
      const log: LogEntry[] = [{ id: "1", name: "foo.com", status: "checking" }];
      const ref = createRef<HTMLDivElement>();
      const { rerender } = render(<LiveLogSection log={log} logBoxRef={ref} isRunning={false} />);
      fireEvent.click(screen.getByRole("button", { name: /show activity log/i }));

      rerender(
        <LiveLogSection
          log={[...log, { id: "2", name: "bar.com", status: "available" }]}
          logBoxRef={ref}
          isRunning={false}
        />
      );
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      // isRunning was never true here, so the announcer effect never even
      // set an initial value — nothing to announce at all.
      expect(document.querySelector('[aria-live="polite"]')).toBeNull();
    });
  });
});
