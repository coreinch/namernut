// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LogDot, LOG_STATUS_LABEL } from "./LogDot";
import type { LogStatus } from "@/lib/types";

afterEach(cleanup);

describe("LogDot", () => {
  it("pulses (animate-pulse) while checking, and does not once resolved", () => {
    const { container: checking } = render(<LogDot status="checking" />);
    expect(checking.querySelector("span")?.className).toContain("animate-pulse");

    const { container: available } = render(<LogDot status="available" />);
    expect(available.querySelector("span")?.className).not.toContain("animate-pulse");
  });

  it("uses the accent color only for the one positive outcome, available", () => {
    const { container } = render(<LogDot status="available" />);
    expect(container.querySelector("span")?.className).toContain("bg-accent");
  });

  it("renders every non-available, non-checking status in the same neutral gray — told apart only by the status label, not hue", () => {
    const neutralStatuses: LogStatus[] = ["taken", "unknown", "filtered"];
    for (const status of neutralStatuses) {
      const { container } = render(<LogDot status={status} />);
      const span = container.querySelector("span");
      expect(span?.className).not.toContain("bg-accent");
      expect(span?.className).not.toContain("animate-pulse");
    }
  });

  it("LOG_STATUS_LABEL has a distinct, human-readable label for every LogStatus", () => {
    const statuses: LogStatus[] = ["checking", "taken", "unknown", "available", "filtered"];
    const labels = statuses.map((s) => LOG_STATUS_LABEL[s]);
    expect(new Set(labels).size).toBe(statuses.length);
  });
});
