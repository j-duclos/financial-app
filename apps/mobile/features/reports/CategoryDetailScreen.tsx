import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { currentMonthStr } from "@budget-app/shared";
import {
  AppHeader,
  Button,
  Card,
  CurrencyDisplay,
  ErrorState,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { PeriodComparisonBadge } from "./components/PeriodComparisonBadge";
import { parseReportRouteParams, transactionsForReportCategory } from "./navigation";
import {
  formatDeltaVsPrevious,
  formatExpenseSharePercent,
  formatMonthLabel,
  formatSignedAmount,
  parseOptionalAmount,
} from "./reportDisplay";
import type { ReportFilters } from "./types";
import { useReportsData } from "./useReportsData";

export function CategoryDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    categoryId: string;
    month?: string;
    months?: string;
    name?: string;
  }>();

  const categoryId = Number(params.categoryId);
  const routeFilters = parseReportRouteParams(params);
  const filters: ReportFilters = useMemo(
    () => ({
      monthKey: routeFilters?.monthKey ?? currentMonthStr(),
      historyMonths: routeFilters?.historyMonths ?? 12,
    }),
    [routeFilters]
  );

  const { data, isLoading, isError, error, refetch, isPlaceholderData, isFetching } =
    useReportsData(filters);

  const row = useMemo(() => {
    if (!data) return null;
    return data.category_breakdown.breakdown.find((r) => r.category_id === categoryId) ?? null;
  }, [data, categoryId]);

  const categoryName = params.name || row?.category_name || "Category";
  const previousMonth = data?.overview.previous_month;
  const total = row ? parseOptionalAmount(row.total) : null;
  const isExpense = total != null ? total < 0 : true;
  const share = row && isExpense ? formatExpenseSharePercent(row.expense_share_percent) : null;
  const dataMatchesMonth = data != null && data.month === filters.monthKey;
  const updatingPeriod = Boolean(isFetching || isPlaceholderData || (data && !dataMatchesMonth));

  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return (
      <Screen scroll={false}>
        <AppHeader title="Category" onBack={() => router.back()} />
        <ErrorState message="Invalid category." onRetry={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <AppHeader title={categoryName} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 32 }}>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
          {formatMonthLabel(filters.monthKey)}
          {data && dataMatchesMonth ? ` · ${data.period.start} – ${data.period.end}` : ""}
        </Text>

        {updatingPeriod && data ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginBottom: 8 }}>
            Updating {formatMonthLabel(filters.monthKey)}…
          </Text>
        ) : null}

        {isLoading && !data ? (
          <SkeletonBlock lines={4} />
        ) : isError && !data ? (
          <ErrorState message={describeApiError(error)} onRetry={refetch} />
        ) : !row || !dataMatchesMonth ? (
          updatingPeriod ? (
            <SkeletonBlock lines={4} />
          ) : (
            <ErrorState
              message="No activity for this category in the selected month."
              onRetry={() => router.back()}
            />
          )
        ) : (
          <>
            <Card>
              <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "600" }}>TOTAL</Text>
              <CurrencyDisplay
                amount={row.total}
                tone={isExpense ? "negative" : "positive"}
                showSign
                style={{ fontSize: 28, marginTop: 4 }}
              />
              {share ? (
                <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: 8 }}>
                  {share} of total spending
                </Text>
              ) : null}
              {previousMonth && row.show_comparison && row.delta != null ? (
                <PeriodComparisonBadge
                  text={formatDeltaVsPrevious(row.delta, previousMonth)}
                  delta={row.delta}
                  context={isExpense ? "expense" : "income"}
                  style={{ marginTop: 8 }}
                />
              ) : null}
              {row.previous_total != null ? (
                <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 8 }}>
                  Previous month: {formatSignedAmount(row.previous_total)}
                </Text>
              ) : null}
            </Card>

            <View style={{ marginTop: theme.spacing.lg }}>
              <Button
                label="View transactions"
                onPress={() =>
                  router.push(
                    transactionsForReportCategory(categoryId, data.period.start, data.period.end)
                  )
                }
              />
            </View>

            <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 16 }}>
              Transactions are filtered to this category and report date range ({data.period.start} –{" "}
              {data.period.end}).
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
