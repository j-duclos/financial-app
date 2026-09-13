import { Redirect, useLocalSearchParams } from "expo-router";
import { automationEditHref } from "./navigation";

/**
 * Legacy Recurring detail redirects to the Automation rule editor.
 * Recurring is a view; Automation owns pause/resume/edit/delete.
 */
export function RecurringDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={automationEditHref(id)} />;
}
