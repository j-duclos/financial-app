import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getReconciliationSession,
  undoReconciliationSession,
} from "@budget-app/api-client";
import {
  AppHeader,
  Button,
  ConfirmDialog,
  ErrorState,
  Screen,
  SkeletonBlock,
  DetailRow,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { formatReconcileMoney, formatStatementDate, sessionStatusLabel } from "./reconcileDisplay";
import { invalidateAfterReconcileMutation, reconcileQueryKeys } from "./queryKeys";
import { transactionDetailPath } from "./navigation";

export function ReconcileSessionDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const sessionId = id ? Number(id) : NaN;
  const [undoOpen, setUndoOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: reconcileQueryKeys.sessionDetail(sessionId),
    queryFn: () => getReconciliationSession(sessionId),
    enabled: Number.isInteger(sessionId) && sessionId > 0,
  });

  const undoMutation = useMutation({
    mutationFn: () => undoReconciliationSession(sessionId),
    onSuccess: () => {
      invalidateAfterReconcileMutation(queryClient);
      setUndoOpen(false);
      router.back();
    },
    onError: (err) => Alert.alert("Undo failed", describeApiError(err)),
  });

  const session = detailQuery.data;

  if (detailQuery.isLoading) {
    return (
      <Screen scroll>
        <AppHeader title="Reconciliation" showBack onBack={() => router.back()} />
        <SkeletonBlock lines={4} />
      </Screen>
    );
  }

  if (detailQuery.isError || !session) {
    return (
      <Screen scroll>
        <AppHeader title="Reconciliation" showBack onBack={() => router.back()} />
        <ErrorState
          message={describeApiError(detailQuery.error ?? new Error("Not found"))}
          onRetry={() => detailQuery.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <AppHeader title="Reconciliation" showBack onBack={() => router.back()} />

      <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 4 }}>
        {session.account_name}
      </Text>
      <Text style={{ color: theme.colors.textMuted, marginBottom: 16 }}>
        {sessionStatusLabel(session)}
        {session.period_end_date ? ` · through ${formatStatementDate(session.period_end_date)}` : ""}
      </Text>

      <View style={{ gap: 10, marginBottom: 20 }}>
        <DetailRow label="Statement ending" value={formatReconcileMoney(session.bank_balance)} />
        <DetailRow label="Opening balance" value={formatReconcileMoney(session.opening_balance)} />
        <DetailRow
          label="Calculated ending"
          value={formatReconcileMoney(session.calculated_ending_balance ?? session.bank_balance)}
        />
        <DetailRow label="Difference" value={formatReconcileMoney(session.difference)} />
        <DetailRow label="Transactions" value={String(session.transaction_count)} />
      </View>

      <Text style={{ color: theme.colors.textSecondary, fontWeight: "700", marginBottom: 8 }}>
        Included transactions
      </Text>
      {session.transactions.length === 0 ? (
        <Text style={{ color: theme.colors.textMuted }}>No transactions in this session.</Text>
      ) : (
        session.transactions.map((txn) => (
          <Button
            key={txn.id}
            label={`${txn.payee} · ${formatReconcileMoney(txn.amount)}`}
            variant="ghost"
            onPress={() => router.push(transactionDetailPath(txn.id))}
          />
        ))
      )}

      {session.can_undo ? (
        <View style={{ marginTop: 24 }}>
          <Button label="Undo reconciliation" variant="danger" onPress={() => setUndoOpen(true)} />
        </View>
      ) : null}

      <ConfirmDialog
        visible={undoOpen}
        title="Undo reconciliation?"
        message="This clears reconciled flags for this session only. Later reconciliations are not allowed to be undone out of order."
        confirmLabel="Undo"
        destructive
        loading={undoMutation.isPending}
        onCancel={() => setUndoOpen(false)}
        onConfirm={() => undoMutation.mutate()}
      />
    </Screen>
  );
}
