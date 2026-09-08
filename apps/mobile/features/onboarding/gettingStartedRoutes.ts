import type { GettingStartedStepId } from "@budget-app/shared";

export const GETTING_STARTED_ROUTES: Record<GettingStartedStepId, string> = {
  account: "/account/new",
  upcoming_transaction: "/transaction/new",
  recurring: "/recurring/new",
  calendar: "/(app)/(tabs)/calendar",
  goal: "/goal/new",
};
