import React from "react";
import { Text, View } from "react-native";
import { formatCurrency } from "@budget-app/shared";
import type { DebtPayoffPlan } from "@budget-app/shared";
import { Card, CurrencyDisplay } from "@/components/ui";
import { useTheme } from "@/theme";
import { debtFreeHeadline, interestSavedLine } from "./display";
import { formatDateDisplay } from "@/lib/dates";

type Props = {
  plan: DebtPayoffPlan;
  recalculating?: boolean;
};

export function PlannerSummaryCard({ plan, recalculating }: Props) {
  const theme = useTheme();
  const headline = debtFreeHeadline(plan);
  const saved = interestSavedLine(plan);

  return (
    <Card style={{ marginBottom: theme.spacing.md }}>
      <Text
        style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 4 }}
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <Metric label="Total debt" value={formatCurrency(plan.total_debt)} />
        <Metric label="Weighted APR" value={`${plan.weighted_apr}%`} />
        <Metric label="Interest / mo" value={formatCurrency(plan.monthly_interest_burn)} tone="critical" />
        <Metric
          label="Debt-free (est.)"
          value={
            plan.debt_free_date
              ? formatDateDisplay(plan.debt_free_date)
              : plan.debt_free_possible
                ? "—"
                : "Needs higher pay"
          }
        />
      </View>
      {headline ? (
        <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 4 }}>
          {headline}
        </Text>
      ) : null}
      {saved ? (
        <Text style={{ color: theme.colors.moneyPositive, ...theme.typography.caption }}>{saved}</Text>
      ) : null}
      <Text
        style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}
      >
        Monthly budget: {formatCurrency(plan.monthly_payment_budget)} · Extra:{" "}
        {formatCurrency(plan.extra_monthly)}
      </Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
        Projection as of {formatDateDisplay(plan.as_of)} — not a scheduled payment.
      </Text>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "critical";
}) {
  const theme = useTheme();
  return (
    <View style={{ minWidth: "45%", flexGrow: 1 }}>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>{label}</Text>
      <CurrencyDisplay
        amount={value}
        style={{
          color: tone === "critical" ? theme.colors.critical : theme.colors.text,
          fontWeight: "700",
          fontSize: 16,
        }}
      />
    </View>
  );
}
