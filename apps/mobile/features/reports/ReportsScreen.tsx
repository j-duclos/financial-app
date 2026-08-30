import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { currentMonthStr, formatCurrency } from "@budget-app/shared";
import {
  AppHeader,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { PeriodSelector } from "@/features/budget/PeriodSelector";
import { currentPeriodAnchor, periodAnchorFromDate, shiftPeriodAnchor } from "@/features/budget/periodUtils";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { ReportFiltersSheet } from "./ReportFiltersSheet";
import { formatMonthLabel, formatSignedAmount, parseOptionalAmount } from "./reportDisplay";
import { reportDetailPath } from "./navigation";
import { countActiveReportFilters, REPORT_TYPE_CARDS, type ReportFilters } from "./types";
import { useReportsData } from "./useReportsData";

const DEFAULT_FILTERS: ReportFilters = {
  monthKey: currentMonthStr(),
  historyMonths: 12,
};

function periodFromMonthKey(monthKey: string) {
  return periodAnchorFromDate(`${monthKey}-15`);
}

function monthKeyFromPeriod(period: ReturnType<typeof currentPeriodAnchor>) {
  return period.monthKey;
}

export function ReportsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [period, setPeriod] = useState(() => periodFromMonthKey(DEFAULT_FILTERS.monthKey));
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_FILTERS);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const activeFilters = useMemo(
    () => ({ ...filters, monthKey: monthKeyFromPeriod(period) }),
    [filters, period]
  );

  const {
    data,
    householdReady,
    householdId,
    isLoading,
    isError,
    error,
    isFetching,
    isPlaceholderData,
    refetch,
    monthKey,
  } = useReportsData(activeFilters);
  const activeFilterCount = countActiveReportFilters(filters, DEFAULT_FILTERS);
  const dataMatchesMonth = data != null && data.month === monthKey;
  const updatingPeriod = Boolean(
    (isFetching || isPlaceholderData || (data != null && !dataMatchesMonth)) && !pullRefreshing
  );

  const onPeriodChange = (next: typeof period) => {
    setPeriod(next);
  };

  const onPullRefresh = async () => {
    setPullRefreshing(true);
    try {
      await refetch();
    } finally {
      setPullRefreshing(false);
    }
  };

  if (!householdReady) {
    return (
      <Screen scroll={false}>
        <AppHeader title="Reports" onBack={() => router.back()} />
        <View style={{ padding: theme.spacing.lg }}>
          <SkeletonBlock lines={5} />
        </View>
      </Screen>
    );
  }

  if (householdId == null) {
    return (
      <Screen scroll={false}>
        <AppHeader title="Reports" onBack={() => router.back()} />
        <View style={{ padding: theme.spacing.lg }}>
          <EmptyState
            title="Default household required"
            message="Set a default household in Profile & Settings on web to view reports."
          />
        </View>
      </Screen>
    );
  }

  const previewNet = dataMatchesMonth ? data?.overview.net : undefined;
  const expenseCategoryCount = dataMatchesMonth
    ? data?.category_breakdown.breakdown.filter((r) => {
        const n = parseOptionalAmount(r.total);
        return n != null && n < 0;
      }).length
    : undefined;

  return (
    <Screen scroll={false}>
      <AppHeader title="Reports" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} />}
      >
        <Text style={{ color: theme.colors.textSecondary, marginBottom: 12, ...theme.typography.body }}>
          Understand where your money goes — monthly insights from your accounts.
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginBottom: 4 }}>
          <IconButton
            name="sliders"
            accessibilityLabel={
              activeFilterCount > 0 ? `Report filters, ${activeFilterCount} active` : "Report filters"
            }
            onPress={() => setFilterSheetOpen(true)}
          />
        </View>

        <PeriodSelector
          period={period}
          onPrev={() => onPeriodChange(shiftPeriodAnchor(period, -1))}
          onNext={() => onPeriodChange(shiftPeriodAnchor(period, 1))}
          onToday={() => onPeriodChange(currentPeriodAnchor())}
        />

        {activeFilterCount > 0 ? (
          <Text style={{ color: theme.colors.tint, fontSize: 12, fontWeight: "600", marginBottom: 8 }}>
            {activeFilterCount} filter active · {filters.historyMonths}-month trend window
          </Text>
        ) : null}

        {updatingPeriod ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginBottom: 8 }}>
            Updating {formatMonthLabel(monthKey)}…
          </Text>
        ) : null}

        {isLoading && !data ? (
          <SkeletonBlock lines={5} />
        ) : isError && !data ? (
          <ErrorState message={describeApiError(error)} onRetry={() => void refetch()} />
        ) : (
          <>
            {data && dataMatchesMonth ? (
              <Card style={{ marginBottom: theme.spacing.lg }}>
                <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "600" }}>
                  {formatMonthLabel(data.month)} SUMMARY
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 8 }}>
                  <View>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>Income</Text>
                    <Text style={{ color: theme.colors.moneyPositive, fontWeight: "700", fontSize: 16 }}>
                      {formatSignedAmount(data.overview.total_income)}
                    </Text>
                  </View>
                  <View>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>Expenses</Text>
                    <Text style={{ color: theme.colors.moneyNegative, fontWeight: "700", fontSize: 16 }}>
                      {formatSignedAmount(data.overview.total_expenses)}
                    </Text>
                  </View>
                  <View>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>Net</Text>
                    <Text
                      style={{
                        color:
                          (parseOptionalAmount(data.overview.net) ?? 0) >= 0
                            ? theme.colors.moneyPositive
                            : theme.colors.moneyNegative,
                        fontWeight: "700",
                        fontSize: 16,
                      }}
                    >
                      {formatSignedAmount(data.overview.net)}
                    </Text>
                  </View>
                </View>
              </Card>
            ) : updatingPeriod ? (
              <SkeletonBlock lines={3} />
            ) : null}

            {isError && data ? (
              <Text style={{ color: theme.colors.warning, fontSize: 13, marginBottom: 12 }}>
                Could not refresh — showing cached data. {describeApiError(error)}
              </Text>
            ) : null}

            <Text
              style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 8 }}
              accessibilityRole="header"
            >
              Report types
            </Text>

            {REPORT_TYPE_CARDS.map((card) => (
              <Pressable
                key={card.id}
                onPress={() => router.push(reportDetailPath(card.id, activeFilters))}
                accessibilityRole="button"
                accessibilityLabel={`${card.label}. ${card.description}`}
                style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
              >
                <Card style={{ marginBottom: theme.spacing.sm }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: theme.colors.tintMuted,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <FontAwesome name={card.icon} size={18} color={theme.colors.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>{card.label}</Text>
                      <Text style={{ color: theme.colors.textMuted, fontSize: 13, marginTop: 2 }}>
                        {card.description}
                      </Text>
                      {card.id === "overview" && previewNet != null ? (
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                          Net {formatSignedAmount(previewNet)} this month
                        </Text>
                      ) : null}
                      {card.id === "spending" && expenseCategoryCount != null && expenseCategoryCount > 0 ? (
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                          {expenseCategoryCount} expense categories
                        </Text>
                      ) : null}
                      {card.id === "debt" && dataMatchesMonth && data?.debt.total_interest_paid ? (
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                          {formatCurrency(data.debt.total_interest_paid)} interest this month
                        </Text>
                      ) : null}
                    </View>
                    <FontAwesome name="chevron-right" size={14} color={theme.colors.textMuted} />
                  </View>
                </Card>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      <ReportFiltersSheet
        visible={filterSheetOpen}
        applied={filters}
        onClose={() => setFilterSheetOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFilterSheetOpen(false);
        }}
      />
    </Screen>
  );
}
