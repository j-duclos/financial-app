import { describe, expect, it } from "vitest";
import {
  dashboardDetailsSectionState,
  isDashboardAttentionLoading,
} from "./dashboardSectionState";

describe("dashboardDetailsSectionState", () => {
  it("returns loading while details is unresolved", () => {
    expect(
      dashboardDetailsSectionState({
        details: undefined,
        detailsError: false,
        fastError: false,
        isEmpty: true,
      })
    ).toBe("loading");
  });

  it("does not treat unresolved details as empty", () => {
    const state = dashboardDetailsSectionState({
      details: undefined,
      detailsError: false,
      fastError: false,
      isEmpty: true,
    });
    expect(state).not.toBe("empty");
  });

  it("returns empty only after details succeeded with no items", () => {
    expect(
      dashboardDetailsSectionState({
        details: { upcoming_groups: [] },
        detailsError: false,
        fastError: false,
        isEmpty: true,
      })
    ).toBe("empty");
  });

  it("returns data when details succeeded with items", () => {
    expect(
      dashboardDetailsSectionState({
        details: { goals: [{ id: 1 }] },
        detailsError: false,
        fastError: false,
        isEmpty: false,
      })
    ).toBe("data");
  });

  it("returns error when details query failed", () => {
    expect(
      dashboardDetailsSectionState({
        details: undefined,
        detailsError: true,
        fastError: false,
        isEmpty: true,
      })
    ).toBe("error");
  });

  it("hides section when summary-fast failed before details ran", () => {
    expect(
      dashboardDetailsSectionState({
        details: undefined,
        detailsError: false,
        fastError: true,
        isEmpty: true,
      })
    ).toBe("hidden");
  });
});

describe("isDashboardAttentionLoading", () => {
  it("is loading before summary-fast resolves", () => {
    expect(
      isDashboardAttentionLoading({
        summaryFast: undefined,
        fastError: false,
        fastSuccess: false,
      })
    ).toBe(true);
  });

  it("is not loading once summary-fast data exists", () => {
    expect(
      isDashboardAttentionLoading({
        summaryFast: { attention: [] },
        fastError: false,
        fastSuccess: true,
      })
    ).toBe(false);
  });
});
