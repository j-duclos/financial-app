import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteTransaction,
  getTimeline,
  getTransaction,
  skipTransactionOccurrence,
  updateTransaction,
} from "@budget-app/api-client";
import { getEffectiveDisplayName, scheduledRowHasMatchingImport } from "@budget-app/shared";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  AppHeader,
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  CurrencyDisplay,
  ErrorState,
  Screen,
  SkeletonBlock,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay, todayStr } from "@/lib/dates";
import { matchingImportTimelineRange } from "@/lib/transactionsLedger";
import { resolveHouseholdId } from "@/lib/householdContext";
import {
  canChangeTransactionCategory,
  isTransferTransaction,
  resolveTransactionStatusIcons,
  STATUS_ICON_LABELS,
  transactionEditLockMessage,
} from "@/lib/transactionStatus";
import { describeApiError } from "@/services/api";
import { refreshAfterTransactionEdit } from "@/lib/financialQueryRefresh";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import { transactionQueryKeys } from "./queryKeys";
import { transactionToMatchingTimelineRow } from "./transactionMatchingTimeline";
import {
  canOpenRecurringRuleDetail,
  getTransactionDetailActions,
  recurringRuleDetailPath,
  type TransactionDetailAction,
} from "./transactionDetailActions";

const MATCHING_IMPORT_FORECAST_DAYS = 30;

export function TransactionDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const txnId = Number(id);
  const [confirmAction, setConfirmAction] = useState<TransactionDetailAction | null>(null);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const savingRef = useRef(false);

  const query = useQuery({
    queryKey: transactionQueryKeys.detail(txnId),
    queryFn: () => getTransaction(txnId),
    enabled: Number.isInteger(txnId) && txnId > 0,
  });

  const txn = query.data;
  const initialCategoryId = txn?.category?.id ?? txn?.category_id ?? null;

  useEffect(() => {
    if (txn) setCategoryId(txn.category?.id ?? txn.category_id ?? null);
  }, [txn?.id, initialCategoryId]);

  const { householdId: defaultHouseholdId } = useDefaultHouseholdId();
  const { accounts } = useAccountOptions({ householdId: defaultHouseholdId });
  const householdId = useMemo(() => {
    const fromAccount = txn?.account?.household?.id;
    if (fromAccount != null) return fromAccount;
    return resolveHouseholdId(
      defaultHouseholdId,
      txn?.account?.id ?? txn?.account_id ?? null,
      accounts
    );
  }, [txn, defaultHouseholdId, accounts]);

  const { categories } = useCategoryOptions({ householdId });

  const categoryDirty =
    txn != null && (categoryId ?? null) !== (txn.category?.id ?? txn.category_id ?? null);

  const selectedCategoryName = useMemo(() => {
    if (categoryId == null) return "Uncategorized";
    const match = categories.find((c) => c.id === categoryId);
    if (match) return match.name;
    return txn?.category?.name ?? "Uncategorized";
  }, [categoryId, categories, txn?.category?.name]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteTransaction(txnId),
    onSuccess: () => {
      refreshAfterTransactionEdit(queryClient);
      router.back();
    },
    onError: (err) => Alert.alert("Delete failed", describeApiError(err)),
  });

  const skipMutation = useMutation({
    mutationFn: () => skipTransactionOccurrence(txnId),
    onSuccess: () => {
      refreshAfterTransactionEdit(queryClient);
      router.back();
    },
    onError: (err) => Alert.alert("Could not skip occurrence", describeApiError(err)),
  });

  const lockMessage = txn ? transactionEditLockMessage(txn, getEffectiveDisplayName(txn.account)) : null;
  const isPlanned = (txn?.status ?? "").toUpperCase() === "PLANNED";
  const canChangeCategory = txn ? canChangeTransactionCategory(txn) : false;

  const matchingTimelineRange = useMemo(
    () => matchingImportTimelineRange(MATCHING_IMPORT_FORECAST_DAYS),
    []
  );

  const timelineQuery = useQuery({
    queryKey: transactionQueryKeys.timeline({
      start: matchingTimelineRange.start,
      end: matchingTimelineRange.end,
      account_id: txn?.account?.id ?? txn?.account_id,
    }),
    queryFn: () =>
      getTimeline({
        start: matchingTimelineRange.start,
        end: matchingTimelineRange.end,
        as_of: todayStr(),
        account_id: txn?.account?.id ?? txn?.account_id ?? undefined,
      }),
    enabled: isPlanned && (txn?.account?.id ?? txn?.account_id) != null,
    staleTime: 60_000,
  });

  const hasMatchingImport = useMemo(() => {
    if (!txn || !isPlanned) return false;
    const timeline = timelineQuery.data?.timeline ?? [];
    if (timeline.length === 0) return false;
    return scheduledRowHasMatchingImport(transactionToMatchingTimelineRow(txn), timeline);
  }, [txn, isPlanned, timelineQuery.data?.timeline]);

  const detailActions = useMemo(() => {
    if (!txn) return [];
    return getTransactionDetailActions({ txn, hasMatchingImport });
  }, [txn, hasMatchingImport]);

  const goBackAfterOptionalCategorySave = useCallback(async () => {
    if (savingRef.current) return;
    if (!txn || !categoryDirty || !canChangeCategory) {
      router.back();
      return;
    }
    savingRef.current = true;
    setSavingCategory(true);
    try {
      await updateTransaction(txnId, { category_id: categoryId });
      refreshAfterTransactionEdit(queryClient, { categoryOnly: true });
      router.back();
    } catch (err) {
      Alert.alert("Could not save category", describeApiError(err));
    } finally {
      savingRef.current = false;
      setSavingCategory(false);
    }
  }, [txn, categoryDirty, canChangeCategory, txnId, categoryId, queryClient, router]);

  const runAction = useCallback(
    (action: TransactionDetailAction) => {
      if (action.kind === "edit") {
        router.push(`/transaction/edit/${txnId}`);
        return;
      }
      if (action.kind === "matchedImport" || action.kind === "skip") {
        if (action.kind === "skip" && action.confirmationTitle) {
          setConfirmAction(action);
          return;
        }
        skipMutation.mutate();
        return;
      }
      if (action.kind === "delete") {
        setConfirmAction(action);
      }
    },
    [router, txnId, skipMutation]
  );

  if (query.isLoading) {
    return (
      <Screen scroll>
        <AppHeader title="Transaction" onBack={() => router.back()} />
        <SkeletonBlock lines={4} />
      </Screen>
    );
  }

  if (query.isError || !txn) {
    return (
      <Screen scroll>
        <AppHeader title="Transaction" onBack={() => router.back()} />
        <ErrorState message={describeApiError(query.error)} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const statusIcons = resolveTransactionStatusIcons(txn);
  const transfer = isTransferTransaction(txn);
  const showRecurringRuleLink = canOpenRecurringRuleDetail(txn);

  return (
    <Screen scroll>
      <AppHeader
        title="Transaction"
        onBack={() => void goBackAfterOptionalCategorySave()}
        right={
          savingCategory ? <ActivityIndicator color={theme.colors.tint} /> : undefined
        }
      />
      <Card>
        <Text style={{ color: theme.colors.text, ...theme.typography.headline }}>{txn.payee}</Text>
        <CurrencyDisplay amount={txn.amount} style={{ marginTop: 8 }} />
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
          {formatDateDisplay(txn.date)}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {statusIcons.map((icon) => (
            <StatusChip key={icon} label={STATUS_ICON_LABELS[icon]} tone="neutral" />
          ))}
          {txn.cleared ? <StatusChip label="Cleared" tone="positive" /> : <StatusChip label="Pending" tone="warning" />}
        </View>
      </Card>

      <Card style={{ marginTop: theme.spacing.md }}>
        <DetailRow label="Account" value={getEffectiveDisplayName(txn.account)} />
        {canChangeCategory ? (
          <Pressable
            onPress={() => setCategorySheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Category: ${selectedCategoryName}. Tap to change.`}
            style={{
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Category</Text>
              <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 2 }}>
                {selectedCategoryName}
              </Text>
            </View>
            <FontAwesome name="chevron-down" size={12} color={theme.colors.textMuted} />
          </Pressable>
        ) : (
          <DetailRow label="Category" value={txn.category?.name ?? "Uncategorized"} />
        )}
        {txn.memo ? <DetailRow label="Notes" value={txn.memo} /> : null}
        <DetailRow label="Source" value={txn.source ?? "Manual"} />
        {transfer && txn.transfer_to_account ? (
          <DetailRow label="Transfer to" value={getEffectiveDisplayName(txn.transfer_to_account)} />
        ) : null}
        {txn.linked_transaction_id ? (
          <DetailRow label="Linked transfer leg" value="See paired transaction" />
        ) : null}
        {showRecurringRuleLink ? (
          <Pressable
            onPress={() => router.push(recurringRuleDetailPath(txn.rule_id!))}
            accessibilityRole="button"
            accessibilityLabel="Recurring rule. Tap to open rule detail."
            style={{
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                Recurring rule
              </Text>
              <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 2 }}>
                Linked to scheduled rule
              </Text>
            </View>
            <FontAwesome name="chevron-right" size={12} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </Card>

      {lockMessage ? (
        <Text style={{ color: theme.colors.warning, ...theme.typography.caption, marginTop: theme.spacing.md }}>
          {lockMessage}
        </Text>
      ) : null}

      <View style={{ gap: 8, marginTop: theme.spacing.xl }}>
        {detailActions.map((action) => (
          <Button
            key={action.kind}
            label={action.label}
            variant={
              action.destructive ? "danger" : action.kind === "skip" ? "secondary" : "primary"
            }
            onPress={() => runAction(action)}
            loading={
              (action.kind === "skip" || action.kind === "matchedImport") && skipMutation.isPending
                ? true
                : action.kind === "delete" && deleteMutation.isPending
            }
          />
        ))}
      </View>

      <BottomSheet
        visible={categorySheetOpen}
        title="Category"
        onClose={() => setCategorySheetOpen(false)}
      >
        <ScrollView>
          <Pressable
            onPress={() => {
              setCategoryId(null);
              setCategorySheetOpen(false);
            }}
            style={{
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Text
              style={{
                color: categoryId == null ? theme.colors.tint : theme.colors.text,
                ...theme.typography.bodyStrong,
              }}
            >
              Uncategorized
            </Text>
          </Pressable>
          {categories.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => {
                setCategoryId(c.id);
                setCategorySheetOpen(false);
              }}
              style={{
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Text
                style={{
                  color: categoryId === c.id ? theme.colors.tint : theme.colors.text,
                  ...theme.typography.bodyStrong,
                }}
              >
                {c.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>

      <ConfirmDialog
        visible={confirmAction != null}
        title={confirmAction?.confirmationTitle ?? "Confirm"}
        message={confirmAction?.confirmationMessage ?? ""}
        confirmLabel={confirmAction?.kind === "skip" ? "Skip" : "Delete"}
        destructive={confirmAction?.destructive === true}
        loading={confirmAction?.kind === "delete" ? deleteMutation.isPending : skipMutation.isPending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction?.kind === "delete") {
            deleteMutation.mutate();
            return;
          }
          if (confirmAction?.kind === "skip") {
            skipMutation.mutate();
          }
        }}
      />
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>{label}</Text>
      <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 2 }}>{value}</Text>
    </View>
  );
}
