import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { formatCurrency } from "@budget-app/shared";
import type { MonthlyReports } from "@budget-app/shared";
import { Card } from "@/components/ui";
import { useTheme } from "@/theme";
import { partitionCategoryBreakdown, topExpenseCategories } from "../categoryBreakdownDisplay";
import {
  reportAccountDetailPath,
  reportDetailPath,
  reportGoalDetailPath,
} from "../navigation";
import {
  formatMonthLabel,
  formatProjectedCompletion,
  formatSignedAmount,
  parseOptionalAmount,
} from "../reportDisplay";
import type { ReportFilters, ReportHistoryMonths } from "../types";
import { CategoryBreakdownRow, CategorySpendBarChart } from "./CategoryBreakdownRow";
import { CollapsibleReportSection } from "./CollapsibleReportSection";
import {
  CashFlowHistorySelector,
  InterestTrendChart,
  IncomeExpenseTrendChart,
} from "./ReportCharts";
import { ReportEmptyState } from "./ReportEmptyState";
import { ReportMetricGrid } from "./ReportMetricGrid";
import { ReportNavSection } from "./ReportNavSection";
import { GoalProgressRow, SpendingLimitCard } from "./SpendingLimitCard";

const TOP_CATEGORY_LIMIT = 6;

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
  const totalDebtOwed = parseOptionalAmount(data.debt.total_balance_owed);

  const metrics = useMemo(
    () => [
      {
        label: "Income",
        amount: overview.total_income,
        tone: "positive" as const,
        comparison: overview.comparison?.total_income,
        previousMonth,
        comparisonContext: "income" as const,
      },
      {
        label: "Expenses",
        amount: overview.total_expenses,
        tone: "negative" as const,
        comparison: overview.comparison?.total_expenses,
        previousMonth,
        comparisonContext: "expense" as const,
      },
      {
        label: "Net",
        amount: overview.net,
        tone: (parseOptionalAmount(overview.net) ?? 0) >= 0 ? ("positive" as const) : ("negative" as const),
        comparison: overview.comparison?.net,
        previousMonth,
        comparisonContext: "net" as const,
      },
    ],
    [overview, previousMonth]
  );

  return (
    <View style={{ gap: theme.spacing.md }}>
      <ReportMetricGrid metrics={metrics} />

      <ReportNavSection
        title="Top spending"
        footerLabel="See spending ›"
        onPress={() => router.push(reportDetailPath("spending", filters))}
        accessibilityHint="Opens the spending report"
      >
        {topCats.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>No expense categories this month.</Text>
        ) : (
          <CategorySpendBarChart rows={topCats} />
        )}
      </ReportNavSection>

      <ReportNavSection
        title="Goals"
        footerLabel="See goals ›"
        onPress={() => router.push(reportDetailPath("goals", filters))}
        accessibilityHint="Opens the goals report"
      >
        <Text style={{ color: theme.colors.text, fontSize: 14 }}>
          {goals.total_saved ? formatCurrency(goals.total_saved) : "—"} saved of{" "}
          {goals.total_target ? formatCurrency(goals.total_target) : "—"}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 4 }}>
          {goals.goals_on_track ?? 0}/{goals.goals_active_count ?? 0} on track
          {goals.monthly_needed_total
            ? ` · ${formatCurrency(goals.monthly_needed_total)}/mo needed`
            : ""}
        </Text>
      </ReportNavSection>

      <ReportNavSection
        title="Debt"
        footerLabel="See debt ›"
        onPress={() => router.push(reportDetailPath("debt", filters))}
        accessibilityHint="Opens the debt report"
      >
        <Text style={{ color: theme.colors.text, fontSize: 14 }}>
          Interest paid {debt.total_interest_paid ? formatCurrency(debt.total_interest_paid) : "—"}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 4 }}>
          {debt.highest_apr_card
            ? `Highest APR: ${debt.highest_apr_card.account_name} ${debt.highest_apr_card.apr}%`
            : "No credit cards"}
          {totalDebtOwed != null && totalDebtOwed > 0
            ? ` · ${formatCurrency(data.debt.total_balance_owed!)} owed`
            : ""}
        </Text>
      </ReportNavSection>

      <ReportNavSection
        title="Spending limits"
        footerLabel="See limit performance ›"
        onPress={() => router.push(reportDetailPath("spending", filters, { section: "limits" }))}
        accessibilityHint="Opens spending limit performance"
      >
        <Text style={{ color: theme.colors.text, fontSize: 14 }}>
          {data.spending_limits.above_target_count} over limit ·{" "}
          {data.spending_limits.approaching_target_count} approaching
        </Text>
      </ReportNavSection>
    </View>
  );
}

type CashFlowProps = {
  data: MonthlyReports;
  historyMonths: ReportHistoryMonths;
  onHistoryMonthsChange: (months: ReportHistoryMonths) => void;
};

export function CashFlowSection({ data, historyMonths, onHistoryMonthsChange }: CashFlowProps) {
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
        comparisonContext: "income" as const,
      },
      {
        label: "Expenses",
        amount: overview.total_expenses,
        tone: "negative" as const,
        comparison: overview.comparison?.total_expenses,
        previousMonth,
        comparisonContext: "expense" as const,
      },
      {
        label: "Net cash flow",
        amount: overview.net,
        tone: (parseOptionalAmount(overview.net) ?? 0) >= 0 ? ("positive" as const) : ("negative" as const),
        comparison: overview.comparison?.net,
        previousMonth,
        comparisonContext: "net" as const,
      },
    ],
    [overview, previousMonth]
  );

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <ReportMetricGrid metrics={metrics} />
      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 4 }}>
          Income vs expenses
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginBottom: 8 }}>
          Monthly totals from backend aggregates — internal transfers excluded.
        </Text>
        <CashFlowHistorySelector value={historyMonths} onChange={onHistoryMonthsChange} />
        <IncomeExpenseTrendChart trend={overview.trend} historyMonths={historyMonths} />
      </Card>
    </View>
  );
}

export function SpendingSection({
  data,
  onCategoryPress,
  initiallyExpandLimits = false,
}: {
  data: MonthlyReports;
  filters?: ReportFilters;
  onCategoryPress: (categoryId: number, categoryName: string) => void;
  initiallyExpandLimits?: boolean;
}) {
  const theme = useTheme();
  const [showAllCategories, setShowAllCategories] = useState(false);
  const previousMonth = data.overview.previous_month;
  const partitioned = useMemo(
    () => partitionCategoryBreakdown(data.category_breakdown.breakdown),
    [data.category_breakdown.breakdown]
  );
  const topCats = useMemo(
    () => topExpenseCategories(data.category_breakdown.breakdown, TOP_CATEGORY_LIMIT),
    [data.category_breakdown.breakdown]
  );
  const hiddenCategoryCount = Math.max(0, partitioned.expenses.length - TOP_CATEGORY_LIMIT);
  const limitSummary = `${data.spending_limits.above_target_count} over · ${data.spending_limits.approaching_target_count} approaching`;

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>
          Category breakdown
        </Text>
        {partitioned.expenses.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>
            No expense categories this month.
          </Text>
        ) : showAllCategories ? (
          <>
            {partitioned.expenses.map((row) => (
              <CategoryBreakdownRow
                key={row.category_id ?? `all-${row.category_name}`}
                row={row}
                previousMonth={previousMonth}
                onPress={
                  row.category_id != null
                    ? () => onCategoryPress(row.category_id!, row.category_name)
                    : undefined
                }
              />
            ))}
            {partitioned.expenses.length > TOP_CATEGORY_LIMIT ? (
              <Pressable
                onPress={() => setShowAllCategories(false)}
                accessibilityRole="button"
                style={{ marginTop: 8, minHeight: theme.touchTarget, justifyContent: "center" }}
              >
                <Text style={{ color: theme.colors.textMuted, fontSize: 13, fontWeight: "600" }}>
                  Show top {TOP_CATEGORY_LIMIT} ›
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <CategorySpendBarChart
              rows={topCats}
              limit={TOP_CATEGORY_LIMIT}
              onCategoryPress={onCategoryPress}
            />
            {hiddenCategoryCount > 0 ? (
              <Pressable
                onPress={() => setShowAllCategories(true)}
                accessibilityRole="button"
                accessibilityLabel={`Show all ${partitioned.expenses.length} categories`}
                style={{ marginTop: 8, minHeight: theme.touchTarget, justifyContent: "center" }}
              >
                <Text style={{ color: theme.colors.textMuted, fontSize: 13, fontWeight: "600" }}>
                  Show all {partitioned.expenses.length} categories ›
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </Card>

      {partitioned.income.length > 0 ? (
        <CollapsibleReportSection
          title="Income"
          subtitle={`${partitioned.income.length} categories · ${formatSignedAmount(data.overview.total_income)}`}
        >
          {partitioned.income.map((row) => (
            <CategoryBreakdownRow
              key={row.category_id ?? "uncategorized-income"}
              row={row}
              previousMonth={previousMonth}
              showShare={false}
              onPress={
                row.category_id != null
                  ? () => onCategoryPress(row.category_id!, row.category_name)
                  : undefined
              }
            />
          ))}
        </CollapsibleReportSection>
      ) : null}

      <CollapsibleReportSection
        title="Expenses"
        subtitle={`${partitioned.expenses.length} categories · ${formatSignedAmount(data.overview.total_expenses)}`}
        initiallyExpanded={false}
      >
        {partitioned.expenses.map((row) => (
          <CategoryBreakdownRow
            key={row.category_id ?? "uncategorized-expense"}
            row={row}
            previousMonth={previousMonth}
            onPress={
              row.category_id != null
                ? () => onCategoryPress(row.category_id!, row.category_name)
                : undefined
            }
          />
        ))}
      </CollapsibleReportSection>

      <CollapsibleReportSection
        title="Spending limit performance"
        subtitle={data.spending_limits.targets.length === 0 ? "No limits this month" : limitSummary}
        initiallyExpanded={initiallyExpandLimits}
      >
        {data.spending_limits.targets.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>
            No category spending limits for this month.
          </Text>
        ) : (
          <View style={{ gap: 12 }}>
            {data.spending_limits.targets.map((target) => (
              <SpendingLimitCard key={target.target_id} metrics={target} />
            ))}
          </View>
        )}
      </CollapsibleReportSection>
    </View>
  );
}

export function GoalsSection({ data }: { data: MonthlyReports }) {
  const theme = useTheme();
  const router = useRouter();
  const report = data.goals;
  const summary = report.summary;
  const active = report.buckets.filter((b) => b.status === "active" || b.status === "paused");
  const recentContributions = (report.contribution_history ?? []).slice(0, 5);

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <ReportMetricGrid
        metrics={[
          { label: "Total saved", amount: summary.total_saved ?? "", tone: "positive" },
          { label: "Total targets", amount: summary.total_target ?? "", tone: "neutral" },
          {
            label: "Monthly needed",
            amount: summary.monthly_needed_total ?? "",
            tone: "neutral",
          },
        ]}
      />

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 4 }}>
          Goal progress
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginBottom: 8 }}>
          {(summary.goals_on_track ?? 0)} of {(summary.goals_active_count ?? active.length)} on track
        </Text>
        {active.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>No active goals.</Text>
        ) : (
          active.map((goal) => (
            <Pressable
              key={goal.id}
              onPress={() => router.push(reportGoalDetailPath(goal.id))}
              accessibilityRole="button"
              accessibilityLabel={`${goal.name}, open goal detail`}
              style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}
            >
              <GoalProgressRow
                name={goal.name}
                current={goal.current_amount}
                target={goal.target_amount}
                progressPercent={goal.progress_percent}
                monthlyRequired={goal.monthly_required}
                projectedCompletion={formatProjectedCompletion(goal.projected_completion_date)}
              />
            </Pressable>
          ))
        )}
      </Card>

      {recentContributions.length > 0 ? (
        <Card>
          <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>
            Recent contributions
          </Text>
          {recentContributions.map((row) => (
            <View
              key={row.id}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
                gap: 8,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 14 }} numberOfLines={1}>
                  {row.bucket_name ?? `Goal ${row.bucket_id}`}
                </Text>
                <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 2 }}>
                  {row.date}
                </Text>
              </View>
              <Text style={{ color: theme.colors.textSecondary, fontWeight: "600" }}>
                {formatSignedAmount(row.amount)}
              </Text>
            </View>
          ))}
        </Card>
      ) : (
        <Card>
          <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>
            Actual funding
          </Text>
          {(report.monthly_funding ?? []).length === 0 ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>
              No actual contributions in this report window.
            </Text>
          ) : (
            (report.monthly_funding ?? []).slice(-6).map((row) => (
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
        </Card>
      )}
    </View>
  );
}

export function DebtSection({ data }: { data: MonthlyReports }) {
  const theme = useTheme();
  const router = useRouter();
  const debt = data.debt;

  const interestPaid = parseOptionalAmount(debt.total_interest_paid);
  if (debt.by_card.length === 0 && (interestPaid == null || interestPaid === 0)) {
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
        <Pressable
          onPress={() => router.push(reportAccountDetailPath(debt.highest_apr_card!.account_id))}
          accessibilityRole="button"
          accessibilityLabel={`${debt.highest_apr_card.account_name}, open account`}
        >
          <Card>
            <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "600" }}>
              HIGHEST APR
            </Text>
            <Text style={{ color: theme.colors.text, fontWeight: "600", marginTop: 4 }}>
              {debt.highest_apr_card.account_name} · {debt.highest_apr_card.apr}%
            </Text>
          </Card>
        </Pressable>
      ) : null}

      {debt.interest_trend && debt.interest_trend.length > 1 ? (
        <Card>
          <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>
            Interest over time
          </Text>
          <InterestTrendChart trend={debt.interest_trend} />
        </Card>
      ) : null}

      <Card>
        <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>By card</Text>
        {debt.by_card.map((row) => (
          <Pressable
            key={row.account_id}
            onPress={() => router.push(reportAccountDetailPath(row.account_id))}
            accessibilityRole="button"
            accessibilityLabel={`${row.account_name}, open account detail`}
            style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}
          >
            <View
              style={{
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{row.account_name}</Text>
              {row.balance_owed != null ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                  <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>Balance</Text>
                  <Text style={{ color: theme.colors.textSecondary, fontWeight: "600" }}>
                    {formatCurrency(row.balance_owed)}
                  </Text>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>Interest paid</Text>
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
          </Pressable>
        ))}
      </Card>
    </View>
  );
}
