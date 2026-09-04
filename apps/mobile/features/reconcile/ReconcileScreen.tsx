import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  completeReconciliation,
  getReconcileSetup,
  listReconciliationSessions,
  previewReconciliation,
} from "@budget-app/api-client";
import {
  formatAccountOptionLabel,
  type Account,
  type ReconcileCompleteResponse,
  type ReconcileTransactionRow,
} from "@budget-app/shared";
import {
  AppHeader,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SkeletonBlock,
  TextField,
  DetailRow,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { describeApiError } from "@/services/api";
import { DatePickerField, OptionsPickerSheet } from "@/components/forms";
import { ReconcileTxnRow } from "./ReconcileTxnRow";
import {
  bankBalanceHint,
  checkedIdsKey,
  differenceStatusCopy,
  formatReconcileMoney,
  formatStatementDate,
  hasBankBalanceInput,
  lastReconciledSummary,
  normalizeMoneyInput,
  partitionReconcileTransactions,
  sessionStatusLabel,
  type ReconcilePhase,
} from "./reconcileDisplay";
import { invalidateAfterReconcileMutation } from "@/lib/financialQueryRefresh";
import { reconcileQueryKeys } from "./queryKeys";
import { reconcileSessionDetailPath, transactionDetailPath } from "./navigation";

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

export function ReconcileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ account?: string }>();
  const paramAccountId = params.account ? Number(params.account) : null;
  const { householdId } = useDefaultHouseholdId();
  const { accounts, isLoading: accountsLoading } = useAccountOptions({ householdId });

  const [accountId, setAccountId] = useState<number | null>(
    paramAccountId != null && Number.isFinite(paramAccountId) ? paramAccountId : null
  );
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [phase, setPhase] = useState<ReconcilePhase>("home");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [bankBalanceInput, setBankBalanceInput] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set());
  const [discardOpen, setDiscardOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<ReconcileCompleteResponse | null>(null);
  const seededAccount = useRef(false);
  const seededPeriod = useRef(false);

  useEffect(() => {
    if (seededAccount.current) return;
    if (paramAccountId != null && Number.isFinite(paramAccountId)) {
      setAccountId(paramAccountId);
      seededAccount.current = true;
    }
  }, [paramAccountId]);

  const selectedAccount: Account | undefined = accounts.find((a) => a.id === accountId);

  useEffect(() => {
    setPhase("home");
    setBankBalanceInput("");
    setCheckedIds(new Set());
    setPeriodStart("");
    setPeriodEnd("");
    setCompleteError(null);
    setCompleted(null);
    seededPeriod.current = false;
  }, [accountId]);

  const metaQuery = useQuery({
    queryKey: reconcileQueryKeys.meta(accountId),
    queryFn: () => getReconcileSetup(accountId as number),
    enabled: accountId != null,
    staleTime: 30_000,
  });

  const sessionsQuery = useQuery({
    queryKey: reconcileQueryKeys.sessions(accountId),
    queryFn: () => listReconciliationSessions(accountId as number),
    enabled: accountId != null && phase === "home",
    staleTime: 30_000,
  });

  useEffect(() => {
    const meta = metaQuery.data;
    if (!meta || seededPeriod.current) return;
    if (meta.all_reconciled_through_today) {
      seededPeriod.current = true;
      return;
    }
    setPeriodStart(meta.min_start_date);
    setPeriodEnd(meta.max_end_date);
    seededPeriod.current = true;
  }, [metaQuery.data]);

  const periodReady =
    !!periodStart &&
    !!periodEnd &&
    periodStart <= periodEnd &&
    (!metaQuery.data?.min_start_date || periodStart >= metaQuery.data.min_start_date) &&
    (!metaQuery.data?.max_end_date || periodEnd <= metaQuery.data.max_end_date);

  const setupQuery = useQuery({
    queryKey: reconcileQueryKeys.setup(accountId, periodStart, periodEnd),
    queryFn: () =>
      getReconcileSetup(accountId as number, { start: periodStart, end: periodEnd }),
    enabled: accountId != null && periodReady && (phase === "statement" || phase === "review"),
    staleTime: 15_000,
  });

  const checkedKey = checkedIdsKey(checkedIds);
  const previewEnabled =
    phase === "review" &&
    accountId != null &&
    periodReady &&
    hasBankBalanceInput(bankBalanceInput);

  const previewQuery = useQuery({
    queryKey: reconcileQueryKeys.preview(
      accountId,
      periodStart,
      periodEnd,
      bankBalanceInput.trim(),
      checkedKey
    ),
    queryFn: () =>
      previewReconciliation({
        account_id: accountId as number,
        bank_current_balance: bankBalanceInput.trim(),
        checked_transaction_ids: [...checkedIds],
        period_start_date: periodStart,
        period_end_date: periodEnd,
      }),
    enabled: previewEnabled,
    staleTime: 0,
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      completeReconciliation({
        account_id: accountId as number,
        bank_current_balance: bankBalanceInput.trim(),
        checked_transaction_ids: [...checkedIds],
        period_start_date: periodStart,
        period_end_date: periodEnd,
      }),
    onSuccess: (result) => {
      invalidateAfterReconcileMutation(queryClient);
      setCompleted(result);
      setFinishOpen(false);
      setPhase("done");
    },
    onError: (err) => {
      setFinishOpen(false);
      setCompleteError(describeApiError(err));
    },
  });

  const transactions: ReconcileTransactionRow[] =
    setupQuery.data?.unreconciled_transactions ?? [];
  const { checked, unchecked } = useMemo(
    () => partitionReconcileTransactions(transactions, checkedIds),
    [transactions, checkedIds]
  );

  const toggleChecked = useCallback((id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const inProgress = phase === "statement" || phase === "review";
  const dirty =
    inProgress &&
    (checkedIds.size > 0 || hasBankBalanceInput(bankBalanceInput) || phase === "review");

  const requestBack = () => {
    if (phase === "done") {
      setPhase("home");
      setCompleted(null);
      setCheckedIds(new Set());
      setBankBalanceInput("");
      seededPeriod.current = false;
      void metaQuery.refetch();
      void sessionsQuery.refetch();
      return;
    }
    if (phase === "review") {
      setPhase("statement");
      return;
    }
    if (phase === "statement") {
      if (dirty) {
        setDiscardOpen(true);
        return;
      }
      setPhase("home");
      return;
    }
    router.back();
  };

  const discardAndHome = () => {
    setDiscardOpen(false);
    setPhase("home");
    setCheckedIds(new Set());
    setBankBalanceInput("");
    setCompleteError(null);
  };

  const lastSummary = lastReconciledSummary({
    lastPeriodEnd: metaQuery.data?.last_reconcile_period_end,
    endingBalance: metaQuery.data?.last_reconciled_balance,
    currency: selectedAccount?.currency,
  });

  const diffCopy = differenceStatusCopy(previewQuery.data ?? null);
  const headerTitle =
    phase === "home" || !selectedAccount
      ? "Reconcile"
      : `Reconcile ${formatAccountOptionLabel(selectedAccount)}`;

  const accountOptions = accounts.map((a) => ({
    id: String(a.id),
    title: formatAccountOptionLabel(a),
    subtitle: a.account_type,
  }));

  if (accountsLoading) {
    return (
      <Screen scroll={false}>
        <AppHeader title="Reconcile" showBack onBack={() => router.back()} />
        <SkeletonBlock lines={4} />
      </Screen>
    );
  }

  if (accounts.length === 0) {
    return (
      <Screen scroll>
        <AppHeader title="Reconcile" showBack onBack={() => router.back()} />
        <EmptyState title="No accounts available to reconcile." />
      </Screen>
    );
  }

  if (phase === "done" && completed) {
    return (
      <Screen scroll>
        <AppHeader title={headerTitle} showBack onBack={requestBack} />
        <Text style={{ color: theme.colors.text, ...theme.typography.title, marginBottom: 8 }}>
          Reconciliation complete
        </Text>
        <View style={{ gap: 10, marginBottom: 24 }}>
          <DetailRow
            label="Account"
            value={selectedAccount ? formatAccountOptionLabel(selectedAccount) : "—"}
          />
          <DetailRow
            label="Statement ending"
            value={formatReconcileMoney(completed.bank_current_balance, selectedAccount?.currency)}
          />
          <DetailRow
            label="Difference"
            value={formatReconcileMoney(completed.difference, selectedAccount?.currency)}
          />
          <DetailRow
            label="Reconciled through"
            value={formatStatementDate(completed.period_end_date)}
          />
        </View>
        <Button label="Done" onPress={requestBack} />
      </Screen>
    );
  }

  if (phase === "statement") {
    const opening =
      setupQuery.data?.period_opening_balance ?? metaQuery.data?.period_opening_balance;
    return (
      <Screen scroll>
        <AppHeader title={headerTitle} showBack onBack={requestBack} />
        <Text style={{ color: theme.colors.textMuted, marginBottom: 16 }}>
          Enter statement information. Beginning balance comes from your last reconciliation.
        </Text>

        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 4 }}>
            Beginning balance
          </Text>
          <Text style={{ color: theme.colors.text, ...theme.typography.metric }}>
            {formatReconcileMoney(opening, selectedAccount?.currency)}
          </Text>
          {metaQuery.data?.is_first_reconciliation ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 4 }}>
              First reconciliation — opening is the ledger balance at the period start.
            </Text>
          ) : null}
        </View>

        <DatePickerField
          label="Statement start date"
          value={periodStart || null}
          minimumDate={metaQuery.data?.min_start_date ? isoToDate(metaQuery.data.min_start_date) : undefined}
          maximumDate={metaQuery.data?.max_end_date ? isoToDate(metaQuery.data.max_end_date) : undefined}
          onChange={setPeriodStart}
        />
        <DatePickerField
          label="Statement end date"
          value={periodEnd || null}
          minimumDate={periodStart ? isoToDate(periodStart) : undefined}
          maximumDate={metaQuery.data?.max_end_date ? isoToDate(metaQuery.data.max_end_date) : undefined}
          onChange={setPeriodEnd}
        />
        <TextField
          label="Statement ending balance"
          value={bankBalanceInput}
          onChangeText={(v) => setBankBalanceInput(normalizeMoneyInput(v))}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginBottom: 16 }}>
          {bankBalanceHint(selectedAccount?.account_type)}
        </Text>

        {setupQuery.isError ? (
          <ErrorState
            message={describeApiError(setupQuery.error)}
            onRetry={() => setupQuery.refetch()}
          />
        ) : null}

        <Button
          label="Review transactions"
          disabled={!periodReady || !hasBankBalanceInput(bankBalanceInput) || setupQuery.isLoading}
          onPress={() => {
            setCompleteError(null);
            setPhase("review");
          }}
        />

        <ConfirmDialog
          visible={discardOpen}
          title="Leave reconciliation?"
          message="Checked items are not saved until you finish. Leaving will discard this session."
          confirmLabel="Discard"
          destructive
          onCancel={() => setDiscardOpen(false)}
          onConfirm={discardAndHome}
        />
      </Screen>
    );
  }

  if (phase === "review") {
    const listData: Array<
      | { kind: "header"; key: string; title: string }
      | { kind: "row"; key: string; txn: ReconcileTransactionRow; checked: boolean }
    > = [];
    if (unchecked.length > 0) {
      listData.push({ kind: "header", key: "h-uncleared", title: "Uncleared" });
      for (const txn of unchecked) {
        listData.push({ kind: "row", key: `u-${txn.id}`, txn, checked: false });
      }
    }
    if (checked.length > 0) {
      listData.push({ kind: "header", key: "h-cleared", title: "Cleared for this statement" });
      for (const txn of checked) {
        listData.push({ kind: "row", key: `c-${txn.id}`, txn, checked: true });
      }
    }

    return (
      <Screen scroll={false} contentStyle={{ paddingHorizontal: 0 }}>
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <AppHeader title={headerTitle} showBack onBack={requestBack} />
          <View
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              padding: 12,
              marginBottom: 8,
              backgroundColor: theme.colors.surfaceMuted,
              gap: 6,
            }}
            accessibilityRole="summary"
          >
            <DetailRow
              label="Statement ending balance"
              value={formatReconcileMoney(
                previewQuery.data?.bank_current_balance ?? bankBalanceInput,
                selectedAccount?.currency
              )}
            />
            <DetailRow
              label="Cleared balance"
              value={
                previewQuery.isFetching && !previewQuery.data
                  ? "…"
                  : formatReconcileMoney(
                      previewQuery.data?.cleared_balance,
                      selectedAccount?.currency
                    )
              }
            />
            <DetailRow
              label="Difference"
              value={
                previewQuery.isFetching && !previewQuery.data
                  ? "…"
                  : formatReconcileMoney(previewQuery.data?.difference, selectedAccount?.currency)
              }
            />
            <Text
              style={{
                color: diffCopy.ready ? theme.colors.tint : theme.colors.textSecondary,
                fontSize: 13,
                marginTop: 4,
              }}
              accessibilityLiveRegion="polite"
            >
              {diffCopy.ready ? `${diffCopy.title}. ${diffCopy.message}` : diffCopy.message}
            </Text>
          </View>
          {completeError ? (
            <Text style={{ color: theme.colors.critical, marginBottom: 8 }}>{completeError}</Text>
          ) : null}
          {previewQuery.isError ? (
            <Text style={{ color: theme.colors.critical, marginBottom: 8 }}>
              {describeApiError(previewQuery.error)}
            </Text>
          ) : null}
        </View>

        {setupQuery.isLoading ? (
          <View style={{ padding: theme.spacing.lg }}>
            <SkeletonBlock lines={4} />
          </View>
        ) : setupQuery.isError ? (
          <ErrorState
            message={describeApiError(setupQuery.error)}
            onRetry={() => setupQuery.refetch()}
          />
        ) : listData.length === 0 ? (
          <EmptyState
            title="No candidate transactions"
            message="There are no unreconciled transactions in this statement period."
          />
        ) : (
          <FlatList
            data={listData}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => {
              if (item.kind === "header") {
                return (
                  <View
                    style={{
                      paddingHorizontal: theme.spacing.lg,
                      paddingTop: theme.spacing.md,
                      paddingBottom: theme.spacing.xs,
                    }}
                  >
                    <Text
                      style={{
                        color: theme.colors.textMuted,
                        fontSize: 12,
                        fontWeight: "700",
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                      }}
                    >
                      {item.title}
                    </Text>
                  </View>
                );
              }
              return (
                <ReconcileTxnRow
                  transaction={item.txn}
                  checked={item.checked}
                  onToggle={() => toggleChecked(item.txn.id)}
                  onOpenDetail={() => router.push(transactionDetailPath(item.txn.id))}
                />
              );
            }}
            contentContainerStyle={{ paddingBottom: 120 }}
          />
        )}

        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: theme.spacing.lg,
            backgroundColor: theme.colors.background,
            borderTopWidth: StyleSheetHairline,
            borderTopColor: theme.colors.border,
          }}
        >
          <Button
            label="Finish reconciliation"
            disabled={!previewQuery.data?.can_complete || completeMutation.isPending}
            loading={completeMutation.isPending}
            onPress={() => setFinishOpen(true)}
          />
        </View>

        <ConfirmDialog
          visible={finishOpen}
          title="Finish reconciliation?"
          message="This will mark the cleared transactions as reconciled for this statement period."
          confirmLabel="Finish"
          loading={completeMutation.isPending}
          onCancel={() => setFinishOpen(false)}
          onConfirm={() => completeMutation.mutate()}
        />
        <ConfirmDialog
          visible={discardOpen}
          title="Leave reconciliation?"
          message="Checked items are not saved until you finish. Leaving will discard this session."
          confirmLabel="Discard"
          destructive
          onCancel={() => setDiscardOpen(false)}
          onConfirm={discardAndHome}
        />
      </Screen>
    );
  }

  // Home
  const allCaughtUp = metaQuery.data?.all_reconciled_through_today === true;
  const sessions = sessionsQuery.data?.results ?? [];

  return (
    <Screen scroll>
      <AppHeader title="Reconcile" showBack onBack={() => router.back()} />

      <Pressable
        onPress={() => setAccountPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Choose account"
        style={{
          minHeight: theme.touchTarget,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
          justifyContent: "center",
          backgroundColor: theme.colors.surfaceMuted,
          marginBottom: 16,
        }}
      >
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 2 }}>
          Account
        </Text>
        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 16 }}>
          {selectedAccount ? formatAccountOptionLabel(selectedAccount) : "Select account ›"}
        </Text>
      </Pressable>

      {accountId == null ? (
        <EmptyState
          title="No reconciliations yet."
          message="Start by choosing an account and entering your statement balance."
        />
      ) : metaQuery.isLoading ? (
        <SkeletonBlock lines={3} />
      ) : metaQuery.isError ? (
        <ErrorState message={describeApiError(metaQuery.error)} onRetry={() => metaQuery.refetch()} />
      ) : (
        <>
          {lastSummary ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                padding: 12,
                marginBottom: 16,
                gap: 6,
              }}
            >
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Last reconciled</Text>
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{lastSummary.dateLabel}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 6 }}>
                Ending balance
              </Text>
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                {lastSummary.balanceLabel}
              </Text>
            </View>
          ) : null}

          {allCaughtUp ? (
            <EmptyState
              title="All caught up"
              message={`This account is reconciled through ${formatStatementDate(
                metaQuery.data?.last_reconcile_period_end ?? metaQuery.data?.max_end_date
              )}.`}
            />
          ) : (
            <Button
              label="Start reconciliation"
              onPress={() => {
                setCompleteError(null);
                setPhase("statement");
              }}
            />
          )}

          <Text
            style={{
              color: theme.colors.textSecondary,
              fontWeight: "700",
              marginTop: 24,
              marginBottom: 8,
            }}
          >
            History
          </Text>
          {sessionsQuery.isLoading ? (
            <SkeletonBlock lines={2} />
          ) : sessions.length === 0 ? (
            <Text style={{ color: theme.colors.textMuted }}>No reconciliations yet.</Text>
          ) : (
            sessions.map((session) => (
              <ListRow
                key={session.id}
                title={formatStatementDate(session.period_end_date)}
                subtitle={`Ending balance ${formatReconcileMoney(session.bank_balance)} · ${sessionStatusLabel(session)}`}
                onPress={() => router.push(reconcileSessionDetailPath(session.id))}
              />
            ))
          )}
        </>
      )}

      <OptionsPickerSheet
        visible={accountPickerOpen}
        title="Account"
        selectedId={accountId != null ? String(accountId) : null}
        options={accountOptions}
        searchPlaceholder="Search accounts"
        onClose={() => setAccountPickerOpen(false)}
        onSelect={(id) => {
          setAccountId(Number(id));
          setAccountPickerOpen(false);
        }}
      />
    </Screen>
  );
}

const StyleSheetHairline = 1 / 2;
