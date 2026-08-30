import React from "react";
import { Text, View } from "react-native";
import type { ScenarioComparisonResponse } from "@budget-app/shared";
import { Card, SkeletonBlock, StatusChip } from "@/components/ui";
import { financialToneColors, useTheme, type FinancialTone } from "@/theme";
import {
  buildPlanSummary,
  comparisonPeriodMonths,
  type PlanSummaryResult,
} from "../display";
import type { PlanIncludeItem } from "../scenarioPlainLanguage";
import type { Account } from "@budget-app/shared";

function resultTone(result: PlanSummaryResult): FinancialTone {
  switch (result) {
    case "SAFE":
      return "positive";
    case "IMPROVED, BUT STILL AT RISK":
      return "warning";
    case "WORSE":
      return "critical";
    default:
      return "neutral";
  }
}

type Props = {
  scenarioName: string;
  comparison: ScenarioComparisonResponse | undefined;
  planItems: PlanIncludeItem[];
  accounts: Account[];
  loading: boolean;
  horizonMonths: number;
  recalculating?: boolean;
  /** Scenario has no hypothetical changes yet — not the same as zero-impact analysis. */
  emptyScenario?: boolean;
  /** Comparison request failed; do not present as Safe / No impact. */
  comparisonFailed?: boolean;
};

export function PlanSummaryCard({
  scenarioName,
  comparison,
  planItems,
  accounts,
  loading,
  horizonMonths,
  recalculating,
  emptyScenario,
  comparisonFailed,
}: Props) {
  const theme = useTheme();

  if (loading && !comparison) {
    return (
      <Card style={{ marginBottom: theme.spacing.md }}>
        <SkeletonBlock lines={4} />
      </Card>
    );
  }

  if (comparisonFailed && !comparison) {
    return (
      <Card style={{ marginBottom: theme.spacing.md }}>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
          WHAT-IF PLAN · {scenarioName.toUpperCase()}
        </Text>
        <Text
          style={{ color: theme.colors.critical, ...theme.typography.headline, marginTop: 8 }}
          accessibilityRole="header"
        >
          Could not recalculate this plan
        </Text>
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 6 }}>
          Your changes are still saved. Retry to see impact — this is not a zero-impact result.
        </Text>
      </Card>
    );
  }

  if (emptyScenario) {
    return (
      <Card style={{ marginBottom: theme.spacing.md }}>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
          WHAT-IF PLAN · {scenarioName.toUpperCase()}
        </Text>
        <Text
          style={{ color: theme.colors.text, ...theme.typography.headline, marginTop: 8 }}
          accessibilityRole="header"
        >
          No hypothetical changes yet
        </Text>
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 6 }}>
          Add income, expenses, or bill changes to see how they affect your forecast. Matching the
          baseline is expected until you add a change.
        </Text>
        {recalculating ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 8 }}>
            Updating scenario…
          </Text>
        ) : null}
      </Card>
    );
  }

  const summary = buildPlanSummary(comparison, planItems, accounts, horizonMonths);
  if (!summary) return null;

  const colors = financialToneColors(theme, resultTone(summary.result));

  return (
    <Card
      style={{
        marginBottom: theme.spacing.md,
        backgroundColor: colors.bg,
        borderColor: colors.fg,
        borderWidth: 1,
      }}
    >
      <Text style={{ color: colors.fg, ...theme.typography.label, letterSpacing: 1, opacity: 0.85 }}>
        WHAT-IF PLAN · {scenarioName.toUpperCase()}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
        <StatusChip label={summary.resultLabel} tone={resultTone(summary.result)} />
        {recalculating ? (
          <Text style={{ color: colors.fg, fontSize: 12, opacity: 0.8 }}>Updating scenario…</Text>
        ) : null}
        {comparisonFailed ? (
          <Text style={{ color: theme.colors.critical, fontSize: 12 }}>Recalculation failed — showing last result</Text>
        ) : null}
      </View>
      <Text style={{ color: colors.fg, ...theme.typography.headline, marginTop: 8 }} accessibilityRole="header">
        {summary.headline}
      </Text>
      {summary.periodNote ? (
        <Text style={{ color: colors.fg, ...theme.typography.caption, marginTop: 4, opacity: 0.85 }}>
          {summary.periodNote}
        </Text>
      ) : null}

      {summary.comparisonRows.length > 0 ? (
        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: `${colors.fg}22` }}>
          <Text style={{ color: colors.fg, ...theme.typography.label, marginBottom: 8 }}>Impact</Text>
          {summary.comparisonRows.map((row) => (
            <View key={row.label} style={{ marginBottom: 6 }}>
              <Text style={{ color: colors.fg, fontSize: 13, opacity: 0.85 }}>{row.label}</Text>
              <Text style={{ color: colors.fg, ...theme.typography.bodyStrong }}>
                {row.before === row.after ? row.after : `${row.before} → ${row.after}`}
              </Text>
              {row.note ? (
                <Text style={{ color: colors.fg, fontSize: 12, opacity: 0.75 }}>{row.note}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {summary.listItems.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          {summary.listHeading ? (
            <Text style={{ color: colors.fg, ...theme.typography.label, marginBottom: 6 }}>
              {summary.listHeading}
            </Text>
          ) : null}
          {summary.listItems.map((line) => (
            <Text key={line} style={{ color: colors.fg, fontSize: 14, marginBottom: 4 }}>
              · {line}
            </Text>
          ))}
        </View>
      ) : null}

      {summary.remainingIssue ? (
        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: `${colors.fg}22` }}>
          <Text style={{ color: colors.fg, ...theme.typography.label, marginBottom: 4 }}>Remaining issue</Text>
          <Text style={{ color: colors.fg, ...theme.typography.bodyStrong }}>{summary.remainingIssue}</Text>
        </View>
      ) : null}
    </Card>
  );
}

export function comparisonHorizonMonths(
  comparison: ScenarioComparisonResponse | undefined,
  horizonMonths: number
): number {
  return comparisonPeriodMonths(comparison, horizonMonths);
}
