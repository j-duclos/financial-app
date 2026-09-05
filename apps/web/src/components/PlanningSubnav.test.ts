import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "PlanningSubnav.tsx"),
  "utf8"
);

describe("PlanningSubnav", () => {
  it("renders Planning links from the shared nav config with DTI hint", () => {
    expect(source).toMatch(/PLANNING_NAV_LINKS/);
    expect(source).toMatch(/pathMatchesNavLink/);
    expect(source).toMatch(/"\/debt-to-income": "How much of my gross income is committed to debt\?"/);
  });
});
