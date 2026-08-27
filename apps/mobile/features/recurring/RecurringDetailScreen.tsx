import React, { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteRule,
  getBillsOverview,
  getRule,
  pauseRule,
  resumeRule,
} from "@budget-app/api-client";
import { getEffectiveDisplayName } from "@budget-app/shared";
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  CurrencyDisplay,
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
import { recurringQueryKeys } from "./queryKeys";
import {
  amountDisplayForRule,
  cadenceLabel,
  currentMonthKey,
  directionLabel,
  formatRecurringDate,
  lifecycleBadgeLabel,
  resolveNextOccurrence,
  ruleLifecycleStatus,
} from "./recurringDisplay";

export function RecurringDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ruleId = Number(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const month = currentMonthKey();

  const ruleQuery = useQuery({
    queryKey: recurringQueryKeys.detail(ruleId),
    queryFn: () => getRule(ruleId),
    enabled: Number.isInteger(ruleId) && ruleId > 0,
  });

  const overviewQuery = useQuery({
    queryKey: recurringQueryKeys.billsOverview(month),
    queryFn: () => getBillsOverview({ month, months_before: 0, months_after: 2 }),
    staleTime: 60_000,
  });

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
  const today = todayStr();
  const lifecycle = rule ? ruleLifecycleStatus(rule, today) : "inactive";
  const statusBadge = lifecycleBadgeLabel(lifecycle);
  const amountDisplay = rule ? amountDisplayForRule(rule) : null;
  const nextOccurrence = rule
    ? resolveNextOccurrence(
        rule,
        today,
        overviewQuery.data?.checklist.items.find((i) => i.rule_id === ruleId)?.due_date ?? null
      )
    : null;

  const upcoming = useMemo(() => {
    const items = overviewQuery.data?.checklist.items ?? [];
    return items
      .filter((item) => item.rule_id === ruleId && item.due_date > today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .slice(0, 5);
  }, [overviewQuery.data?.checklist.items, ruleId, today]);

  if (ruleQuery.isLoading) {
    return (
      <Screen scroll={false}>
        <SkeletonBlock lines={4} />
      </Screen>
    );
  }

  if (ruleQuery.isError || !rule || !amountDisplay) {
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
            onPress={() => router.push(`/recurring/edit/${rule.id}`)}
          />
        }
      />

      <ScrollView contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: 32 }}>
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <StatusChip label={directionLabel(rule.direction)} />
            {statusBadge ? <StatusChip label={statusBadge} tone="warning" /> : null}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
            <Text style={{ color: theme.colors.textMuted, fontSize: 14 }}>Amount</Text>
            <CurrencyDisplay
              amount={amountDisplay.signed}
              currency={rule.currency}
              tone={amountDisplay.tone}
              showSign={amountDisplay.showSign}
              style={{ fontSize: 16 }}
            />
          </View>
          <DetailRow label="Account" value={getEffectiveDisplayName(rule.account)} />
          {rule.transfer_to_account ? (
            <DetailRow label="Transfer to" value={getEffectiveDisplayName(rule.transfer_to_account)} />
          ) : null}
          {rule.category && rule.direction !== "TRANSFER" ? (
            <DetailRow label="Category" value={rule.category.name} />
          ) : null}
          <DetailRow label="Frequency" value={cadenceLabel(rule)} />
          <DetailRow label="Start" value={formatDateDisplay(rule.start_date)} />
          <DetailRow label="Ends" value={rule.end_date ? formatDateDisplay(rule.end_date) : "Never"} />
          <DetailRow label="Next occurrence" value={formatRecurringDate(nextOccurrence)} />
          {rule.notes ? <DetailRow label="Notes" value={rule.notes} /> : null}
          {rule.scheduled_change ? (
            <Text style={{ color: theme.colors.warning, marginTop: 8, fontSize: 13 }}>
              Scheduled change effective {formatDateDisplay(rule.scheduled_change.effective_from)}
            </Text>
          ) : null}
        </Card>

        {upcoming.length > 0 ? (
          <Card padded={false}>
            <View style={{ padding: theme.spacing.lg, paddingBottom: 0 }}>
              <SectionHeader title="Upcoming" subtitle="From bills forecast" />
            </View>
            {upcoming.map((p) => (
              <View
                key={p.id}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.sm,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.text }}>{formatRecurringDate(p.due_date)}</Text>
                <CurrencyDisplay
                  amount={amountDisplay.signed}
                  currency={rule.currency}
                  tone={amountDisplay.tone}
                  showSign={amountDisplay.showSign}
                  style={{ fontSize: 14 }}
                />
              </View>
            ))}
          </Card>
        ) : null}

        <View style={{ gap: 8 }}>
          {lifecycle === "active" ? (
            <Button
              label="Pause recurrence"
              variant="secondary"
              loading={pauseMutation.isPending}
              onPress={() => pauseMutation.mutate()}
            />
          ) : rule.paused_at || lifecycle === "paused" || lifecycle === "inactive" ? (
            <Button
              label="Resume recurrence"
              loading={resumeMutation.isPending}
              onPress={() => resumeMutation.mutate()}
            />
          ) : null}
          <Button label="Delete rule" variant="danger" onPress={() => setConfirmDelete(true)} />
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete recurring rule?"
        message="Future forecast occurrences will disappear. Historical transactions stay linked but the rule is removed. This cannot be undone."
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
