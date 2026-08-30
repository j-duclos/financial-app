import React from "react";
import { Text, View } from "react-native";
import type { MonthComparisonMetric } from "@budget-app/shared";
import { Card, CurrencyDisplay } from "@/components/ui";
import { financialToneColors, useTheme } from "@/theme";
import { comparisonSubtitle, parseOptionalAmount } from "../reportDisplay";
import { PeriodComparisonBadge } from "./PeriodComparisonBadge";

type Metric = {
  label: string;
  amount: string;
  tone?: "positive" | "negative" | "neutral";
  comparison?: MonthComparisonMetric;
  previousMonth?: string;
  /** How to color MoM deltas — expenses use neutral change styling. */
  comparisonContext?: "income" | "expense" | "net" | "neutral";
};

type Props = {
  metrics: Metric[];
};

export function ReportMetricGrid({ metrics }: Props) {
  const theme = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md }}>
        {metrics.map((m) => {
          const amountN = parseOptionalAmount(m.amount);
          const resolvedTone =
            m.tone ??
            (m.label.toLowerCase().includes("expense")
              ? "negative"
              : m.label.toLowerCase().includes("income")
                ? "positive"
                : amountN == null
                  ? "neutral"
                  : amountN >= 0
                    ? "positive"
                    : "negative");
          const subtitle = m.comparison
            ? comparisonSubtitle(m.comparison.delta, m.comparison.percent_change, m.previousMonth)
            : undefined;
          const comparisonContext =
            m.comparisonContext ??
            (m.label.toLowerCase().includes("expense")
              ? "expense"
              : m.label.toLowerCase().includes("income")
                ? "income"
                : "net");
          return (
            <View key={m.label} style={{ minWidth: "42%" }}>
              <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "600" }}>
                {m.label}
              </Text>
              {amountN == null && !m.amount ? (
                <Text style={{ color: theme.colors.textMuted, fontSize: 18, fontWeight: "600" }}>—</Text>
              ) : (
                <CurrencyDisplay
                  amount={m.amount}
                  tone={resolvedTone === "neutral" ? "neutral" : resolvedTone}
                  showSign={resolvedTone !== "neutral" && amountN != null}
                  style={{ fontSize: 18 }}
                />
              )}
              {subtitle ? (
                <PeriodComparisonBadge
                  text={subtitle}
                  delta={m.comparison?.delta}
                  context={comparisonContext}
                  style={{ marginTop: 4 }}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function ReportSummaryCard({
  label,
  value,
  subtitle,
  tone = "neutral",
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const theme = useTheme();
  const colors = financialToneColors(theme, tone);
  return (
    <Card>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "600" }}>{label}</Text>
      <Text
        accessibilityLabel={`${label} ${value}`}
        style={{ color: colors.fg, fontWeight: "700", fontSize: 22, marginTop: 4 }}
      >
        {value}
      </Text>
      {subtitle ? (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 6 }}>{subtitle}</Text>
      ) : null}
    </Card>
  );
}
