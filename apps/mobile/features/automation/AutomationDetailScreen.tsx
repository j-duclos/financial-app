import React, { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteRule,
  getRule,
  listTransactions,
  pauseRule,
  resumeRule,
} from "@budget-app/api-client";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonBlock,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { invalidateRecurringRuleDependents } from "@/lib/financialQueryRefresh";
import { formatDateDisplay, todayStr } from "@/lib/dates";
import { automationQueryKeys } from "./queryKeys";
import {
  actionSummary,
  buildExecutionHistoryRow,
  formatNextRunDate,
  getRuleLifecycleStatus,
  lifecycleStatusLabel,
  lifecycleStatusTone,
  resolveAutomationNextRun,
  triggerSummary,
} from "./automationDisplay";
import { ExecutionHistoryRowView } from "./components/ExecutionHistoryRow";
import { RuleSummaryCard } from "./components/RuleSummaryCard";

const HISTORY_PAGE_SIZE = 25;

export function AutomationDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ruleId = Number(id);
  const today = todayStr();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const ruleQuery = useQuery({
    queryKey: automationQueryKeys.detail(ruleId),
    queryFn: () => getRule(ruleId),
    enabled: Number.isInteger(ruleId) && ruleId > 0,
  });

  const historyQuery = useInfiniteQuery({
    queryKey: automationQueryKeys.history(ruleId, 0),
    queryFn: ({ pageParam }) =>
      listTransactions({
        rule_id: ruleId,
        page: pageParam,
        page_size: HISTORY_PAGE_SIZE,
        show_reconciled: true,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.next ? lastPageParam + 1 : undefined,
    enabled: Number.isInteger(ruleId) && ruleId > 0,
  });

  const historyTransactions = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.results) ?? [],
    [historyQuery.data?.pages]
  );

  const pauseMutation = useMutation({
    mutationFn: () => pauseRule(ruleId),
    onSuccess: () => {
      invalidateRecurringRuleDependents(queryClient);
      void ruleQuery.refetch();
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeRule(ruleId),
    onSuccess: () => {
      invalidateRecurringRuleDependents(queryClient);
      void ruleQuery.refetch();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRule(ruleId),
    onSuccess: () => {
      invalidateRecurringRuleDependents(queryClient);
      router.back();
    },
  });

  const rule = ruleQuery.data;
  const lifecycle = rule ? getRuleLifecycleStatus(rule, today) : "paused";
  const nextRun = rule ? resolveAutomationNextRun(rule, today) : null;

  const historyRows = useMemo(
    () => historyTransactions.map(buildExecutionHistoryRow),
    [historyTransactions]
  );

  const hasMoreHistory = Boolean(historyQuery.hasNextPage);

  if (ruleQuery.isLoading) {
    return (
      <Screen scroll={false}>
        <SkeletonBlock lines={4} />
      </Screen>
    );
  }

  if (ruleQuery.isError || !rule) {
    return (
      <Screen scroll={false}>
        <ErrorState message={describeApiError(ruleQuery.error)} onRetry={() => ruleQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <AppHeader
        title={rule.name}
        onBack={() => router.back()}
        right={
          <Button
            label="Edit"
            variant="secondary"
            onPress={() => router.push(`/automation/edit/${rule.id}`)}
          />
        }
      />

      <ScrollView contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: 32 }}>
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <StatusChip label={lifecycleStatusLabel(lifecycle)} tone={lifecycleStatusTone(lifecycle)} />
            {rule.is_bill ? <StatusChip label="Bill checklist" tone="neutral" /> : null}
          </View>
          <DetailRow label="Amount" value={formatCurrency(rule.amount, rule.currency)} />
          <DetailRow label="Account" value={getEffectiveDisplayName(rule.account)} />
          {rule.transfer_to_account ? (
            <DetailRow label="Transfer to" value={getEffectiveDisplayName(rule.transfer_to_account)} />
          ) : null}
          {rule.category ? <DetailRow label="Category" value={rule.category.name} /> : null}
          <DetailRow label="Trigger" value={triggerSummary(rule)} />
          <DetailRow label="Action" value={actionSummary(rule)} />
          <DetailRow label="Start" value={formatDateDisplay(rule.start_date)} />
          {rule.end_date ? <DetailRow label="End" value={formatDateDisplay(rule.end_date)} /> : null}
          <DetailRow label="Next run" value={formatNextRunDate(nextRun)} />
          <DetailRow label="Created" value={formatDateDisplay(rule.created_at)} />
          <DetailRow label="Updated" value={formatDateDisplay(rule.updated_at)} />
          {rule.paused_at ? (
            <DetailRow label="Paused since" value={formatDateDisplay(rule.paused_at)} />
          ) : null}
          {rule.notes ? <DetailRow label="Notes" value={rule.notes} /> : null}
          {rule.scheduled_change ? (
            <Text style={{ color: theme.colors.warning, marginTop: 8, fontSize: 13 }}>
              Scheduled change effective {formatDateDisplay(rule.scheduled_change.effective_from)}
            </Text>
          ) : null}
        </Card>

        <RuleSummaryCard rule={rule} />

        <Card padded={false}>
          <View style={{ padding: theme.spacing.lg, paddingBottom: 0 }}>
            <SectionHeader
              title="Recent activity"
              subtitle="Transactions created by this rule on the server"
            />
          </View>
          {historyQuery.isLoading ? (
            <View style={{ padding: theme.spacing.lg }}>
              <ActivityIndicator color={theme.colors.tint} />
            </View>
          ) : historyQuery.isError ? (
            <View style={{ padding: theme.spacing.lg }}>
              <Text style={{ color: theme.colors.critical, marginBottom: 8 }}>
                {describeApiError(historyQuery.error)}
              </Text>
              <Button label="Retry" variant="secondary" onPress={() => historyQuery.refetch()} />
            </View>
          ) : historyRows.length === 0 ? (
            <Text style={{ color: theme.colors.textMuted, padding: theme.spacing.lg, fontSize: 13 }}>
              No materialized transactions yet. Future occurrences are projected by the backend when the rule runs.
            </Text>
          ) : (
            <>
              {historyRows.map((row) => (
                <ExecutionHistoryRowView
                  key={row.transaction.id}
                  row={row}
                  onPress={() => router.push(`/transaction/${row.transaction.id}`)}
                />
              ))}
              {hasMoreHistory ? (
                <View style={{ padding: theme.spacing.md }}>
                  <Button
                    label="Load more activity"
                    variant="secondary"
                    loading={historyQuery.isFetchingNextPage}
                    onPress={() => historyQuery.fetchNextPage()}
                  />
                </View>
              ) : null}
            </>
          )}
        </Card>

        <View style={{ gap: 8 }}>
          {lifecycle === "running" ? (
            <Button
              label="Pause rule"
              variant="secondary"
              loading={pauseMutation.isPending}
              onPress={() => pauseMutation.mutate()}
            />
          ) : lifecycle === "paused" ? (
            <Button
              label="Resume rule"
              loading={resumeMutation.isPending}
              onPress={() => resumeMutation.mutate()}
            />
          ) : null}
          <Button label="Delete rule" variant="danger" onPress={() => setConfirmDelete(true)} />
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete automation rule?"
        message="Future rule executions will stop. Previously completed transactions and history remain. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 12 }}>
      <Text style={{ color: theme.colors.textMuted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontWeight: "600", flex: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}
