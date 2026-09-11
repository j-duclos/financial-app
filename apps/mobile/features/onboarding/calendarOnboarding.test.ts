import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GETTING_STARTED_COPY,
  shouldShowCalendarIntro,
  shouldShowCalendarOnboardingHandoff,
} from "@budget-app/shared";
import {
  CALENDAR_ONBOARDING_SOURCE,
  GETTING_STARTED_EXPLORE_ROUTE,
  GETTING_STARTED_HOME_ROUTE,
  GETTING_STARTED_ROUTES,
  calendarSheetAfterIntroDismiss,
  initialCalendarOnboardingSheet,
  isCalendarOnboardingSource,
} from "./gettingStartedRoutes";

const dir = dirname(fileURLToPath(import.meta.url));
const calendarSource = readFileSync(join(dir, "../calendar/CalendarScreen.tsx"), "utf8");
const dashboardSource = readFileSync(join(dir, "../dashboard/DashboardScreen.tsx"), "utf8");
const hookSource = readFileSync(join(dir, "useGettingStartedEducation.ts"), "utf8");

describe("calendar onboarding context", () => {
  it("passes source=onboarding from Getting Started and the View calendar CTA", () => {
    expect(GETTING_STARTED_ROUTES.calendar).toContain(`source=${CALENDAR_ONBOARDING_SOURCE}`);
    expect(dashboardSource).toMatch(/GETTING_STARTED_ROUTES\.calendar/);
    expect(isCalendarOnboardingSource("onboarding")).toBe(true);
    expect(isCalendarOnboardingSource(["onboarding"])).toBe(true);
    expect(isCalendarOnboardingSource(undefined)).toBe(false);
    expect(isCalendarOnboardingSource("")).toBe(false);
    expect(calendarSource).toMatch(/isCalendarOnboardingSource\(params\.source\)/);
  });

  it("keeps the one-time Calendar intro copy", () => {
    expect(shouldShowCalendarIntro({ calendarIntroSeen: false })).toBe(true);
    expect(shouldShowCalendarIntro({ calendarIntroSeen: true })).toBe(false);
    expect(GETTING_STARTED_COPY.calendarIntro).toMatch(/future transactions and recurring activity/);
    expect(GETTING_STARTED_COPY.calendarIntroCta).toBe("Got it");
    expect(calendarSource).toMatch(/testID="calendar-intro"/);
    expect(calendarSource).toMatch(/markCalendarOpened/);
  });

  it("shows the next-step handoff after intro only for onboarding visits", () => {
    expect(
      initialCalendarOnboardingSheet({
        fromOnboarding: true,
        introSeen: false,
        handoffSeen: false,
      })
    ).toBe("intro");
    expect(
      calendarSheetAfterIntroDismiss({ fromOnboarding: true, handoffSeen: false })
    ).toBe("handoff");
    expect(
      calendarSheetAfterIntroDismiss({ fromOnboarding: false, handoffSeen: false })
    ).toBe(null);
    expect(
      initialCalendarOnboardingSheet({
        fromOnboarding: false,
        introSeen: false,
        handoffSeen: false,
      })
    ).toBe("intro");
    expect(
      initialCalendarOnboardingSheet({
        fromOnboarding: false,
        introSeen: true,
        handoffSeen: false,
      })
    ).toBe(null);
    expect(shouldShowCalendarOnboardingHandoff({ fromOnboarding: true, handoffSeen: true })).toBe(
      false
    );
    expect(calendarSource).toMatch(/testID="calendar-onboarding-handoff"/);
    expect(calendarSource).toMatch(/handoffVisible && !calendarIntroVisible/);
  });

  it("routes the completion sheet to Home and Explore FlowSight", () => {
    expect(GETTING_STARTED_COPY.calendarCompleteTitle).toBe("You're ready");
    expect(GETTING_STARTED_COPY.calendarCompletePrimary).toBe("Go to Home");
    expect(GETTING_STARTED_COPY.calendarCompleteSecondary).toBe("Explore FlowSight");
    expect(GETTING_STARTED_HOME_ROUTE).toBe("/(app)/(tabs)");
    expect(GETTING_STARTED_EXPLORE_ROUTE).toBe("/(app)/(tabs)/more");
    expect(calendarSource).toMatch(/GETTING_STARTED_EXPLORE_ROUTE/);
    expect(calendarSource).toMatch(/GETTING_STARTED_HOME_ROUTE/);
    expect(calendarSource).toMatch(/router\.replace\(GETTING_STARTED_HOME_ROUTE/);
    expect(calendarSource).not.toMatch(/GETTING_STARTED_ROUTES\.recurring/);
  });

  it("persists handoff as seen so it does not repeat", () => {
    expect(
      initialCalendarOnboardingSheet({
        fromOnboarding: true,
        introSeen: true,
        handoffSeen: true,
      })
    ).toBe(null);
    expect(hookSource).toMatch(/calendar_onboarding_handoff_seen/);
    expect(hookSource).toMatch(/markCalendarOnboardingHandoffSeen/);
    expect(calendarSource).toMatch(/markCalendarOnboardingHandoffSeen/);
  });

  it("does not treat Looking Ahead calendar navigation as onboarding", () => {
    expect(dashboardSource).toMatch(/View extended forecast/);
    const lookingAheadPush = dashboardSource.slice(
      dashboardSource.indexOf("View extended forecast") - 400,
      dashboardSource.indexOf("View extended forecast")
    );
    expect(lookingAheadPush).toMatch(/\/\(app\)\/\(tabs\)\/calendar/);
    expect(lookingAheadPush).not.toMatch(/source=onboarding/);
  });

  it("leaves recurring checklist completion to real recurring data", () => {
    expect(calendarSource).not.toMatch(/recurring: true/);
    expect(hookSource).not.toMatch(/steps\.recurring/);
    expect(GETTING_STARTED_ROUTES.recurring).toBe("/recurring/new?source=onboarding");
  });
});
