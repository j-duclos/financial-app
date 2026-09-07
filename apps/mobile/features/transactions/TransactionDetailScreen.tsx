import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteTransaction,
  getTransaction,
  getTransactionImportCandidates,
  matchTransactionToImport,
  skipTransactionOccurrence,
  updateTransaction,
  type ImportMatchCandidate,
} from "@budget-app/api-client";
import {
  formatCurrency,
  getEffectiveDisplayName,
  MATCH_BANK_TRANSACTION_LABEL,
  selectableImportMatchCandidates,
  transactionSourceDisplayLabel,
} from "@budget-app/shared";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  AppHeader,
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  CurrencyDisplay,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay, todayStr } from "@/lib/dates";
import {
  canChangeTransactionCategory,
  isTransferTransaction,
  resolveTransactionDetailBadges,
  transactionEditLockMessage,
} from "@/lib/transactionStatus";
import { describeApiError } from "@/services/api";
import { refreshAfterTransactionEdit } from "@/lib/financialQueryRefresh";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import { transactionQueryKeys } from "./queryKeys";
import {
  canOpenLinkedTransactionDetail,
  canOpenRecurringRuleDetail,
  getTransactionDetailActions,
  isEligibleForImportMatch,
  linkedTransactionDetailPath,
  recurringRuleDetailPath,
  type TransactionDetailAction,
} from "./transactionDetailActions";

export function TransactionDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const txnId = Number(id);
  const [confirmAction, setConfirmAction] = useState<TransactionDetailAction | null>(null);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [matchSheetOpen, setMatchSheetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingMatchCandidate, setPendingMatchCandidate] = useState<ImportMatchCandidate | null>(
    null
  );
  const [categoryId, setCategoryId] = useState<number | null>(null);

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
  const householdId = useMemo(() => {
    const fromAccount = txn?.account?.household?.id;
    if (fromAccount != null) return fromAccount;
    return defaultHouseholdId ?? null;
  }, [txn?.account?.household?.id, defaultHouseholdId]);

  const canChangeCategory = txn ? canChangeTransactionCategory(txn) : false;

  const { categories } = useCategoryOptions({
    householdId,
    enabled: canChangeCategory && categorySheetOpen,
  });

  const selectedCategoryName = useMemo(() => {
    if (categoryId == null) return "Uncategorized";
    const match = categories.find((c) => c.id === categoryId);
    if (match) return match.name;
    return txn?.category?.name ?? "Uncategorized";
  }, [categoryId, categories, txn?.category?.name]);

  const categoryMutation = useMutation({
    mutationFn: (nextCategoryId: number | null) =>
      updateTransaction(txnId, { category_id: nextCategoryId }),
    onSuccess: (updatedTxn) => {
      setCategoryId(updatedTxn.category?.id ?? updatedTxn.category_id ?? null);
      setCategorySheetOpen(false);
      queryClient.setQueryData(transactionQueryKeys.detail(txnId), updatedTxn);
      refreshAfterTransactionEdit(queryClient, { categoryOnly: true });
    },
    onError: (err) => Alert.alert("Could not save category", describeApiError(err)),
  });

  const finishNavigatingMutation = useCallback(() => {
    queryClient.removeQueries({ queryKey: transactionQueryKeys.detail(txnId) });
    refreshAfterTransactionEdit(queryClient);
    router.back();
  }, [queryClient, txnId, router]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteTransaction(txnId),
    onSuccess: () => {
      finishNavigatingMutation();
    },
    onError: (err) => Alert.alert("Delete failed", describeApiError(err)),
  });

  const skipMutation = useMutation({
    mutationFn: () => skipTransactionOccurrence(txnId),
    onSuccess: () => {
      finishNavigatingMutation();
    },
    onError: (err) => Alert.alert("Could not skip occurrence", describeApiError(err)),
  });

  const matchMutation = useMutation({
    mutationFn: (importedTransactionId: number) =>
      matchTransactionToImport(txnId, importedTransactionId),
    onSuccess: () => {
      setMatchSheetOpen(false);
      setPendingMatchCandidate(null);
      queryClient.removeQueries({ queryKey: transactionQueryKeys.importCandidates(txnId) });
      finishNavigatingMutation();
    },
    onError: (err) => Alert.alert("Could not match bank transaction", describeApiError(err)),
  });

  const lockMessage = txn ? transactionEditLockMessage(txn, getEffectiveDisplayName(txn.account)) : null;
  const eligibleForImportMatch = txn ? isEligibleForImportMatch(txn) : false;

  const importCandidatesQuery = useQuery({
    queryKey: transactionQueryKeys.importCandidates(txnId),
    queryFn: () => getTransactionImportCandidates(txnId),
    enabled: matchSheetOpen && eligibleForImportMatch,
    staleTime: 30_000,
  });

  const selectableCandidates = useMemo(
    () => selectableImportMatchCandidates(importCandidatesQuery.data?.candidates ?? []),
    [importCandidatesQuery.data?.candidates]
  );

  const detailActions = useMemo(() => {
    if (!txn) return [];
    return getTransactionDetailActions({ txn });
  }, [txn]);

  const primaryActions = detailActions.filter((action) => action.placement === "primary");
  const secondaryActions = detailActions.filter((action) => action.placement === "secondary");
  const overflowActions = detailActions.filter((action) => action.placement === "overflow");
  const destructiveActions = detailActions.filter((action) => action.placement === "destructive");

  const runAction = useCallback(
    (action: TransactionDetailAction) => {
      if (action.kind === "edit") {
        router.push(`/transaction/edit/${txnId}`);
        return;
      }
      if (action.kind === "matchImport") {
        setMatchSheetOpen(true);
        return;
      }
      if (action.kind === "skip") {
        if (action.confirmationTitle) {
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

  const selectCategory = useCallback(
    (nextCategoryId: number | null) => {
      if (!canChangeCategory || categoryMutation.isPending) return;
      if ((nextCategoryId ?? null) === (txn?.category?.id ?? txn?.category_id ?? null)) {
        setCategorySheetOpen(false);
        return;
      }
      categoryMutation.mutate(nextCategoryId);
    },
    [canChangeCategory, categoryMutation, txn?.category?.id, txn?.category_id]
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

  const statusBadges = resolveTransactionDetailBadges(txn, todayStr());
  const transfer = isTransferTransaction(txn);
  const showRecurringRuleLink = canOpenRecurringRuleDetail(txn);
  const showLinkedTransaction = canOpenLinkedTransactionDetail(txn);
  const sourceLabel = transactionSourceDisplayLabel(txn);

  const actionLoading = (action: TransactionDetailAction) =>
    action.kind === "skip" && skipMutation.isPending
      ? true
      : action.kind === "matchImport" && matchMutation.isPending
        ? true
        : action.kind === "delete" && deleteMutation.isPending;

  return (
    <Screen scroll>
      <AppHeader
        title="Transaction"
        onBack={() => router.back()}
        right={
          categoryMutation.isPending || overflowActions.length > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {categoryMutation.isPending ? (
                <ActivityIndicator color={theme.colors.tint} />
              ) : null}
              {overflowActions.length > 0 ? (
                <IconButton
                  name="ellipsis-h"
                  accessibilityLabel="More actions"
                  onPress={() => setMoreOpen(true)}
                />
              ) : null}
            </View>
          ) : undefined
        }
      />
      <Card>
        <Text style={{ color: theme.colors.text, ...theme.typography.headline }}>{txn.payee}</Text>
        <CurrencyDisplay amount={txn.amount} style={{ marginTop: 8 }} />
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
          {formatDateDisplay(txn.date)}
        </Text>
        {statusBadges.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            {statusBadges.map((badge) => (
              <StatusChip key={badge.key} label={badge.label} tone={badge.tone} />
            ))}
          </View>
        ) : null}
      </Card>

      <Card style={{ marginTop: theme.spacing.md }}>
        <DetailRow label="Account" value={getEffectiveDisplayName(txn.account)} />
        {canChangeCategory ? (
          <NavDetailRow
            label="Category"
            value={selectedCategoryName}
            chevron="down"
            accessibilityLabel={`Category: ${selectedCategoryName}. Tap to change.`}
            onPress={() => setCategorySheetOpen(true)}
          />
        ) : (
          <DetailRow label="Category" value={txn.category?.name ?? "Uncategorized"} />
        )}
        {txn.memo ? <DetailRow label="Notes" value={txn.memo} /> : null}
        <DetailRow label="Source" value={sourceLabel} />
        {transfer && txn.transfer_to_account ? (
          <DetailRow label="Transfer to" value={getEffectiveDisplayName(txn.transfer_to_account)} />
        ) : null}
        {showLinkedTransaction ? (
          <NavDetailRow
            label="Linked transaction"
            value="View paired transaction"
            chevron="right"
            accessibilityLabel="Linked transaction. View paired transaction."
            onPress={() => router.push(linkedTransactionDetailPath(txn.linked_transaction_id!))}
          />
        ) : null}
        {showRecurringRuleLink ? (
          <NavDetailRow
            label="Recurring rule"
            value="Linked to scheduled rule"
            chevron="right"
            accessibilityLabel="Recurring rule. Tap to open rule detail."
            onPress={() => router.push(recurringRuleDetailPath(txn.rule_id!))}
          />
        ) : null}
      </Card>

      {lockMessage ? (
        <Text style={{ color: theme.colors.warning, ...theme.typography.caption, marginTop: theme.spacing.md }}>
          {lockMessage}
        </Text>
      ) : null}

      <View style={{ gap: 8, marginTop: theme.spacing.xl }}>
        {primaryActions.map((action) => (
          <Button
            key={action.kind}
            label={action.label}
            variant="primary"
            onPress={() => runAction(action)}
            loading={actionLoading(action)}
          />
        ))}
        {secondaryActions.map((action) => (
          <Button
            key={action.kind}
            label={action.label}
            variant="secondary"
            onPress={() => runAction(action)}
            loading={actionLoading(action)}
          />
        ))}
        {destructiveActions.map((action) => (
          <Button
            key={action.kind}
            label={action.label}
            variant="danger"
            onPress={() => runAction(action)}
            loading={actionLoading(action)}
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
            onPress={() => selectCategory(null)}
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
              onPress={() => selectCategory(c.id)}
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

      <BottomSheet
        visible={moreOpen}
        title="More"
        onClose={() => setMoreOpen(false)}
      >
        {overflowActions.map((action) => (
          <Pressable
            key={action.kind}
            onPress={() => {
              setMoreOpen(false);
              runAction(action);
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={{
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </BottomSheet>

      <BottomSheet
        visible={matchSheetOpen}
        title={MATCH_BANK_TRANSACTION_LABEL}
        onClose={() => {
          if (matchMutation.isPending) return;
          setMatchSheetOpen(false);
          setPendingMatchCandidate(null);
        }}
      >
        {importCandidatesQuery.isLoading ? (
          <ActivityIndicator color={theme.colors.tint} style={{ marginVertical: 24 }} />
        ) : importCandidatesQuery.isError ? (
          <ErrorState
            message={describeApiError(importCandidatesQuery.error)}
            onRetry={() => void importCandidatesQuery.refetch()}
          />
        ) : selectableCandidates.length === 0 ? (
          <View style={{ gap: 12, paddingVertical: 8 }}>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.body }}>
              No unmatched bank transactions were found for this scheduled payment.
            </Text>
            <Button
              label="Skip occurrence"
              variant="secondary"
              onPress={() => {
                setMatchSheetOpen(false);
                const skipAction = detailActions.find((a) => a.kind === "skip");
                if (skipAction) runAction(skipAction);
              }}
            />
          </View>
        ) : (
          <ScrollView>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 12 }}>
              Choose the bank transaction that corresponds to this scheduled transaction.
            </Text>
            {selectableCandidates.map((candidate) => (
              <Pressable
                key={candidate.imported_transaction_id}
                onPress={() => setPendingMatchCandidate(candidate)}
                style={{
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                  gap: 4,
                }}
              >
                <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                  {candidate.payee}
                </Text>
                <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                  {formatDateDisplay(candidate.date)} · {formatCurrency(candidate.amount)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmAction != null}
        title={confirmAction?.confirmationTitle ?? "Confirm"}
        message={confirmAction?.confirmationMessage ?? ""}
        confirmLabel={confirmAction?.kind === "skip" ? "Skip" : "Delete"}
        destructive={confirmAction?.destructive === true}
        loading={
          confirmAction?.kind === "delete"
            ? deleteMutation.isPending
            : confirmAction?.kind === "skip"
              ? skipMutation.isPending
              : false
        }
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

      <ConfirmDialog
        visible={pendingMatchCandidate != null}
        title="Confirm match"
        message={
          pendingMatchCandidate
            ? `Link this scheduled payment to ${pendingMatchCandidate.payee} on ${formatDateDisplay(pendingMatchCandidate.date)} for ${formatCurrency(pendingMatchCandidate.amount)}?`
            : ""
        }
        confirmLabel="Match"
        loading={matchMutation.isPending}
        onCancel={() => setPendingMatchCandidate(null)}
        onConfirm={() => {
          if (pendingMatchCandidate) {
            matchMutation.mutate(pendingMatchCandidate.imported_transaction_id);
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

function NavDetailRow({
  label,
  value,
  chevron,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  value: string;
  chevron: "down" | "right";
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>{label}</Text>
        <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 2 }}>{value}</Text>
      </View>
      <FontAwesome
        name={chevron === "down" ? "chevron-down" : "chevron-right"}
        size={12}
        color={theme.colors.textMuted}
      />
    </Pressable>
  );
}
