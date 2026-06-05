import { AlertTriangle } from "lucide-react";
import { formatCurrency } from "@budget-app/shared";
import {
  dayHeatAriaLabel,
  dayHeatDotClass,
  dayHeatEmoji,
  dayHeatHeaderAccentClass,
  dayHeatShowsReason,
  resolveDayHeatLevel,
  type DayHeatSource,
} from "../../lib/dayHeatDisplay";
import {
  inlineProjectedBalanceWarnings,
  lowestMarkerIconClass,
  lowestMarkerTextClass,
  warningLineSeverity,
  type DayLowestSource,
} from "../../lib/dayLowestBalanceDisplay";

type Props = {
  day: DayHeatSource & DayLowestSource;
  dateTitle: string;
  dateSub?: string;
  incomeTotal: string;
  expenseTotal: string;
  netTotal: string;
  netColorClass: string;
  compact?: boolean;
  singleAccountView?: boolean;
  /** Hide heat reason and lowest-balance lines (e.g. day panel shows them in alert tiles). */
  hideInlineRisk?: boolean;
  /** Stack date above day totals (timeline day panel). */
  panelLayout?: boolean;
  trailing?: React.ReactNode;
};

export default function DayHeatHeader({
  day,
  dateTitle,
  dateSub,
  incomeTotal,
  expenseTotal,
  netTotal,
  netColorClass,
  compact = false,
  singleAccountView = false,
  hideInlineRisk = false,
  panelLayout = false,
  trailing,
}: Props) {
  const level = resolveDayHeatLevel(day);
  const projectedWarnings =
    !hideInlineRisk && dayHeatShowsReason(level)
      ? inlineProjectedBalanceWarnings(day)
      : [];
  const aria = dayHeatAriaLabel(day, dateTitle);

  const financialSummary = (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-0.5">
      <span>
        <span className="text-gray-500">Income </span>
        <span className="text-green-700">{formatCurrency(incomeTotal)}</span>
      </span>
      <span>
        <span className="text-gray-500">Expenses </span>
        <span className="text-red-700">{formatCurrency(expenseTotal)}</span>
      </span>
      <span>
        <span className="text-gray-500">Net cash flow </span>
        <span className={netColorClass}>
          {formatCurrency(netTotal)}
        </span>
      </span>
    </span>
  );

  const financialSummaryBlock = compact ? (
    financialSummary
  ) : (
    <>
      <p>
        <span className="text-gray-500">Income:</span>{" "}
        <span className="text-green-700">{formatCurrency(incomeTotal)}</span>
      </p>
      <p>
        <span className="text-gray-500">Expenses:</span>{" "}
        <span className="text-red-700">{formatCurrency(expenseTotal)}</span>
      </p>
      <p>
        <span className="text-gray-500">Net cash flow:</span>{" "}
        <span className={netColorClass}>{formatCurrency(netTotal)}</span>
      </p>
    </>
  );

  if (panelLayout) {
    return (
      <header
        className={`rounded-r-md ${dayHeatHeaderAccentClass(level)}`}
        aria-label={aria}
      >
        <div className="flex items-center gap-2.5 px-3 py-2 min-w-0">
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ${dayHeatDotClass(level)}`}
            aria-hidden
          />
          <span className="text-base shrink-0 leading-none" aria-hidden>
            {dayHeatEmoji(level)}
          </span>
          <h3 className="font-semibold text-gray-900 text-sm whitespace-nowrap min-w-0">
            {dateTitle}
            {dateSub ? <span className="font-normal text-gray-500"> {dateSub}</span> : null}
          </h3>
        </div>
        <div className="px-3 pb-2 text-xs text-gray-600 tabular-nums">{financialSummary}</div>
      </header>
    );
  }

  return (
    <header
      className={`flex flex-wrap items-start justify-between gap-2 rounded-r-md pr-2 ${compact ? "mb-0 gap-y-1" : "mb-1.5"} ${dayHeatHeaderAccentClass(level)}`}
      aria-label={aria}
    >
      <div className={`min-w-0 flex-1 ${compact ? "py-0.5" : "space-y-0.5 py-1"} pl-2`}>
        <div className={`flex items-center gap-2 min-w-0 ${compact ? "flex-nowrap" : "flex-wrap"}`}>
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ${dayHeatDotClass(level)}`}
            aria-hidden
          />
          <span className="text-base shrink-0" aria-hidden>
            {dayHeatEmoji(level)}
          </span>
          <h3
            className={`font-semibold text-gray-900 ${compact ? "text-sm whitespace-nowrap" : ""}`}
          >
            {dateTitle}
            {dateSub ? (
              <span className={`font-normal text-gray-500${compact ? "" : " text-sm"}`}> {dateSub}</span>
            ) : null}
          </h3>
        </div>
        {!hideInlineRisk &&
          projectedWarnings.map((warning, index) => {
            const creditRow = (day.credit_balance_warnings ?? []).find(
              (row) => row.message === warning
            );
            const severity = warningLineSeverity(day, level, creditRow?.severity);
            return (
              <p
                key={`${warning}-${index}`}
                className={`text-xs flex items-start gap-1 pl-5 ${lowestMarkerTextClass(severity)}`}
              >
                <AlertTriangle
                  className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${lowestMarkerIconClass(severity)}`}
                  aria-hidden
                />
                <span>{warning}</span>
              </p>
            );
          })}
      </div>
      <div className={`flex flex-col items-end shrink-0 ${compact ? "py-0.5" : "gap-1 py-1"}`}>
        <div
          className={`text-xs text-gray-600 text-right ${compact ? "space-x-1" : "space-y-0.5"}`}
        >
          {financialSummaryBlock}
        </div>
        {trailing}
      </div>
    </header>
  );
}
