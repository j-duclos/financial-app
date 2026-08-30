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
import { formatCurrency, getEffectiveDisplayName, selectableImportMatchCandidates } from "@budget-app/shared";
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
import { formatDateDisplay } from "@/lib/dates";
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
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import { transactionQueryKeys } from "./queryKeys";
import {
  canOpenRecurringRuleDetail,
  getTransactionDetailActions,
  isAlreadyMatchedToImport,
  isEligibleForImportMatch,
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
    onError: (err) => Alert.alert("Could not match import", describeApiError(err)),
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

  const statusIcons = resolveTransactionStatusIcons(txn);
  const transfer = isTransferTransaction(txn);
  const showRecurringRuleLink = canOpenRecurringRuleDetail(txn);
  const alreadyMatched = isAlreadyMatchedToImport(txn);

  return (
    <Screen scroll>
      <AppHeader
        title="Transaction"
        onBack={() => router.back()}
        right={
          categoryMutation.isPending ? (
            <ActivityIndicator color={theme.colors.tint} />
          ) : undefined
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
          {alreadyMatched ? (
            <StatusChip label="Matched to bank import" tone="positive" />
          ) : null}
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
              action.kind === "skip" && skipMutation.isPending
                ? true
                : action.kind === "matchImport" && matchMutation.isPending
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
        visible={matchSheetOpen}
        title="Match imported transaction"
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
              No unmatched bank imports were found for this scheduled payment.
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
              Select the bank import that matches this scheduled payment.
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
