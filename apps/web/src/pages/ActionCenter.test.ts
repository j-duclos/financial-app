import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const actionCenterSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ActionCenter.tsx"),
  "utf8"
);

describe("Action Center page structure", () => {
  it("loads recommendations from the dedicated endpoint, not the full dashboard summary", () => {
    expect(actionCenterSource).toMatch(/getRecommendations/);
    expect(actionCenterSource).not.toMatch(/getDashboardSummary/);
    expect(actionCenterSource).not.toMatch(/getDashboardSummaryFast/);
    expect(actionCenterSource).not.toMatch(/getDashboardDetails/);
  });

  it("keeps a lightweight accounts list for transfer and resolve-risk actions", () => {
    expect(actionCenterSource).toMatch(/listAccounts/);
  });

  it("builds grouped view from the same recommendation collection", () => {
    expect(actionCenterSource).toMatch(/buildActionCenterView/);
    expect(actionCenterSource).toMatch(/SurvivalModeBanner/);
    expect(actionCenterSource).toMatch(/view\.summaryText/);
    expect(actionCenterSource).toMatch(/view\.groups/);
    expect(actionCenterSource).not.toMatch(/activeCount/);
  });

  it("preserves snooze and dismiss wiring", () => {
    expect(actionCenterSource).toMatch(/snoozeRecommendation/);
    expect(actionCenterSource).toMatch(/dismissRecommendation/);
    expect(actionCenterSource).toMatch(/unsnoozeRecommendation/);
    expect(actionCenterSource).toMatch(/restoreRecommendation/);
  });
});
