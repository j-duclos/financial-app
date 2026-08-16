import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const actionCenterSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ActionCenter.tsx"),
  "utf8"
);

describe("Action Center page structure", () => {
  it("adds a Forecast Window selector and keys recommendations by the selected days", () => {
    expect(actionCenterSource).toMatch(/usePageForecastWindow/);
    expect(actionCenterSource).toMatch(/ForecastWindowSelect/);
    expect(actionCenterSource).toMatch(/\["recommendations", "action-center", forecastDays\]/);
    expect(actionCenterSource).toMatch(/getRecommendations\(\{ days: forecastDays \}\)/);
    expect(actionCenterSource).toMatch(/forecastDays=\{forecastDays\}/);
    expect(actionCenterSource).not.toMatch(/updateProfile/);
    expect(actionCenterSource).not.toMatch(/DEFAULT_PASSIVE_FORECAST_DAYS/);
  });
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

  it("preserves snooze and dismiss wiring for normal recommendations, not survival", () => {
    expect(actionCenterSource).toMatch(/snoozeRecommendation/);
    expect(actionCenterSource).toMatch(/dismissRecommendation/);
    expect(actionCenterSource).toMatch(/unsnoozeRecommendation/);
    expect(actionCenterSource).toMatch(/restoreRecommendation/);
    const bannerCall = actionCenterSource.slice(
      actionCenterSource.indexOf("{view.survival &&"),
      actionCenterSource.indexOf("RecommendationsList")
    );
    expect(bannerCall).not.toMatch(/onSnooze/);
    expect(bannerCall).not.toMatch(/onDismiss/);
  });
});
