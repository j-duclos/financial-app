import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "App.tsx"),
  "utf8"
);
const layoutSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "components/Layout.tsx"),
  "utf8"
);

describe("Spending Limits routing", () => {
  it("registers spending limits page and legacy redirects", () => {
    expect(appSource).toMatch(/spending-goals/);
    expect(appSource).toMatch(/Navigate to="\/spending-goals"/);
    expect(appSource).toMatch(/spending-targets.*Navigate to="\/spending-goals"/s);
  });

  it("shows Spending Limits in navigation", () => {
    expect(layoutSource).toMatch(/Spending Limits/);
    expect(layoutSource).not.toMatch(/label: "Budget"/);
  });
});
