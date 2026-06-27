import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import type { DashboardUpcomingGroup } from "@budget-app/shared";
import { formatDateDisplay } from "../../lib/dateDisplay";
import UpcomingList from "./UpcomingList";
import {
  UPCOMING_CALENDAR_PATH,
  UPCOMING_PREVIEW_DAYS,
  UPCOMING_SECTION_TITLE,
  buildUpcomingDashboardPreview,
  upcomingTimelineLinkLabel,
} from "../../lib/upcomingDisplay";

type Props = {
  groups: DashboardUpcomingGroup[];
  nextIssue?: {
    risk_date: string | null;
    account_name?: string;
    reason?: string;
  } | null;
};

/** Compact dashboard preview: 7 days, max 5 items, next risk day, link to calendar. */
export default function UpcomingMoneyFlowPreview({ groups, nextIssue }: Props) {
  const preview = buildUpcomingDashboardPreview(groups, nextIssue);

  return (
    <div className="space-y-2">
      {preview.nextRisk && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">
              Next risk day: {formatDateDisplay(preview.nextRisk.date)}
              {preview.nextRisk.accountName ? ` · ${preview.nextRisk.accountName}` : ""}
            </p>
            {preview.nextRisk.reason ? (
              <p className="text-amber-800/90 mt-0.5">{preview.nextRisk.reason}</p>
            ) : null}
          </div>
        </div>
      )}

      <UpcomingList
        groups={preview.groups}
        days={preview.days}
        truncated={preview.truncated}
        truncatedMessage={preview.truncatedMessage}
        showCalendarLink={false}
        emptyDays={UPCOMING_PREVIEW_DAYS}
        maxTotalItems={preview.maxTotalItems}
      />

      <div className="flex justify-end">
        <Link
          to={UPCOMING_CALENDAR_PATH}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          {upcomingTimelineLinkLabel()}
        </Link>
      </div>
    </div>
  );
}

export function UpcomingMoneyFlowPreviewSection({
  groups,
  nextIssue,
}: Props) {
  return (
    <section aria-label={UPCOMING_SECTION_TITLE}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {UPCOMING_SECTION_TITLE}
        </h2>
        <Link to={UPCOMING_CALENDAR_PATH} className="text-xs text-blue-600 hover:underline shrink-0">
          {upcomingTimelineLinkLabel()}
        </Link>
      </div>
      <UpcomingMoneyFlowPreview groups={groups} nextIssue={nextIssue} />
    </section>
  );
}
