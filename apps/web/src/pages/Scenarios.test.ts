import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scenariosSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Scenarios.tsx"),
  "utf8"
);

describe("What-If context from Planning", () => {
  it("reads optional goal and debt query params without persisting on open", () => {
    expect(scenariosSource).toMatch(/parsePositiveIntParam\(searchParams.get\("goal"\)\)/);
    expect(scenariosSource).toMatch(/parsePositiveIntParam\(searchParams.get\("debt"\)\)/);
    expect(scenariosSource).toMatch(/initialDebtAccountId=\{contextDebtId\}/);
    expect(scenariosSource).toMatch(/nothing is saved/);
    expect(scenariosSource).toMatch(/Model payoff change/);
  });
});
