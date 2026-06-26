import UpcomingList from "./UpcomingList";
import { UPCOMING_SECTION_TITLE } from "../../lib/upcomingDisplay";
import type { DashboardUpcomingGroup } from "@budget-app/shared";

type Props = {
  groups: DashboardUpcomingGroup[];
  days: number;
  truncated?: boolean;
  /** Show footer link to calendar page (off when already on calendar). */
  showCalendarLink?: boolean;
  title?: string;
};

/** Full upcoming money flow list — used on the Calendar page. */
export default function UpcomingMoneyFlowSection({
  groups,
  days,
  truncated,
  showCalendarLink = false,
  title = UPCOMING_SECTION_TITLE,
}: Props) {
  return (
    <section aria-label={title} className="mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
        {title}
      </h2>
      <UpcomingList
        groups={groups}
        days={days}
        truncated={truncated}
        showCalendarLink={showCalendarLink}
      />
    </section>
  );
}
