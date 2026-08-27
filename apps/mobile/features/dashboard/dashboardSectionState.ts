/** Three-state model for dashboard detail sections (Upcoming, Goals). */
export type DashboardDetailsSectionState = "loading" | "empty" | "data" | "error" | "hidden";

export function dashboardDetailsSectionState(input: {
  details: unknown;
  detailsError: boolean;
  fastError: boolean;
  isEmpty: boolean;
}): DashboardDetailsSectionState {
  if (input.details != null) {
    return input.isEmpty ? "empty" : "data";
  }
  if (input.detailsError) return "error";
  if (input.fastError) return "hidden";
  return "loading";
}

export function isDashboardDetailsSectionLoading(state: DashboardDetailsSectionState): boolean {
  return state === "loading";
}

export function isDashboardAttentionLoading(input: {
  summaryFast: unknown;
  fastError: boolean;
  fastSuccess: boolean;
}): boolean {
  if (input.summaryFast != null) return false;
  if (input.fastError) return false;
  return !input.fastSuccess;
}
