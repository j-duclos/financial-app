import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { formatCurrency } from "@budget-app/shared";
import type { MonthlyReports } from "@budget-app/shared";
import { Card, SectionHeader } from "@/components/ui";
import { useTheme } from "@/theme";
import { partitionCategoryBreakdown } from "../categoryBreakdownDisplay";
import { reportDetailPath } from "../navigation";
import {
  formatMonthLabel,
  formatProjectedCompletion,
  formatSignedAmount,
  parseAmount,
} from "../reportDisplay";
import type { ReportFilters } from "../types";
import { CategoryBreakdownRow, CategorySpendBarChart } from "./CategoryBreakdownRow";
import { InterestTrendChart, IncomeExpenseTrendChart } from "./ReportCharts";
import { ReportEmptyState } from "./ReportEmptyState";
import { ReportMetricGrid } from "./ReportMetricGrid";
import { GoalProgressRow, SpendingLimitCard } from "./SpendingLimitCard";

type OverviewProps = {
  data: MonthlyReports;
  filters: ReportFilters;
};

export function OverviewSection({ data, filters }: OverviewProps) {
  const theme = useTheme();
  const router = useRouter();
  const overview = data.overview;
  const previousMonth = overview.previous_month;
  const topCats = overview.top_expense_categories ?? [];
  const goals = overview.goals_snapshot;
  const debt = overview.debt_snapshot;

  const metrics = useMemo(
    () => [
      {
        label: "Income",
        amount: overview.total_income,
        tone: "positive" as const,
        comparison: overview.comparison?.total_income,
        previousMonth,
      },
      {
        label: "Expenses",
        amount: overview.total_expenses,
        tone: "negative" as const,
        comparison: overview.comparison?.total_expenses,
        previousMonth,
      },
      {
        label: "Net",
        amount: overview.net,
        tone: parseAmount(overview.net) >= 0 ? ("positive" as const) : ("negative" as const),
        comparison: overview.comparison?.net,
        previousMonth,
      },
    ],
    [overview, previousMonth]
  );

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <ReportMetricGrid metrics={metrics} />

      <Card>
        <SectionHeader
          title="Top spending"
          actionLabel="View spending"
          onAction={() => router.push(reportDetailPath("spending", filters))}
        />
        {topCats.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>No expense categories this month.</Text>
        ) : (
          <CategorySpendBarChart rows={topCats} />
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Goals"
          actionLabel="View goals"
          onAction={() => router.push(reportDetailPath("goals", filters))}
        />
        <Text style={{ color: theme.colors.text, fontSize: 14 }}>
          {goals.total_saved ? formatCurrency(goals.total_saved) : "—"} saved of{" "}
          {goals.total_target ? formatCurrency(goals.total_target) : "—"}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 4 }}>
          {goals.goals_on_track ?? 0}/{goals.goals_active_count ?? 0} on track
          {goals.monthly_needed_total
            ? ` · ${formatCurrency(goals.monthly_needed_total)}/mo needed`
            : " · No monthly target"}
        </Text>
      </Card>

      <Card>
        <SectionHeader
          title="Debt"
          actionLabel="View debt"
          onAction={() => router.push(reportDetailPath("debt", filters))}
        />
        <Text style={{ color: theme.colors.text, fontSize: 14 }}>
          Interest paid {debt.total_interest_paid ? formatCurrency(debt.total_interest_paid) : "—"}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 4 }}>
          {debt.highest_apr_card
            ? `Highest APR: ${debt.highest_apr_card.account_name} ${debt.highest_apr_card.apr}%`
            : "No credit cards"}
        </Text>
      </Card>

      <Card>
        <SectionHeader
          title="Budget"
          actionLabel="View budget"
          onAction={() => router.push(reportDetailPath("spending", filters))}
        />
        <Text style={{ color: theme.colors.text, fontSize: 14 }}>
          {data.spending_limits.above_target_count} above limit ·{" "}
          {data.spending_limits.approaching_target_count} approaching
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 4 }}>
          Category budget {formatCurrency(data.spending_limits.total_monthly_targets)}
        </Text>
      </Card>

      <Pressable
        onPress={() => router.push(reportDetailPath("cash-flow", filters))}
        accessibilityRole="button"
        accessibilityLabel="View cash flow report"
      >
        <Text style={{ color: theme.colors.tint, fontWeight: "600", fontSize: 14 }}>View cash flow →</Text>
      </Pressable>
    </View>
  );
}

export function CashFlowSection({ data }: { data: MonthlyReports }) {
  const theme = useTheme();
  const overview = data.overview;
  const previousMonth = overview.previous_month;

  const metrics = useMemo(
    () => [
      {
        label: "Income",
        amount: overview.total_income,
        tone: "positive" as const,
        comparison: overview.comparison?.total_income,
        previousMonth,
      },
      {
        label: "Expenses",
        amount: overview.total_expenses,
        tone: "negative" as const,
        comparison: overview.comparison?.total_expenses,
        previousMonth,
      },
      {
        label: "Net cash flow",
        amount: overview.net,
        tone: parseAmount(overview.net) >= 0 ? ("positive" as const) : ("negative" as const),
        comparison: overview.comparison?.net,
        previousMonth,
      },
    ],
    [overview, previousMonth]
  );

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <ReportMetricGrid metrics={metrics} />
      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>Income vs expenses</Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginBottom: 12 }}>
          Historical monthly totals — transfers excluded (backend-calculated).
        </Text>
        <IncomeExpenseTrendChart trend={overview.trend} />
      </Card>
    </View>
  );
}

export function SpendingSection({
  data,
  filters,
  onCategoryPress,
}: {
  data: MonthlyReports;
  filters: ReportFilters;
  onCategoryPress: (categoryId: number, categoryName: string) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const previousMonth = data.overview.previous_month;
  const partitioned = useMemo(
    () => partitionCategoryBreakdown(data.category_breakdown.breakdown),
    [data.category_breakdown.breakdown]
  );
  const expenseAbs = Math.abs(partitioned.expenseSubtotal);
  const visibleExpenses = showAll ? partitioned.expenses : partitioned.expenses.slice(0, 8);
  const hiddenCount = partitioned.expenses.length - visibleExpenses.length;

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>Category breakdown</Text>
        {partitioned.expenses.length === 0 && partitioned.income.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>No categorized activity this month.</Text>
        ) : (
          <>
            <CategorySpendBarChart rows={data.category_breakdown.breakdown} />
            <View style={{ marginTop: 16 }}>
              <Text style={{ color: theme.colors.textSecondary, fontWeight: "700", fontSize: 13, marginBottom: 4 }}>
                Income
              </Text>
              {partitioned.income.map((row) => (
                <CategoryBreakdownRow
                  key={row.category_id ?? "uncategorized-income"}
                  row={row}
                  expenseSubtotal={expenseAbs}
                  previousMonth={previousMonth}
                  showShare={false}
                  onPress={
                    row.category_id != null
                      ? () => onCategoryPress(row.category_id!, row.category_name)
                      : undefined
                  }
                />
              ))}
              <Text
                style={{
                  color: theme.colors.moneyPositive,
                  fontWeight: "700",
                  fontSize: 14,
                  marginVertical: 8,
                }}
              >
                Income subtotal {formatSignedAmount(partitioned.incomeSubtotal)}
              </Text>

              <Text style={{ color: theme.colors.textSecondary, fontWeight: "700", fontSize: 13, marginBottom: 4 }}>
                Expenses
              </Text>
              {visibleExpenses.map((row) => (
                <CategoryBreakdownRow
                  key={row.category_id ?? "uncategorized-expense"}
                  row={row}
                  expenseSubtotal={expenseAbs}
                  previousMonth={previousMonth}
                  onPress={
                    row.category_id != null
                      ? () => onCategoryPress(row.category_id!, row.category_name)
                      : undefined
                  }
                />
              ))}
              {hiddenCount > 0 ? (
                <Pressable onPress={() => setShowAll(true)} accessibilityRole="button">
                  <Text style={{ color: theme.colors.tint, fontSize: 13, marginVertical: 8 }}>
                    Show all {partitioned.expenses.length} expense categories
                  </Text>
                </Pressable>
              ) : null}
              {showAll && partitioned.expenses.length > 8 ? (
                <Pressable onPress={() => setShowAll(false)} accessibilityRole="button">
                  <Text style={{ color: theme.colors.tint, fontSize: 13, marginVertical: 8 }}>
                    Show top categories only
                  </Text>
                </Pressable>
              ) : null}
              <Text
                style={{
                  color: theme.colors.moneyNegative,
                  fontWeight: "700",
                  fontSize: 14,
                  marginVertical: 8,
                }}
              >
                Expense subtotal {formatSignedAmount(partitioned.expenseSubtotal)}
              </Text>
              <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 15 }}>
                Net {formatSignedAmount(partitioned.net)}
              </Text>
            </View>
          </>
        )}
      </Card>

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 12 }}>Budget performance</Text>
        {data.spending_limits.targets.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>No category budgets for this month.</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {data.spending_limits.targets.map((target) => (
              <SpendingLimitCard key={target.target_id} metrics={target} />
            ))}
          </View>
        )}
        <Pressable
          onPress={() => router.push("/(app)/(tabs)/budget")}
          style={{ marginTop: 12 }}
          accessibilityRole="button"
        >
          <Text style={{ color: theme.colors.tint, fontWeight: "600", fontSize: 14 }}>Open Budget →</Text>
        </Pressable>
      </Card>
    </View>
  );
}

export function GoalsSection({ data }: { data: MonthlyReports }) {
  const theme = useTheme();
  const report = data.goals;
  const summary = report.summary;
  const active = report.buckets.filter((b) => b.status === "active" || b.status === "paused");

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <ReportMetricGrid
        metrics={[
          { label: "Total saved", amount: summary.total_saved ?? "0", tone: "positive" },
          { label: "Total targets", amount: summary.total_target ?? "0", tone: "neutral" },
          {
            label: "Monthly needed",
            amount: summary.monthly_needed_total ?? "0",
            tone: "neutral",
          },
        ]}
      />

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>Goal progress</Text>
        {active.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>No active goals.</Text>
        ) : (
          active.map((goal) => (
            <GoalProgressRow
              key={goal.id}
              name={goal.name}
              current={goal.current_amount}
              target={goal.target_amount}
              progressPercent={goal.progress_percent}
              monthlyRequired={goal.monthly_required}
              projectedCompletion={formatProjectedCompletion(goal.projected_completion_date)}
            />
          ))
        )}
      </Card>

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>Actual funding</Text>
        {(report.monthly_funding ?? []).length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>
            No actual contributions in this report window.
          </Text>
        ) : (
          (report.monthly_funding ?? []).map((row) => (
            <View
              key={`actual-${row.month}`}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.text }}>{formatMonthLabel(row.month)}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontWeight: "600" }}>
                {formatSignedAmount(row.total)}
              </Text>
            </View>
          ))
        )}
        {(report.projected_monthly_funding ?? []).length > 0 ? (
          <>
            <Text style={{ color: theme.colors.textSecondary, fontWeight: "700", fontSize: 13, marginTop: 16 }}>
              Projected funding
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginBottom: 8 }}>
              Future contributions after {formatMonthLabel(data.month)} — not actual deposits.
            </Text>
            {(report.projected_monthly_funding ?? []).map((row) => (
              <View
                key={`projected-${row.month}`}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.text }}>{formatMonthLabel(row.month)}</Text>
                <Text style={{ color: theme.colors.textMuted, fontWeight: "600" }}>
                  {formatSignedAmount(row.total)} (projected)
                </Text>
              </View>
            ))}
          </>
        ) : null}
      </Card>
    </View>
  );
}

export function DebtSection({ data }: { data: MonthlyReports }) {
  const theme = useTheme();
  const debt = data.debt;

  if (debt.by_card.length === 0 && parseAmount(debt.total_interest_paid) === 0) {
    return (
      <ReportEmptyState
        title="No credit-card interest"
        message="No interest charges recorded for this month."
      />
    );
  }

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <ReportMetricGrid
        metrics={[
          {
            label: "Interest paid",
            amount: debt.total_interest_paid,
            tone: "negative",
          },
          {
            label: "Projected remaining",
            amount: debt.total_projected_interest_remaining,
            tone: "neutral",
          },
        ]}
      />

      {debt.highest_apr_card ? (
        <Card>
          <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "600" }}>HIGHEST APR</Text>
          <Text style={{ color: theme.colors.text, fontWeight: "600", marginTop: 4 }}>
            {debt.highest_apr_card.account_name} · {debt.highest_apr_card.apr}%
          </Text>
        </Card>
      ) : null}

      {debt.interest_trend && debt.interest_trend.length > 1 ? (
        <Card>
          <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>Interest over time</Text>
          <InterestTrendChart trend={debt.interest_trend} />
        </Card>
      ) : null}

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>By card</Text>
        {debt.by_card.map((row) => (
          <View
            key={row.account_id}
            style={{
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{row.account_name}</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
              <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>Paid</Text>
              <Text style={{ color: theme.colors.moneyNegative, fontWeight: "600" }}>
                {formatCurrency(row.interest_paid)}
              </Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
              <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>Projected</Text>
              <Text style={{ color: theme.colors.warning, fontWeight: "600" }}>
                {formatCurrency(row.projected_interest_remaining)}
              </Text>
            </View>
            {row.apr ? (
              <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 4 }}>
                APR {row.apr}%
                {row.utilization_percent ? ` · Utilization ${row.utilization_percent}%` : ""}
              </Text>
            ) : null}
          </View>
        ))}
      </Card>
    </View>
  );
}
