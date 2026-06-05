import { describe, expect, it } from "vitest";
import type { DashboardInsight } from "@budget-app/shared";
import {
  insightActionLabel,
  insightActionState,
  insightsEmptyMessage,
  insightsEmptySubtext,
} from "./insightDisplay";

describe("insightDisplay", () => {
  it("empty state copy", () => {
    expect(insightsEmptyMessage()).toMatch(/no urgent insights/i);
    expect(insightsEmptySubtext()).toMatch(/stable/i);
  });

  it("parses account id from action url", () => {
    expect(insightActionState("/accounts?account=42")).toEqual({ accountId: 42 });
    expect(insightActionState("/timeline")).toBeUndefined();
  });

  it("renames legacy timeline labels to open calendar", () => {
    expect(insightActionLabel("View timeline")).toBe("Open calendar");
    expect(insightActionLabel("View calendar")).toBe("Open calendar");
    expect(insightActionLabel("Calendar")).toBe("Open calendar");
    expect(insightActionLabel(null)).toBeNull();
  });
});
