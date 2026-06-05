import { describe, expect, it } from "vitest";
import {
  normalizeSeverity,
  severityLabel,
  severityRank,
  severityShowsAlert,
  severityTokens,
} from "./severity";

describe("severity", () => {
  it("normalizes backend and UI aliases", () => {
    expect(normalizeSeverity("critical")).toBe("critical");
    expect(normalizeSeverity("dangerous")).toBe("critical");
    expect(normalizeSeverity("risk")).toBe("at_risk");
    expect(normalizeSeverity("warning")).toBe("at_risk");
    expect(normalizeSeverity("tight")).toBe("at_risk");
    expect(normalizeSeverity("watch")).toBe("watch");
    expect(normalizeSeverity("info")).toBe("watch");
    expect(normalizeSeverity("healthy")).toBe("healthy");
    expect(normalizeSeverity("positive")).toBe("healthy");
  });

  it("orders by urgency", () => {
    expect(severityRank("critical")).toBeLessThan(severityRank("at_risk"));
    expect(severityRank("at_risk")).toBeLessThan(severityRank("watch"));
    expect(severityRank("watch")).toBeLessThan(severityRank("healthy"));
  });

  it("hides healthy from alerts", () => {
    expect(severityShowsAlert("healthy")).toBe(false);
    expect(severityShowsAlert("critical")).toBe(true);
  });

  it("uses unified labels", () => {
    expect(severityLabel("at_risk")).toBe("At Risk");
    expect(severityTokens("dangerous").label).toBe("Critical");
    expect(severityTokens("warning").badgeClass).toContain("amber");
    expect(severityTokens("critical").cardClass).toContain("red");
  });
});
