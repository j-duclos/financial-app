import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

describe("shared billing and onboarding query keys", () => {
  it("reuses the web billing-status key", () => {
    const source = readFileSync(join(dir, "useBillingStatus.ts"), "utf8");
    expect(source).toMatch(/BILLING_STATUS_QUERY_KEY/);
    expect(source).toMatch(/getBillingStatus/);
    expect(readFileSync(join(dir, "../lib/billing.ts"), "utf8")).toMatch(
      /\["billing-status"\]/
    );
  });

  it("reuses the web onboarding status key", () => {
    const source = readFileSync(join(dir, "useOnboardingStatus.ts"), "utf8");
    expect(source).toMatch(/ONBOARDING_STATUS_QUERY_KEY/);
    expect(source).toMatch(/getOnboardingStatus/);
    expect(readFileSync(join(dir, "../lib/billing.ts"), "utf8")).toMatch(
      /\["onboarding", "status"\]/
    );
  });
});
