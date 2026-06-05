import { describe, expect, it } from "vitest";
import { AUTOMATION_NAV_LABEL, AUTOMATION_PATH } from "./automationDisplay";

describe("automationDisplay", () => {
  it("exposes nav label and path", () => {
    expect(AUTOMATION_NAV_LABEL).toBe("Automation");
    expect(AUTOMATION_PATH).toBe("/automation");
  });
});
