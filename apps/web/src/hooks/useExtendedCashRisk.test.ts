import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useExtendedCashRisk.ts"),
  "utf8"
);

describe("useExtendedCashRisk", () => {
  it("uses a shared query key that does not include Forecast Window days", () => {
    expect(source).toMatch(/\["extended-cash-risk"\]/);
    expect(source).toMatch(/getExtendedCashRisk/);
    expect(source).not.toMatch(/forecastDays/);
    expect(source).not.toMatch(/forecast_days/);
  });
});
