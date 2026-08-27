import React from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useQuery } from "@tanstack/react-query";
import { getAccount } from "@budget-app/api-client";
import type { Account } from "@budget-app/shared";
import { SkeletonBlock } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  formatLedgerAccountIdentity,
  formatLedgerHeaderBalanceLine,
  resolveAccountCurrentBalance,
  resolveLedgerHeaderBalances,
} from "./ledgerHeaderDisplay";

type Props = {
  accountId: number;
  fallbackAccount?: Account | null;
  /** Ending balance at end of selected forecast window — never used as Current. */
  forecastBalance?: string | null;
  /** Web-aligned current from last pending ledger row when pending exists. */
  ledgerCurrentBalance?: string | null;
  forecastDays?: number | null;
  onPressAccount: () => void;
  accountNameFallback?: string;
};

export function AccountLedgerHeader({
  accountId,
  fallbackAccount,
  forecastBalance = null,
  ledgerCurrentBalance = null,
  forecastDays = null,
  onPressAccount,
  accountNameFallback,
}: Props) {
  const theme = useTheme();
  const summaryQuery = useQuery({
    queryKey: ["account", accountId, "transactions-header", "balance-only"],
    queryFn: () => getAccount(accountId, true),
    enabled: accountId > 0,
    staleTime: 60_000,
  });

  const account = summaryQuery.data ?? fallbackAccount ?? null;
  const identity = account
    ? formatLedgerAccountIdentity(account)
    : accountNameFallback ?? "Account";

  const accountCurrent = resolveAccountCurrentBalance(
    account
      ? {
          account_type: account.account_type,
          available_balance: account.available_balance,
          balance: account.balance,
          balance_owed: account.balance_owed,
          current_balance: account.current_balance,
        }
      : null
  );

  // Prefer pending-section ending (web Current Balance invariant). Never forecast.
  const current =
    ledgerCurrentBalance != null && String(ledgerCurrentBalance).trim() !== ""
      ? String(ledgerCurrentBalance)
      : accountCurrent;

  const balances = resolveLedgerHeaderBalances({
    account: {
      account_type: account?.account_type,
      available_balance: current,
      balance: current,
    },
    forecastBalance,
  });

  // Hard guard: Current must never equal the forecast-window ending solely because
  // forecastBalance was reused. If they match and we have a distinct account current, prefer it.
  if (
    balances.current != null &&
    balances.forecast != null &&
    parseFloat(balances.current) === parseFloat(balances.forecast) &&
    accountCurrent != null &&
    parseFloat(accountCurrent) !== parseFloat(balances.forecast)
  ) {
    balances.current = accountCurrent;
  }

  const balanceLine = formatLedgerHeaderBalanceLine(
    balances,
    account?.currency ?? "USD",
    forecastDays
  );

  return (
    <Pressable
      onPress={onPressAccount}
      accessibilityRole="button"
      accessibilityLabel={`Selected account: ${identity}. Tap to change account.`}
      style={{
        marginTop: theme.spacing.sm,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingVertical: 4,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{ color: theme.colors.text, ...theme.typography.bodyStrong, fontSize: 16 }}
          numberOfLines={1}
        >
          {identity}
        </Text>
        {balanceLine ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }} numberOfLines={1}>
            {balanceLine}
          </Text>
        ) : summaryQuery.isFetching ? (
          <SkeletonBlock lines={1} />
        ) : null}
      </View>
      <FontAwesome name="chevron-down" size={12} color={theme.colors.textMuted} />
    </Pressable>
  );
}
