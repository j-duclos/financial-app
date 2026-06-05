import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Account } from "@budget-app/shared";
import { getTimeline } from "@budget-app/api-client";
import {
  addMonths,
  todayStr,
} from "../transactions/transactionsLedgerUtils";
import {
  buildHouseholdProjectionLines,
  HOUSEHOLD_PROJECTION_MONTHS,
} from "../../lib/householdProjection";

type Props = {
  householdId: number | null;
  accounts: Account[];
};

function activeAccountsForHousehold(accounts: Account[], householdId: number): Account[] {
  return accounts.filter((a) => {
    const ahId =
      typeof a.household === "object" && a.household != null && "id" in a.household
        ? (a.household as { id: number }).id
        : typeof a.household === "number"
          ? a.household
          : null;
    const st = a.status ?? (a.archived ? "archived" : "active");
    return ahId === householdId && st === "active";
  });
}

export default function HouseholdProjectionPanel({ householdId, accounts }: Props) {
  const [open, setOpen] = useState(true);

  const accountsForHousehold = useMemo(
    () => (householdId != null ? activeAccountsForHousehold(accounts, householdId) : []),
    [accounts, householdId]
  );

  const timelineStart = useMemo(() => addMonths(-HOUSEHOLD_PROJECTION_MONTHS), []);
  const timelineEnd = useMemo(() => addMonths(HOUSEHOLD_PROJECTION_MONTHS), []);

  const { data: householdTimelineData } = useQuery({
    queryKey: ["timeline", "household", timelineStart, timelineEnd, householdId, todayStr()],
    queryFn: () =>
      getTimeline({
        start: timelineStart,
        end: timelineEnd,
        as_of: todayStr(),
        household_id: householdId ?? undefined,
      }),
    enabled: householdId != null && accountsForHousehold.length > 0,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const projectionLines = useMemo(
    () =>
      buildHouseholdProjectionLines(
        householdTimelineData?.timeline ?? [],
        accountsForHousehold
      ),
    [householdTimelineData?.timeline, accountsForHousehold]
  );

  if (householdId == null || projectionLines.length === 0) return null;

  return (
    <div
      className="text-gray-800 text-xs border border-slate-200 rounded bg-slate-50 overflow-hidden mb-4"
      data-testid="household-projection-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 text-left hover:bg-slate-100/80"
        aria-expanded={open}
      >
        <span className="font-medium text-slate-600">
          All accounts — projected in this time range
          {!open && (
            <span className="font-normal text-slate-500">
              {" "}
              ({projectionLines.length} lines)
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="px-2.5 pb-1.5 space-y-0.5 border-t border-slate-200">
          {projectionLines.map((line) => (
            <div key={line.key}>{line.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}
