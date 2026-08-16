import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "RecommendationsList.tsx"),
  "utf8"
);

describe("RecommendationsList presentation", () => {
  it("does not render mandatory WHY / WHAT / IMPACT labels", () => {
    expect(source).not.toMatch(/label="Why"/);
    expect(source).not.toMatch(/label="What"/);
    expect(source).not.toMatch(/label="Impact"/);
    expect(source).not.toMatch(/>Why</);
    expect(source).not.toMatch(/>What</);
    expect(source).not.toMatch(/>Impact</);
  });

  it("uses a two-column layout from tablet width and groups by urgency", () => {
    expect(source).toMatch(/md:grid-cols-2/);
    expect(source).toMatch(/group\.label/);
    expect(source).toMatch(/Snooze/);
    expect(source).toMatch(/Dismiss/);
  });

  it("renders survival mode as a compact banner, not a grid card", () => {
    expect(source).toMatch(/function SurvivalModeBanner/);
    expect(source).toMatch(/Review survival plan|recommendationPrimaryCtaLabel/);
    const banner = source.slice(
      source.indexOf("function SurvivalModeBanner"),
      source.indexOf("function RecommendationCard")
    );
    expect(banner).not.toMatch(/Snooze/);
    expect(banner).not.toMatch(/Dismiss/);
  });
});
