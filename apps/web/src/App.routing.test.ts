import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");
const layoutSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "components/Layout.tsx"),
  "utf8"
);
const navSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "lib/appNavigation.ts"),
  "utf8"
);

describe("Budget routing", () => {
  it("registers budget page and legacy redirects", () => {
    expect(appSource).toMatch(/spending-goals/);
    expect(appSource).toMatch(/Navigate to="\/spending-goals"/);
    expect(appSource).toMatch(/spending-targets.*Navigate to="\/spending-goals"/s);
    expect(appSource).toMatch(/budget.*Navigate to="\/spending-goals"/s);
  });

  it("shows Budget in primary navigation instead of Spending Limits", () => {
    expect(navSource).toMatch(/label: "Budget"/);
    expect(navSource).not.toMatch(/Spending Limits/);
    expect(layoutSource).toMatch(/AppNav/);
  });
});

describe("Primary navigation structure", () => {
  it("keeps underlying planning and more routes registered", () => {
    expect(appSource).toMatch(/path="goals"/);
    expect(appSource).toMatch(/path="credit-cards"/);
    expect(appSource).toMatch(/path="scenarios"/);
    expect(appSource).toMatch(/path="recurring"/);
    expect(appSource).toMatch(/path="automation"/);
    expect(appSource).toMatch(/path="reconcile"/);
    expect(appSource).toMatch(/path="categories"/);
    expect(appSource).toMatch(/path="profile"/);
  });
});
