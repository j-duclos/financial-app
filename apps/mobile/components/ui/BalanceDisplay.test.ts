import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "BalanceDisplay.tsx"), "utf8");

describe("BalanceDisplay metric amounts", () => {
  it("overlays the info button so it cannot squeeze the amount width", () => {
    expect(source).toMatch(/position: "absolute"/);
    expect(source).toMatch(/width: "100%"/);
    expect(source.indexOf("<CurrencyDisplay")).toBeGreaterThan(source.indexOf('name="info-circle"'));
  });

  it("shrinks the amount to one line instead of wrapping the last digit", () => {
    expect(source).toMatch(/numberOfLines=\{1\}/);
    expect(source).toMatch(/adjustsFontSizeToFit/);
    expect(source).toMatch(/minimumFontScale=\{0\.6\}/);
  });
});
