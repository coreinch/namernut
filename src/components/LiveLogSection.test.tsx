// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LiveLogSection } from "./LiveLogSection";
import type { LogEntry } from "@/lib/types";

afterEach(cleanup);

function expandLog() {
  fireEvent.click(screen.getByRole("button", { name: /show activity log/i }));
}

describe("LiveLogSection", () => {
  it("renders nothing when the log is empty, rather than an empty placeholder box", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<LiveLogSection log={[]} logBoxRef={ref} />);
    expect(container.firstChild).toBeNull();
  });

  it("starts collapsed, showing a toggle rather than the log itself", () => {
    const ref = createRef<HTMLDivElement>();
    const log: LogEntry[] = [{ id: "1", name: "glowtastic.com", status: "available" }];
    render(<LiveLogSection log={log} logBoxRef={ref} />);
    expect(screen.getByRole("button", { name: "Show activity log (1)" })).toBeTruthy();
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("exposes the log as a labeled role=log region once expanded", () => {
    const ref = createRef<HTMLDivElement>();
    const log: LogEntry[] = [{ id: "1", name: "glowtastic.com", status: "available" }];
    render(<LiveLogSection log={log} logBoxRef={ref} />);
    expandLog();
    expect(screen.getByRole("log", { name: "Search activity" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /hide activity log/i })).toBeTruthy();
  });

  it("renders every entry's name and status label, in order, once expanded", () => {
    const ref = createRef<HTMLDivElement>();
    const log: LogEntry[] = [
      { id: "1", name: "foo.com", status: "checking" },
      { id: "2", name: "bar.com", status: "taken" },
      { id: "3", name: "baz.com", status: "available" },
    ];
    render(<LiveLogSection log={log} logBoxRef={ref} />);
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
    render(<LiveLogSection log={log} logBoxRef={ref} />);
    expect(ref.current).not.toBeNull();
    expandLog();
    expect(ref.current).toBe(screen.getByRole("log"));
  });
});
