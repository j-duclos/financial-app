import React from "react";
import { Text, View } from "react-native";
import type { DebtPayoffPlan } from "@budget-app/shared";
import { PLANNER_SUMMARY_METRICS, debtFreeSummary } from "@budget-app/shared/paymentPlannerDisplay";
import { Card } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatMoneyOrDash, interestSavedLine } from "./display";
import { formatDateDisplay } from "@/lib/dates";

type Props = {
  plan: DebtPayoffPlan;
  recalculating?: boolean;
};

export function PlannerSummaryCard({ plan, recalculating }: Props) {
  const theme = useTheme();
  const saved = interestSavedLine(plan);
  const debtFree = debtFreeSummary(plan);

  return (
    <Card style={{ marginBottom: theme.spacing.md }}>
      <Text
        style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}
        accessibilityRole="header"
      >
        Plan summary
      </Text>
      {recalculating ? (
        <Text
          style={{ color: theme.colors.tint, ...theme.typography.caption, marginBottom: 8 }}
          accessibilityLiveRegion="polite"
        >
          Recalculating plan…
        </Text>
      ) : null}
      <MetricRow label={PLANNER_SUMMARY_METRICS.totalDebt.label} value={formatMoneyOrDash(plan.total_debt)} />
      <MetricRow
        label={PLANNER_SUMMARY_METRICS.weightedApr.label}
        value={formatAprOrDash(plan.weighted_apr)}
        hint={PLANNER_SUMMARY_METRICS.weightedApr.help}
      />
      <MetricRow
        label={PLANNER_SUMMARY_METRICS.interestThisMonth.label}
        value={formatMoneyOrDash(plan.monthly_interest_burn)}
        hint={PLANNER_SUMMARY_METRICS.interestThisMonth.help}
      />
      <MetricRow
        label={PLANNER_SUMMARY_METRICS.debtFree.label}
        value={debtFree.value}
        hint={debtFree.subtitle ?? PLANNER_SUMMARY_METRICS.debtFree.help}
      />
      {debtFree.subtitle ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            ...theme.typography.caption,
            marginTop: 2,
            marginBottom: 6,
          }}
        >
          {debtFree.subtitle}
        </Text>
      ) : null}
      <MetricRow
        label="Extra payment"
        value={`${formatMoneyOrDash(plan.extra_monthly)}/mo`}
      />
      {saved ? (
        <Text
          style={{
            color: theme.colors.moneyPositive,
            ...theme.typography.caption,
            marginTop: 10,
          }}
        >
          {saved}
        </Text>
      ) : plan.baseline_status === "baseline_not_payoffable" ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            ...theme.typography.caption,
            marginTop: 10,
          }}
        >
          Minimum payments alone would not pay off all debts.
        </Text>
      ) : null}
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
        As of {formatDateDisplay(plan.as_of)}
      </Text>
    </Card>
  );
}

function formatAprOrDash(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "—";
  const n = parseFloat(String(raw));
  if (!Number.isFinite(n)) return "—";
  return `${raw}%`;
}

function MetricRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 6,
      }}
      accessibilityLabel={hint ? `${label}. ${value}. ${hint}` : `${label}. ${value}`}
    >
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, flex: 1, paddingRight: 8 }}>
        {label}
      </Text>
      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>{value}</Text>
    </View>
  );
}
