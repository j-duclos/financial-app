import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE_TEMPLATES,
  SCENARIO_TEMPLATES,
  templateByKey,
  horizonMonthsToParam,
} from "./scenarioTemplates";

describe("scenarioTemplates", () => {
  it("includes all template cards for empty state", () => {
    const keys = EMPTY_STATE_TEMPLATES.map((t) => t.key);
    expect(keys).toContain("buy_house");
    expect(keys).toContain("lose_job");
    expect(keys).toContain("raise_income");
    expect(keys).toContain("pay_off_debt");
  });

  it("resolves template by key", () => {
    expect(templateByKey("raise_income").label).toBe("Raise income");
  });

  it("maps horizon months to API param", () => {
    expect(horizonMonthsToParam(12)).toBe("12m");
    expect(horizonMonthsToParam(6)).toBe("6m");
    expect(horizonMonthsToParam(24)).toBe("24m");
  });

  it("has blank and custom templates", () => {
    expect(SCENARIO_TEMPLATES.some((t) => t.key === "blank")).toBe(true);
    expect(SCENARIO_TEMPLATES.some((t) => t.key === "custom")).toBe(true);
  });
});
