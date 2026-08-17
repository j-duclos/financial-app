import { Link } from "react-router-dom";
import type { ExtendedCashRisk } from "@budget-app/shared";
import { LOOKING_AHEAD } from "../../lib/dashboardTerminology";
import { lookingAheadCalendarPath, lookingAheadMessage } from "../../lib/lookingAhead";

type Props = {
  risk: ExtendedCashRisk;
};

export default function LookingAheadBanner({ risk }: Props) {
  return (
    <section
      aria-label={LOOKING_AHEAD.label}
      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
      data-testid="looking-ahead-banner"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
        {LOOKING_AHEAD.label}
      </p>
      <p className="mt-1 text-sm text-amber-950">{lookingAheadMessage(risk)}</p>
      <Link
        to={lookingAheadCalendarPath(risk)}
        className="mt-1.5 inline-block text-sm font-medium text-amber-900 hover:underline"
      >
        {LOOKING_AHEAD.viewExtendedForecast}
      </Link>
    </section>
  );
}
