import React from "react";
import { Text, View } from "react-native";
import type { TimelineCalendarDay } from "@budget-app/shared";
import { Card, CurrencyDisplay, SectionHeader } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay } from "@/lib/dates";
import {
  dayHasActivity,
  daySeverity,
  daySeverityLabel,
  emptyCalendarDay,
  filterCalendarTransactions,
  parseCalendarAmount,
} from "./calendarUtils";
import { CalendarEventRow } from "./CalendarEventRow";
import { ForecastWarningCard } from "./ForecastWarningCard";
import type { CalendarEventFilter } from "./types";
import type { TimelineCalendarTransaction } from "@budget-app/shared";

type Props = {
  dateIso: string;
  day: TimelineCalendarDay | undefined;
  outsideForecast: boolean;
  forecastDays: number;
  eventFilter: CalendarEventFilter;
  onEventPress: (txn: TimelineCalendarTransaction) => void;
  onViewAllTransactions: () => void;
};

export function CalendarDaySummary({
  dateIso,
  day,
  outsideForecast,
  forecastDays,
  eventFilter,
  onEventPress,
  onViewAllTransactions,
}: Props) {
  const theme = useTheme();
  const resolved = day ?? emptyCalendarDay(dateIso);
  const severity = daySeverity(resolved);
  const hasActivity = dayHasActivity(resolved);
  const filtered = filterCalendarTransactions(resolved.transactions, eventFilter);
  const openingBalance = parseCalendarAmount(resolved.ending_balance) - parseCalendarAmount(resolved.net_total);

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

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Card>
        <SectionHeader
          title={formatDateDisplay(dateIso)}
          actionLabel={hasActivity ? "All transactions" : undefined}
          onAction={hasActivity ? onViewAllTransactions : undefined}
        />
        {(severity === "critical" || severity === "watch") && day ? (
          <ForecastWarningCard day={day} />
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md, marginTop: 8 }}>
          <Metric label="Starting" amount={String(openingBalance)} />
          <Metric label="Income" amount={resolved.income_total} tone="positive" />
          <Metric label="Expenses" amount={resolved.expense_total} tone="negative" />
          <Metric label="Net" amount={resolved.net_total} showSign />
          <Metric
            label="Ending"
            amount={resolved.ending_balance}
            tone={parseCalendarAmount(resolved.ending_balance) < 0 ? "negative" : "neutral"}
          />
        </View>
        {!hasActivity ? (
          <Text style={{ color: theme.colors.textSecondary, marginTop: 12, ...theme.typography.body }}>
            No financial activity projected for this day.
          </Text>
        ) : (
          <Text
            accessibilityLabel={`Day status: ${daySeverityLabel(severity)}`}
            style={{ color: theme.colors.textMuted, marginTop: 8, fontSize: 12 }}
          >
            {daySeverityLabel(severity)}
            {resolved.risk_reason ? ` · ${resolved.risk_reason}` : ""}
          </Text>
        )}
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
