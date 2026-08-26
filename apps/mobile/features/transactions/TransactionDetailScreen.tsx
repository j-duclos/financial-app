import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  confirmTransaction,
  deleteTransaction,
  getTransaction,
  skipTransactionOccurrence,
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
  SkeletonBlock,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay } from "@/lib/dates";
import {
  isTransferTransaction,
  resolveTransactionStatusIcons,
  STATUS_ICON_LABELS,
  transactionEditLockMessage,
} from "@/lib/transactionStatus";
import { describeApiError } from "@/services/api";
import { refreshAfterTransactionEdit } from "@/lib/financialQueryRefresh";
import { transactionQueryKeys } from "./queryKeys";

export function TransactionDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const txnId = Number(id);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const query = useQuery({
    queryKey: transactionQueryKeys.detail(txnId),
    queryFn: () => getTransaction(txnId),
    enabled: Number.isInteger(txnId) && txnId > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTransaction(txnId),
    onSuccess: () => {
      refreshAfterTransactionEdit(queryClient, { refreshAccounts: true });
      router.back();
    },
    onError: (err) => Alert.alert("Delete failed", describeApiError(err)),
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirmTransaction(txnId),
    onSuccess: () => {
      refreshAfterTransactionEdit(queryClient, { refreshAccounts: true });
      void query.refetch();
    },
    onError: (err) => Alert.alert("Confirm failed", describeApiError(err)),
  });

  const skipMutation = useMutation({
    mutationFn: () => skipTransactionOccurrence(txnId),
    onSuccess: () => {
      refreshAfterTransactionEdit(queryClient, { refreshAccounts: true });
      router.back();
    },
    onError: (err) => Alert.alert("Skip failed", describeApiError(err)),
  });

  const txn = query.data;
  const lockMessage = txn ? transactionEditLockMessage(txn, getEffectiveDisplayName(txn.account)) : null;
  const isPlanned = (txn?.status ?? "").toUpperCase() === "PLANNED";
  const canEdit = txn && !txn.reconciled && !lockMessage?.includes("Imported");

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

  return (
    <Screen scroll>
      <AppHeader title="Transaction" onBack={() => router.back()} />
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
        <DetailRow label="Category" value={txn.category?.name ?? "Uncategorized"} />
        {txn.memo ? <DetailRow label="Notes" value={txn.memo} /> : null}
        <DetailRow label="Source" value={txn.source ?? "Manual"} />
        {transfer && txn.transfer_to_account ? (
          <DetailRow label="Transfer to" value={getEffectiveDisplayName(txn.transfer_to_account)} />
        ) : null}
        {txn.linked_transaction_id ? (
          <DetailRow label="Linked transfer leg" value="See paired transaction" />
        ) : null}
        {txn.rule_id ? <DetailRow label="Recurring rule" value="Linked to scheduled rule" /> : null}
      </Card>

      {lockMessage ? (
        <Text style={{ color: theme.colors.warning, ...theme.typography.caption, marginTop: theme.spacing.md }}>
          {lockMessage}
        </Text>
      ) : null}

      <View style={{ gap: 8, marginTop: theme.spacing.xl }}>
        {canEdit ? (
          <Button label="Edit" onPress={() => router.push(`/transaction/edit/${txn.id}`)} />
        ) : null}
        {isPlanned ? (
          <>
            <Button label="Confirm posted" onPress={() => confirmMutation.mutate()} loading={confirmMutation.isPending} />
            <Button label="Skip occurrence" variant="secondary" onPress={() => skipMutation.mutate()} loading={skipMutation.isPending} />
          </>
        ) : null}
        {!txn.reconciled ? (
          <Button label="Delete" variant="danger" onPress={() => setDeleteOpen(true)} />
        ) : null}
      </View>

      <ConfirmDialog
        visible={deleteOpen}
        title="Delete transaction"
        message={
          transfer
            ? "This may delete or unlink both sides of the transfer, depending on account settings."
            : "This transaction will be permanently removed."
        }
        destructive
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
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
