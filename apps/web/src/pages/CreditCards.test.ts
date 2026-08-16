import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "CreditCards.tsx"), "utf8");

describe("Payment Planner URL mode", () => {
  it("initializes payoff mode from the mode query param for survival-plan deep links", () => {
    expect(source).toMatch(/parseDebtModeParam/);
    expect(source).toMatch(/searchParams\.get\("mode"\)/);
  });
});
