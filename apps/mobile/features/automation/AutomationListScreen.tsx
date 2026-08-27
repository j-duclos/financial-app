import React, { useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listRules, pauseRule, resumeRule } from "@budget-app/api-client";
import {
  AppHeader,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { todayStr } from "@/lib/dates";
import { describeApiError } from "@/services/api";
import { invalidateRecurringRuleDependents } from "@/lib/financialQueryRefresh";
import { automationQueryKeys } from "./queryKeys";
import {
  AUTOMATION_PAGE_INTRO,
  RULE_SECTIONS,
  buildAutomationRows,
  estimatedMonthlyCashFlow,
  formatMonthlySubtotal,
  getRuleLifecycleStatus,
  groupAutomationRows,
  sectionMonthlySubtotal,
} from "./automationDisplay";
import { AutomationRuleCard } from "./components/AutomationRuleCard";

type SectionListItem =
  | { type: "section"; key: string; label: string; subtotal: number; currency: string; note?: string }
  | { type: "rule"; key: string; ruleId: number };

export function AutomationListScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const today = todayStr();
  const [search, setSearch] = useState("");
  const [togglingRuleId, setTogglingRuleId] = useState<number | null>(null);

  const rulesQuery = useQuery({
    queryKey: automationQueryKeys.list(),
    queryFn: () => listRules(),
    staleTime: 60_000,
  });

  const rules = rulesQuery.data?.results ?? [];
  const rows = useMemo(() => buildAutomationRows(rules, today), [rules, today]);
  const grouped = useMemo(() => groupAutomationRows(rows, search), [rows, search]);
  const monthlyCashFlow = useMemo(
    () => estimatedMonthlyCashFlow(rules, (rule) => getRuleLifecycleStatus(rule, today) === "running"),
    [rules, today]
  );
  const cashFlowCurrency =
    rules.find((r) => getRuleLifecycleStatus(r, today) === "running")?.currency ?? "USD";

  const listData = useMemo(() => {
    const items: SectionListItem[] = [];
    for (const section of RULE_SECTIONS) {
      const sectionRows = grouped[section.key];
      if (sectionRows.length === 0) continue;
      const subtotal = sectionMonthlySubtotal(
        sectionRows.map((r) => r.rule),
        (rule) => getRuleLifecycleStatus(rule, today) === "running"
      );
      const currency =
        sectionRows.find((r) => getRuleLifecycleStatus(r.rule, today) === "running")?.rule.currency ??
        "USD";
      items.push({
        type: "section",
        key: `section-${section.key}`,
        label: section.label,
        subtotal,
        currency,
        note:
          section.key === "credit_card_charges"
            ? "Not included in cash flow — pay the card from a bank account"
            : undefined,
      });
      for (const row of sectionRows) {
        items.push({ type: "rule", key: `rule-${row.rule.id}`, ruleId: row.rule.id });
      }
    }
    return items;
  }, [grouped, today]);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.rule.id, r])), [rows]);

  const toggleMutation = useMutation({
    mutationFn: async ({ ruleId, enable }: { ruleId: number; enable: boolean }) => {
      setTogglingRuleId(ruleId);
      if (enable) {
        return resumeRule(ruleId);
      }
      return pauseRule(ruleId);
    },
    onSuccess: () => {
      invalidateRecurringRuleDependents(queryClient);
    },
    onError: () => {
      void rulesQuery.refetch();
    },
    onSettled: () => {
      setTogglingRuleId(null);
    },
  });

  const isLoading = rulesQuery.isLoading;
  const isError = rulesQuery.isError;
  const isFetching = rulesQuery.isFetching;

  const refetch = () => {
    void rulesQuery.refetch();
  };

  return (
    <Screen scroll={false} contentStyle={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <AppHeader
          title="Rules & Automation"
          showBack
          right={
            <IconButton
              name="plus"
              accessibilityLabel="Create automation rule"
              onPress={() => router.push("/automation/new")}
            />
          }
        />
        <Text style={{ color: theme.colors.textSecondary, marginBottom: 12, ...theme.typography.body }}>
          {AUTOMATION_PAGE_INTRO}
        </Text>

        {rules.length > 0 ? (
          <Card style={{ marginBottom: 12 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "600", marginBottom: 4 }}>
              Estimated monthly cash flow
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginBottom: 8 }}>
              Running rules only. Excludes internal transfers and credit card charges.
            </Text>
            <Text
              style={{
                fontSize: 22,
                fontWeight: "700",
                color:
                  monthlyCashFlow > 0
                    ? theme.colors.moneyPositive
                    : monthlyCashFlow < 0
                      ? theme.colors.moneyNegative
                      : theme.colors.textSecondary,
              }}
            >
              {formatMonthlySubtotal(monthlyCashFlow, cashFlowCurrency)}
              <Text style={{ fontSize: 14, fontWeight: "400", color: theme.colors.textMuted }}> / mo</Text>
            </Text>
          </Card>
        ) : null}

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search automation by name…"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Search automation rules"
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            marginBottom: 8,
          }}
        />
      </View>

      {isLoading ? (
        <View style={{ padding: theme.spacing.lg, gap: 8 }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
      ) : isError ? (
        <ErrorState message={describeApiError(rulesQuery.error)} onRetry={refetch} />
      ) : rules.length === 0 ? (
        <EmptyState
          title="No automation rules yet"
          message="Create automations to handle repetitive financial tasks automatically."
          actionLabel="Create automation"
          onAction={() => router.push("/automation/new")}
        />
      ) : listData.length === 0 ? (
        <EmptyState
          title="No matches"
          message={`No automation matches "${search.trim()}".`}
        />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.key}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />
          }
          renderItem={({ item }) => {
            if (item.type === "section") {
              return (
                <View
                  style={{
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.sm,
                    backgroundColor: theme.colors.surfaceMuted,
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textSecondary, fontWeight: "700", fontSize: 12 }}>
                      {item.label.toUpperCase()}
                    </Text>
                    {item.note ? (
                      <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 2 }}>
                        {item.note}
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    style={{
                      color:
                        item.subtotal < 0
                          ? theme.colors.moneyNegative
                          : item.subtotal > 0
                            ? theme.colors.moneyPositive
                            : theme.colors.textMuted,
                      fontWeight: "600",
                      fontSize: 13,
                    }}
                  >
                    {formatMonthlySubtotal(item.subtotal, item.currency)}
                  </Text>
                </View>
              );
            }

            const row = rowById.get(item.ruleId);
            if (!row) return null;

            return (
              <AutomationRuleCard
                row={row}
                onPress={() => router.push(`/automation/${row.rule.id}`)}
                toggleDisabled={togglingRuleId === row.rule.id}
                onToggleEnabled={(enabled) => {
                  if (row.lifecycle === "ended") return;
                  toggleMutation.mutate({ ruleId: row.rule.id, enable: enabled });
                }}
              />
            );
          }}
          contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        />
      )}
    </Screen>
  );
}
