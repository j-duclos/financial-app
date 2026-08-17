import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "GoalDetail.tsx"),
  "utf8"
);

describe("Goal Details page", () => {
  it("shows a compact forecast summary with distinct target and projected dates", () => {
    expect(source).toMatch(/goalForecastSummary/);
    expect(source).toMatch(/goalDetailProgressLine/);
    expect(source).not.toMatch(/label="Completion"/);
    expect(source).not.toMatch(/goalProjectionLine/);
    expect(source).not.toMatch(/goalSuggestionLine/);
    expect(source).not.toMatch(/Current pace is too slow/);
    expect(source).not.toMatch(/pace_warnings/);
  });

  it("uses canonical backend forecast fields for summary, chart, and status", () => {
    expect(source).toMatch(/getBucketDetail/);
    expect(source).toMatch(/\["bucket-detail", goalId, scenarioId\]/);
    expect(source).toMatch(/goal\.monthly_required|goalForecastSummary/);
    expect(source).toMatch(/current_contribution_rate|goalForecastSummary/);
    expect(source).toMatch(/paceStatusLabel\(goal\?\.pace_status\)/);
    expect(source).toMatch(/data!\.forecast_growth/);
    expect(source).toMatch(/targetDate=\{goal\.target_date\}/);
    expect(source).not.toMatch(/getBucketForecast/);
    expect(source).not.toMatch(/updateBucket/);
    expect(source).not.toMatch(/patchBucket/);
  });

  it("moves scenario selection into the header and does not mutate the real goal", () => {
    expect(source).toMatch(/>Scenario</);
    expect(source).toMatch(/Current plan \(no scenario\)/);
    expect(source).toMatch(/scenario: scenarioId === "" \? undefined : Number\(scenarioId\)/);
    expect(source).not.toMatch(/Scenario impact/i);
    expect(source).not.toMatch(/forecast_scenarios/);
    expect(source).not.toMatch(/scenario_projection/);
  });

  it("keeps funding, history, chart, and primary actions without Quick Forecast", () => {
    expect(source).toMatch(/Funding account/);
    expect(source).toMatch(/Automatic funding/);
    expect(source).not.toMatch(/>Transfers</);
    expect(source).toMatch(/Contribution history/);
    expect(source).toMatch(/Forecasted growth/);
    expect(source).toMatch(/Edit goal/);
    expect(source).toMatch(/\/goals\?edit=\$\{goal\.id\}/);
    expect(source).toMatch(/Try in What-If/);
    expect(source).toMatch(/whatIfGoalPath/);
    expect(source).not.toMatch(/ForecastModal/);
    expect(source).not.toMatch(/Quick [Ff]orecast/);
    expect(source).not.toMatch(/Open full goal details/);
  });
});
