// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LiveLogSection } from "./LiveLogSection";
import type { LogEntry } from "@/lib/types";

afterEach(cleanup);

describe("LiveLogSection", () => {
  it("renders nothing when the log is empty, rather than an empty placeholder box", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<LiveLogSection log={[]} logBoxRef={ref} />);
    expect(container.firstChild).toBeNull();
  });

  it("exposes the log as a labeled role=log region once entries exist", () => {
    const ref = createRef<HTMLDivElement>();
    const log: LogEntry[] = [{ id: "1", name: "glowtastic.com", status: "available" }];
    render(<LiveLogSection log={log} logBoxRef={ref} />);
    expect(screen.getByRole("log", { name: "Search activity" })).toBeTruthy();
  });

  it("renders every entry's name and status label, in order", () => {
    const ref = createRef<HTMLDivElement>();
    const log: LogEntry[] = [
      { id: "1", name: "foo.com", status: "checking" },
      { id: "2", name: "bar.com", status: "taken" },
      { id: "3", name: "baz.com", status: "available" },
    ];
    render(<LiveLogSection log={log} logBoxRef={ref} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("foo.com");
    expect(items[0].textContent).toContain("checking…");
    expect(items[2].textContent).toContain("baz.com");
    expect(items[2].textContent).toContain("available");
  });

  it("attaches the passed ref to the scrollable log container", () => {
    const ref = createRef<HTMLDivElement>();
    const log: LogEntry[] = [{ id: "1", name: "foo.com", status: "unknown" }];
    render(<LiveLogSection log={log} logBoxRef={ref} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBe(screen.getByRole("log"));
  });
});
