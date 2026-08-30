import React from "react";
import { Text, View } from "react-native";
import { formatCurrency } from "@budget-app/shared";
import type { SpendingTargetMetrics } from "@budget-app/shared";
import { Card, CurrencyDisplay, StatusChip, UtilizationDisplay } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  SPENDING_TARGET_STATUS_LABELS,
  spendingTargetProgressPercent,
  spendingTargetStatusTone,
} from "@/features/budget/spendingTargetDisplay";
import { parseOptionalAmount } from "../reportDisplay";

export function SpendingLimitCard({ metrics }: { metrics: SpendingTargetMetrics }) {
  const theme = useTheme();
  const pct = spendingTargetProgressPercent(metrics);
  const tone = spendingTargetStatusTone(metrics.status);
  const remaining = parseOptionalAmount(metrics.remaining_to_target);
  const scheduled = parseOptionalAmount(metrics.scheduled_in_period);

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
            {metrics.name || metrics.category_name}
          </Text>
          <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 2 }}>{metrics.category_name}</Text>
        </View>
        <StatusChip
          label={SPENDING_TARGET_STATUS_LABELS[metrics.status]}
          tone={tone === "critical" ? "critical" : tone === "warning" ? "warning" : "positive"}
        />
      </View>
      <View style={{ marginTop: 12 }}>
        <UtilizationDisplay value={pct} label="Limit used" warnAt={80} criticalAt={100} />
      </View>
      <View style={{ marginTop: 12, gap: 6 }}>
        <MetricRow label="Limit" amount={metrics.target_amount} />
        <MetricRow label="Spent" amount={metrics.spent_so_far} />
        {scheduled != null && scheduled > 0 ? (
          <MetricRow label="Scheduled" amount={metrics.scheduled_in_period!} />
        ) : null}
        <MetricRow
          label="Remaining"
          amount={metrics.remaining_to_target}
          tone={remaining != null && remaining < 0 ? "negative" : "neutral"}
        />
      </View>
    </Card>
  );
}

function MetricRow({
  label,
  amount,
  tone,
}: {
  label: string;
  amount: string;
  tone?: "negative" | "neutral";
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{label}</Text>
      <CurrencyDisplay amount={amount} tone={tone} style={{ fontSize: 14 }} />
    </View>
  );
}

export function GoalProgressRow({
  name,
  current,
  target,
  progressPercent,
  monthlyRequired,
  projectedCompletion,
}: {
  name: string;
  current: string;
  target: string;
  progressPercent: string;
  monthlyRequired: string | null;
  projectedCompletion: string | null;
}) {
  const theme = useTheme();
  const parsedPct = parseOptionalAmount(progressPercent);
  const pct = parsedPct == null ? null : Math.min(100, Math.max(0, parsedPct));

  return (
    <View
      style={{
        paddingVertical: theme.spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600", flex: 1 }}>{name}</Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
          {formatCurrency(current)} / {formatCurrency(target)}
        </Text>
      </View>
      {pct != null ? (
        <View
          style={{
            marginTop: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.colors.surfaceMuted,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${pct}%`,
              height: "100%",
              backgroundColor: theme.colors.moneyPositive,
            }}
          />
        </View>
      ) : null}
      <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 6 }}>
        {pct != null ? `${pct.toFixed(0)}% complete` : "Progress unavailable"}
        {monthlyRequired ? ` · ${formatCurrency(monthlyRequired)}/mo needed` : ""}
        {projectedCompletion ? ` · Projected ${projectedCompletion}` : ""}
      </Text>
    </View>
  );
}
