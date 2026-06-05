import { describe, expect, it } from "vitest";
import {
  attentionItemsLimited,
  dashboardUsesTableForAttention,
  upcomingKindBadgeClass,
  upcomingKindLabel,
} from "./dashboardUtils";

describe("dashboardUtils", () => {
  it("limits attention items to top 3", () => {
    const items = [1, 2, 3, 4, 5];
    expect(attentionItemsLimited(items)).toEqual([1, 2, 3]);
    expect(attentionItemsLimited(items, 2)).toEqual([1, 2]);
    expect(attentionItemsLimited(items).length).toBeLessThanOrEqual(3);
  });

  it("does not use table layout for attention", () => {
    expect(dashboardUsesTableForAttention(5)).toBe(false);
  });

  it("labels upcoming kinds", () => {
    expect(upcomingKindLabel("income")).toBe("Income");
    expect(upcomingKindLabel("risk")).toBe("Risk");
  });

  it("styles upcoming kind badges", () => {
    expect(upcomingKindBadgeClass("risk")).toContain("red");
    expect(upcomingKindBadgeClass("income")).toContain("green");
  });
});
