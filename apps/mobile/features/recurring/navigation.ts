import type { Href } from "expo-router";

/** Recurring create always uses the Automation rule editor — never a second form. */
export function automationCreateHref(source?: string): Href {
  return (
    source ? `/automation/new?source=${encodeURIComponent(source)}` : "/automation/new"
  ) as Href;
}

/** Recurring item tap opens the Automation rule editor for the same rule id. */
export function automationEditHref(ruleId: number | string): Href {
  return `/automation/edit/${ruleId}` as Href;
}
