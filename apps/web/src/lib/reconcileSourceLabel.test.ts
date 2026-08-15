import { describe, expect, it } from "vitest";
import { reconcileSourceTooltip } from "./reconcileSourceLabel";

describe("reconcileSourceTooltip", () => {
  it("labels manual and imported sources from known data", () => {
    expect(reconcileSourceTooltip("ACTUAL")).toBe("Manual transaction");
    expect(reconcileSourceTooltip("PLAID")).toBe("Imported transaction");
    expect(reconcileSourceTooltip("PLAID", "Chase")).toBe("Imported from Chase via Plaid");
    expect(reconcileSourceTooltip("RULE")).toBe("Scheduled automation");
    expect(reconcileSourceTooltip("ONE_TIME")).toBe("Scheduled automation");
    expect(reconcileSourceTooltip("INTEREST")).toBe("Interest charge");
    expect(reconcileSourceTooltip("SYSTEM")).toBe("System transaction");
  });

  it("does not invent an institution when the account has none", () => {
    expect(reconcileSourceTooltip("PLAID", "  ")).toBe("Imported transaction");
    expect(reconcileSourceTooltip("PLAID", null)).toBe("Imported transaction");
  });
});
