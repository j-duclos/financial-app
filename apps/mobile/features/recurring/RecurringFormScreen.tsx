import { Redirect, useLocalSearchParams } from "expo-router";
import { firstRouteParam } from "@/features/onboarding/gettingStartedRoutes";
import { automationCreateHref, automationEditHref } from "./navigation";

/**
 * Legacy Recurring create/edit routes redirect to Automation.
 * Automation is the only recurring-rule editor.
 */
export function RecurringFormScreen() {
  const params = useLocalSearchParams<{ id?: string; source?: string | string[] }>();
  const editingId = params.id ? Number(params.id) : NaN;
  if (Number.isInteger(editingId) && editingId > 0) {
    return <Redirect href={automationEditHref(editingId)} />;
  }
  return <Redirect href={automationCreateHref(firstRouteParam(params.source))} />;
}
