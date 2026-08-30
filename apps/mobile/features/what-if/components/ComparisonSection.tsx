import React from "react";
import { Text, View } from "react-native";
import type { ScenarioComparisonResponse } from "@budget-app/shared";
import { Card, Button } from "@/components/ui";
import { useTheme, type FinancialTone } from "@/theme";
import {
  buildBeforeAfterRow,
  formatComparisonValue,
  formatSignedDelta,
} from "../display";
import { BaselineScenarioMetric } from "./BaselineScenarioMetric";

type Props = {
  comparison: ScenarioComparisonResponse | undefined;
  horizonLabel: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
};

function deltaTone(raw: string | null | undefined): FinancialTone {
  if (!raw) return "neutral";
  const n = parseFloat(raw);
  if (Number.isNaN(n) || Math.abs(n) < 0.005) return "neutral";
  return n > 0 ? "positive" : "critical";
}

export function ComparisonSection({
  comparison,
  horizonLabel,
  loading,
  error,
  onRetry,
}: Props) {
  const theme = useTheme();

  if (error && !comparison?.metrics) {
    return (
      <Card style={{ marginBottom: theme.spacing.md }}>
        <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 8 }}>
          Scenario impact
        </Text>
        <Text style={{ color: theme.colors.critical, marginBottom: 12 }}>
          Could not calculate this scenario. Your changes are still saved — this is not a “no impact” result.
        </Text>
        {onRetry ? <Button label="Retry" variant="secondary" onPress={onRetry} /> : null}
      </Card>
    );
  }

  if (!comparison?.metrics) {
    if (loading) return null;
    return null;
  }

  const before = buildBeforeAfterRow(comparison, "base");
  const after = buildBeforeAfterRow(comparison, "scenario");
  const endingCash = comparison.metrics.ending_cash;
  const lowest = comparison.metrics.lowest_projected_balance;
  const creditDebt = comparison.metrics.credit_debt_after_horizon;
  const firstRisk = comparison.metrics.first_risk_date;

  return (
    <Card style={{ marginBottom: theme.spacing.md }}>
      <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 4 }}>
        Scenario impact
      </Text>
      {error ? (
        <Text style={{ color: theme.colors.critical, ...theme.typography.caption, marginBottom: 8 }}>
          Recalculation failed — figures below may be stale.
          {onRetry ? " " : ""}
        </Text>
      ) : null}
      {error && onRetry ? (
        <View style={{ marginBottom: 12 }}>
          <Button label="Retry" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 12 }}>
        {horizonLabel} forecast — baseline vs this plan
      </Text>

      <View style={{ gap: 16 }}>
        {endingCash ? (
          <BaselineScenarioMetric
            label="Ending cash"
            baseline={formatComparisonValue("ending_cash", endingCash.base)}
            scenario={formatComparisonValue("ending_cash", endingCash.scenario)}
            delta={endingCash.delta ? formatSignedDelta(endingCash.delta) : null}
            tone={deltaTone(endingCash.delta)}
          />
        ) : null}

        {lowest ? (
          <BaselineScenarioMetric
            label="Lowest balance"
            baseline={before.lowestBalance}
            scenario={after.lowestBalance}
            delta={lowest.delta ? formatSignedDelta(lowest.delta) : null}
            tone={deltaTone(lowest.delta)}
          />
        ) : null}

        {(parseInt(before.problemDays, 10) > 0 || parseInt(after.problemDays, 10) > 0) ? (
          <BaselineScenarioMetric
            label="Days below $0"
            baseline={before.problemDays}
            scenario={after.problemDays}
            delta={
              comparison.metrics.risk_days?.delta
                ? `${comparison.metrics.risk_days.delta} days`
                : null
            }
            tone={deltaTone(comparison.metrics.risk_days?.delta)}
          />
        ) : null}

        {firstRisk && (firstRisk.base || firstRisk.scenario) ? (
          <BaselineScenarioMetric
            label="First cash risk"
            baseline={before.firstProblemDate}
            scenario={after.firstProblemDate}
            delta={null}
            tone="neutral"
          />
        ) : null}

        {creditDebt &&
        (Math.abs(parseFloat(String(creditDebt.delta ?? "0"))) > 0.005 ||
          Math.abs(parseFloat(String(creditDebt.base ?? "0"))) > 0.005) ? (
          <BaselineScenarioMetric
            label="Credit debt"
            baseline={formatComparisonValue("credit_debt_after_horizon", creditDebt.base)}
            scenario={formatComparisonValue("credit_debt_after_horizon", creditDebt.scenario)}
            delta={creditDebt.delta ? formatSignedDelta(creditDebt.delta) : null}
            tone={deltaTone(
              creditDebt.delta != null ? String(-parseFloat(creditDebt.delta)) : null
            )}
          />
        ) : null}
      </View>
    </Card>
  );
}
