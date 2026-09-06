import { describe, expect, it } from "vitest";
import {
  isForecastReadyFromSetup,
  isMissingAccounts,
  shouldShowDashboardSetup,
  shouldShowOnboardingWelcome,
  type OnboardingStatus,
} from "./onboarding";

function status(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  const steps = {
    account: false,
    transaction: false,
    recurring: false,
    forecast_ready: false,
    ...overrides.steps,
  };
  return {
    completed: false,
    dismissed: false,
    show_welcome: true,
    progress: { completed_steps: 0, total_steps: 4 },
    ...overrides,
    steps,
  };
}

describe("onboarding helpers", () => {
  it("treats account plus transaction or recurring as forecast-ready", () => {
    expect(
      isForecastReadyFromSetup({ account: true, transaction: true, recurring: false })
    ).toBe(true);
    expect(
      isForecastReadyFromSetup({ account: true, transaction: false, recurring: true })
    ).toBe(true);
    expect(
      isForecastReadyFromSetup({ account: true, transaction: false, recurring: false })
    ).toBe(false);
    expect(
      isForecastReadyFromSetup({ account: false, transaction: true, recurring: true })
    ).toBe(false);
  });

  it("does not treat a missing status or a $0 account as missing accounts", () => {
    expect(isMissingAccounts(undefined)).toBe(false);
    expect(isMissingAccounts(status({ steps: { account: true, transaction: false, recurring: false, forecast_ready: false } }))).toBe(
      false
    );
    expect(isMissingAccounts(status())).toBe(true);
  });

  it("hides welcome for completed, dismissed, or forecast-ready users", () => {
    expect(shouldShowOnboardingWelcome(status({ show_welcome: true }))).toBe(true);
    expect(shouldShowOnboardingWelcome(status({ show_welcome: false }))).toBe(false);
    expect(shouldShowOnboardingWelcome(undefined)).toBe(false);
  });

  it("hides dashboard setup after dismiss, complete, or forecast-ready", () => {
    expect(shouldShowDashboardSetup(status())).toBe(true);
    expect(shouldShowDashboardSetup(status({ dismissed: true }))).toBe(false);
    expect(shouldShowDashboardSetup(status({ completed: true }))).toBe(false);
    expect(
      shouldShowDashboardSetup(
        status({
          steps: { account: true, transaction: true, recurring: false, forecast_ready: true },
        })
      )
    ).toBe(false);
  });
});
