import { useMemo } from "react";
import type { CategoryBreakdownItem, GoalMonthlyFunding, MonthlySummary } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { formatShortMonth, parseOptionalAmount } from "../../lib/reportDisplay";

type TrendPoint = Pick<MonthlySummary, "month" | "total_income" | "total_expenses">;

function maxAbs(values: number[]): number {
  return Math.max(1, ...values.map((v) => Math.abs(v)));
}

export function IncomeExpenseTrendChart({
  trend,
}: {
  trend: TrendPoint[];
}) {
  const width = 640;
  const height = 168;
  const pad = { top: 12, right: 8, bottom: 28, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const points = useMemo(
    () =>
      trend.map((row) => ({
        month: row.month,
        income: parseOptionalAmount(row.total_income) ?? 0,
        expense: Math.abs(parseOptionalAmount(row.total_expenses) ?? 0),
      })),
    [trend]
  );
  const peak = maxAbs(points.flatMap((p) => [p.income, p.expense]));
  const groupW = innerW / Math.max(points.length, 1);
  const barW = Math.max(3, groupW * 0.32);

  const summary = points.length
    ? `Income versus expenses from ${formatShortMonth(points[0].month)} to ${formatShortMonth(points[points.length - 1].month)}.`
    : "No income or expense trend data.";

  return (
    <figure className="w-full">
      <figcaption className="sr-only">{summary}</figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-40"
        role="img"
        aria-label={summary}
      >
        <title>{summary}</title>
        {points.map((p, i) => {
          const x = pad.left + i * groupW + groupW / 2;
          const incomeH = (p.income / peak) * innerH;
          const expenseH = (p.expense / peak) * innerH;
          return (
            <g key={p.month}>
              <rect
                x={x - barW - 1}
                y={pad.top + innerH - incomeH}
                width={barW}
                height={incomeH}
                className="fill-emerald-500"
              >
                <title>{`${formatShortMonth(p.month)} income ${formatCurrency(p.income)}`}</title>
              </rect>
              <rect
                x={x + 1}
                y={pad.top + innerH - expenseH}
                width={barW}
                height={expenseH}
                className="fill-red-400"
              >
                <title>{`${formatShortMonth(p.month)} expenses ${formatCurrency(p.expense)}`}</title>
              </rect>
              <text
                x={x}
                y={height - 8}
                textAnchor="middle"
                className="fill-gray-500 text-[9px]"
              >
                {formatShortMonth(p.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 flex gap-3 text-[11px] text-gray-500" aria-hidden>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" /> Income
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-red-400" /> Expenses
        </span>
      </p>
    </figure>
  );
}

export function CategorySpendBarChart({
  rows,
}: {
  rows: CategoryBreakdownItem[];
}) {
  const ranked = useMemo(() => {
    return [...rows]
      .filter((row) => (parseOptionalAmount(row.total) ?? 0) < 0)
      .sort((a, b) => (parseOptionalAmount(a.total) ?? 0) - (parseOptionalAmount(b.total) ?? 0))
      .slice(0, 6)
      .map((row) => ({
        ...row,
        abs: Math.abs(parseOptionalAmount(row.total) ?? 0),
      }));
  }, [rows]);
  const peak = maxAbs(ranked.map((r) => r.abs));
  if (ranked.length === 0) return null;
  const summary = `Top expense categories: ${ranked
    .map((r) => `${r.category_name} ${formatCurrency(r.abs)}`)
    .join("; ")}.`;

  return (
    <figure>
      <figcaption className="sr-only">{summary}</figcaption>
      <ul className="space-y-2" aria-label="Top expense categories">
        {ranked.map((row) => {
          const pct = Math.max(2, (row.abs / peak) * 100);
          return (
            <li key={row.category_id ?? row.category_name}>
              <div className="flex justify-between gap-2 text-xs text-gray-700 mb-0.5">
                <span className="truncate">{row.category_name}</span>
                <span className="tabular-nums shrink-0">{formatCurrency(row.abs)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-red-400"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

export function GoalFundingChart({
  actual,
  projected,
}: {
  actual: GoalMonthlyFunding[];
  projected: GoalMonthlyFunding[];
}) {
  const width = 640;
  const height = 160;
  const pad = { top: 12, right: 12, bottom: 28, left: 12 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const series = useMemo(() => {
    const actualPts = actual.map((row) => ({
      month: row.month,
      total: parseOptionalAmount(row.total) ?? 0,
    }));
    const projectedPts = projected.map((row) => ({
      month: row.month,
      total: parseOptionalAmount(row.total) ?? 0,
    }));
    const months = Array.from(
      new Set([...actualPts.map((p) => p.month), ...projectedPts.map((p) => p.month)])
    ).sort();
    const lastActual = actualPts[actualPts.length - 1];
    const projectedLine =
      lastActual && projectedPts.length > 0 ? [lastActual, ...projectedPts] : projectedPts;
    return { actualPts, projectedLine, months, all: [...actualPts, ...projectedPts] };
  }, [actual, projected]);

  if (series.all.length === 0) return null;
  const peak = maxAbs(series.all.map((p) => p.total));
  const min = Math.min(0, ...series.all.map((p) => p.total));
  const span = Math.max(peak - min, 1);
  const xForMonth = (month: string) => {
    const i = series.months.indexOf(month);
    const count = series.months.length;
    return pad.left + (count <= 1 ? innerW / 2 : (i / (count - 1)) * innerW);
  };
  const yFor = (v: number) => pad.top + innerH - ((v - min) / span) * innerH;
  const toPath = (pts: { month: string; total: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xForMonth(p.month)} ${yFor(p.total)}`).join(" ");

  const summary = `Actual goal funding from ${formatShortMonth(series.months[0])} through ${formatShortMonth(
    series.months[series.months.length - 1]
  )}${series.projectedLine.length > 1 ? ", with projected funding shown as a dashed line" : ""}.`;

  return (
    <figure>
      <figcaption className="sr-only">{summary}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-36" role="img" aria-label={summary}>
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={yFor(0)}
          y2={yFor(0)}
          className="stroke-gray-200"
        />
        {series.actualPts.length > 1 && (
          <path d={toPath(series.actualPts)} fill="none" className="stroke-emerald-600" strokeWidth="2" />
        )}
        {series.projectedLine.length > 1 && (
          <path
            d={toPath(series.projectedLine)}
            fill="none"
            className="stroke-emerald-600"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        )}
        {series.actualPts.map((p) => (
          <circle
            key={`a-${p.month}`}
            cx={xForMonth(p.month)}
            cy={yFor(p.total)}
            r="3"
            className="fill-emerald-600"
          >
            <title>{`${formatShortMonth(p.month)} actual ${formatCurrency(p.total)}`}</title>
          </circle>
        ))}
        {series.actualPts.map((p, i) =>
          i % Math.ceil(series.actualPts.length / 6) === 0 || i === series.actualPts.length - 1 ? (
            <text
              key={`t-${p.month}`}
              x={xForMonth(p.month)}
              y={height - 8}
              textAnchor="middle"
              className="fill-gray-500 text-[9px]"
            >
              {formatShortMonth(p.month)}
            </text>
          ) : null
        )}
      </svg>
      <p className="mt-1 flex gap-3 text-[11px] text-gray-500" aria-hidden>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-emerald-600" /> Actual funding
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-emerald-600" style={{ backgroundImage: "repeating-linear-gradient(90deg, #059669 0 3px, transparent 3px 6px)" }} />{" "}
          Projected funding
        </span>
      </p>
    </figure>
  );
}

export function InterestTrendChart({
  trend,
}: {
  trend: Array<{ month: string; interest_paid: string }>;
}) {
  const points = useMemo(
    () => trend.map((row) => ({ month: row.month, paid: parseOptionalAmount(row.interest_paid) ?? 0 })),
    [trend]
  );
  const nonzero = points.filter((p) => p.paid > 0);
  if (nonzero.length < 2) return null;
  const width = 640;
  const height = 140;
  const pad = { top: 8, right: 8, bottom: 24, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const peak = maxAbs(points.map((p) => p.paid));
  const barW = Math.max(4, (innerW / points.length) * 0.55);
  const summary = `Interest paid from ${formatShortMonth(points[0].month)} to ${formatShortMonth(
    points[points.length - 1].month
  )}.`;

  return (
    <figure>
      <figcaption className="sr-only">{summary}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32" role="img" aria-label={summary}>
        {points.map((p, i) => {
          const x = pad.left + (i + 0.5) * (innerW / points.length);
          const h = (p.paid / peak) * innerH;
          return (
            <g key={p.month}>
              <rect
                x={x - barW / 2}
                y={pad.top + innerH - h}
                width={barW}
                height={h}
                className="fill-amber-500"
              >
                <title>{`${formatShortMonth(p.month)} ${formatCurrency(p.paid)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
