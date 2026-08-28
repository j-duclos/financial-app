import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Account } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { getTimeline } from "@budget-app/api-client";
import { useTheme } from "@/theme";
import { addDaysToIsoDate, formatDateDisplay, maxIsoDate, todayStr } from "@/lib/dates";
import { transactionQueryKeys } from "./queryKeys";

const HINT_HISTORY_DAYS = 90;

function projectionTimelineRangeForAsOf(asOfDate: string): { start: string; end: string; as_of: string } {
  const as_of = maxIsoDate(asOfDate, todayStr());
  return {
    start: addDaysToIsoDate(as_of, -HINT_HISTORY_DAYS),
    end: addDaysToIsoDate(as_of, 1),
    as_of,
  };
}

/** Last canonical running balance on or before asOf for one account (timeline walk). */
function assetBalanceAsOfDateFromTimeline(
  timeline: { date: string; account_id: number; amount: string; running_balance: string; transaction_id?: number | null }[],
  accountId: number,
  asOfDate: string
): number | null {
  const rows = timeline
    .filter((r) => r.account_id === accountId && r.date <= asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.transaction_id ?? 0) - (b.transaction_id ?? 0));
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1]!;
  const rb = parseFloat(last.running_balance);
  return Number.isFinite(rb) ? rb : null;
}

type Props = {
  sourceAccount: Account | null;
  transferDateIso: string | null;
  transferAmount: string;
  label?: string;
};

/** Timeline-backed source balance hint for transfer/card payment entry (matches web semantics). */
export function TransferSourceBalancePreview({
  sourceAccount,
  transferDateIso,
  transferAmount,
  label,
}: Props) {
  const theme = useTheme();
  const projectionRange = useMemo(
    () => (transferDateIso ? projectionTimelineRangeForAsOf(transferDateIso) : null),
    [transferDateIso]
  );

  const { data, isFetching } = useQuery({
    queryKey: transactionQueryKeys.timeline({
      start: projectionRange?.start,
      end: projectionRange?.end,
      account_id: sourceAccount?.id,
      hint: "transfer-source",
    }),
    queryFn: () =>
      getTimeline({
        start: projectionRange!.start,
        end: projectionRange!.end,
        as_of: projectionRange!.as_of,
        account_id: sourceAccount!.id,
      }),
    enabled: projectionRange != null && sourceAccount != null && Boolean(transferDateIso),
    staleTime: 300_000,
  });

  const balanceBefore = useMemo(() => {
    if (!data?.timeline || !transferDateIso || !sourceAccount) return null;
    return assetBalanceAsOfDateFromTimeline(data.timeline, sourceAccount.id, transferDateIso);
  }, [data?.timeline, sourceAccount, transferDateIso]);

  const balanceAfter = useMemo(() => {
    if (balanceBefore == null) return null;
    const raw = parseFloat(String(transferAmount).trim());
    if (!Number.isFinite(raw) || raw === 0) return null;
    return balanceBefore - Math.abs(raw);
  }, [balanceBefore, transferAmount]);

  if (!sourceAccount || !transferDateIso) return null;

  const currency = sourceAccount.currency ?? "USD";
  const title = label ?? sourceAccount.effective_display_name ?? sourceAccount.name;

  return (
    <View
      style={{
        marginTop: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surfaceMuted,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{title}</Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
        Balance on {formatDateDisplay(transferDateIso)} (from timeline)
      </Text>
      {isFetching ? (
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
          Loading…
        </Text>
      ) : (
        <>
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
            Current (this transfer excluded)
          </Text>
          <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginTop: 2 }}>
            {balanceBefore != null ? formatCurrency(String(balanceBefore), currency) : "—"}
          </Text>
          {balanceAfter != null ? (
            <>
              <Text
                style={{
                  color: theme.colors.textMuted,
                  ...theme.typography.caption,
                  marginTop: theme.spacing.sm,
                }}
              >
                Projected after this transfer
              </Text>
              <Text
                style={{
                  color:
                    balanceAfter < (balanceBefore ?? 0)
                      ? theme.colors.warning
                      : theme.colors.moneyPositive,
                  ...theme.typography.bodyStrong,
                  marginTop: 2,
                }}
              >
                {formatCurrency(String(balanceAfter), currency)}
              </Text>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}
