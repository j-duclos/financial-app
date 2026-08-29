import React from "react";
import { Text, View } from "react-native";
import type { TimelineCalendarDay, TimelineCalendarTransaction } from "@budget-app/shared";
import { Card, CurrencyDisplay, SectionHeader } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay } from "@/lib/dates";
import {
  calendarAccountRiskPresentation,
  calendarDateState,
  calendarPastAccountEndingLabel,
} from "./calendarPresentation";
import {
  dayHasActivity,
  emptyCalendarDay,
  filterCalendarTransactions,
  parseCalendarAmount,
} from "./calendarUtils";
import { CalendarEventRow } from "./CalendarEventRow";
import { AccountRiskSection } from "./AccountRiskSection";
import type { CalendarEventFilter } from "./types";

type Props = {
  dateIso: string;
  day: TimelineCalendarDay | undefined;
  outsideForecast: boolean;
  forecastDays: number;
  eventFilter: CalendarEventFilter;
  accountName?: string | null;
  onEventPress: (txn: TimelineCalendarTransaction) => void;
  onAccountRiskPress?: () => void;
};

export function CalendarDaySummary({
  dateIso,
  day,
  outsideForecast,
  forecastDays,
  eventFilter,
  accountName,
  onEventPress,
  onAccountRiskPress,
}: Props) {
  const theme = useTheme();
  const resolved = day ?? emptyCalendarDay(dateIso);
  const dateState = calendarDateState(dateIso);
  const hasActivity = dayHasActivity(resolved);
  const filtered = filterCalendarTransactions(resolved.transactions, eventFilter);
  const accountRisk = calendarAccountRiskPresentation(resolved, dateIso);
  /** Account filter only — canonical backend ending_balance, never derived. */
  const isAccountScope = resolved.balance_scope === "account";
  const showCanonicalAccountEnding = isAccountScope;

  if (outsideForecast) {
    return (
      <Card>
        <Text style={{ color: theme.colors.text, ...theme.typography.headline }}>
          {formatDateDisplay(dateIso)}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, marginTop: 8, ...theme.typography.body }}>
          This date is outside your {forecastDays}-day forecast window. Navigate to an earlier date or
          extend your forecast window in settings to see projected activity.
        </Text>
      </Card>
    );
  }

  const sectionTitle =
    isAccountScope && accountName
      ? `${formatDateDisplay(dateIso)} · ${accountName}`
      : formatDateDisplay(dateIso);

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Card>
        <SectionHeader title={sectionTitle} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md, marginTop: 8 }}>
          <Metric label="Income" amount={resolved.income_total} tone="positive" />
          <Metric label="Expenses" amount={resolved.expense_total} tone="negative" />
          {showCanonicalAccountEnding ? (
            <Metric
              label="Ending balance"
              amount={resolved.ending_balance}
              tone={parseCalendarAmount(resolved.ending_balance) < 0 ? "negative" : "neutral"}
            />
          ) : null}
        </View>
        {!hasActivity ? (
          <Text style={{ color: theme.colors.textSecondary, marginTop: 12, ...theme.typography.body }}>
            {dateState === "past"
              ? "No financial activity recorded for this day."
              : dateState === "today"
                ? "No remaining activity expected for today."
                : "No financial activity projected for this day."}
          </Text>
        ) : dateState === "past" && isAccountScope ? (
          <Text style={{ color: theme.colors.textMuted, marginTop: 8, fontSize: 12 }}>
            {calendarPastAccountEndingLabel(accountName)} · actual posted activity
          </Text>
        ) : null}
        {accountRisk ? (
          <AccountRiskSection risk={accountRisk} onPress={onAccountRiskPress} />
        ) : null}
      </Card>
      {filtered.length > 0 ? (
        <Card padded={false}>
          <View style={{ padding: theme.spacing.md, paddingBottom: 0 }}>
            <SectionHeader title={`Events (${filtered.length})`} />
          </View>
          {filtered.map((txn, index) => (
            <CalendarEventRow
              key={`${txn.id ?? txn.description}-${index}`}
              txn={txn}
              dateState={dateState}
              onPress={() => onEventPress(txn)}
            />
          ))}
        </Card>
      ) : null}
    </View>
  );
}

function Metric({
  label,
  amount,
  tone,
  showSign,
}: {
  label: string;
  amount: string | number;
  tone?: "positive" | "negative" | "neutral";
  showSign?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ minWidth: "28%" }}>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "600" }}>{label}</Text>
      <CurrencyDisplay amount={amount} tone={tone} showSign={showSign} style={{ fontSize: 16 }} />
    </View>
  );
}
