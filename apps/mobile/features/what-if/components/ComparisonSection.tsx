import React from "react";
import { Text, View } from "react-native";
import type { ScenarioComparisonResponse } from "@budget-app/shared";
import { Card } from "@/components/ui";
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
};

function deltaTone(raw: string | null | undefined): FinancialTone {
  if (!raw) return "neutral";
  const n = parseFloat(raw);
  if (Number.isNaN(n) || Math.abs(n) < 0.005) return "neutral";
  return n > 0 ? "positive" : "critical";
}

export function ComparisonSection({ comparison, horizonLabel }: Props) {
  const theme = useTheme();
  if (!comparison?.metrics) return null;

  const before = buildBeforeAfterRow(comparison, "base");
  const after = buildBeforeAfterRow(comparison, "scenario");
  const endingCash = comparison.metrics.ending_cash;
  const lowest = comparison.metrics.lowest_projected_balance;

  return (
    <Card style={{ marginBottom: theme.spacing.md }}>
      <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 4 }}>
        Baseline vs What-If
      </Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 12 }}>
        Forecast window: {horizonLabel}. Values are projections, not current balances.
      </Text>

      <View style={{ gap: 16 }}>
        {lowest ? (
          <BaselineScenarioMetric
            label="Lowest projected balance"
            baseline={before.lowestBalance}
            scenario={after.lowestBalance}
            delta={
              lowest.delta
                ? formatSignedDelta(lowest.delta)
                : null
            }
            tone={deltaTone(lowest.delta)}
          />
        ) : null}

        {endingCash ? (
          <BaselineScenarioMetric
            label="Ending cash"
            baseline={formatComparisonValue("ending_cash", endingCash.base)}
            scenario={formatComparisonValue("ending_cash", endingCash.scenario)}
            delta={endingCash.delta ? formatSignedDelta(endingCash.delta) : null}
            tone={deltaTone(endingCash.delta)}
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
      </View>
    </Card>
  );
}
