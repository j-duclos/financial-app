import React from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/theme";

type Props = {
  value: number | string | null | undefined;
  label?: string;
  /** User-configured utilization target (0–100). Used as warning threshold — not industry defaults. */
  warnAt?: number;
  criticalAt?: number;
};

export function UtilizationDisplay({
  value,
  label = "Utilization",
  warnAt = 10,
  criticalAt,
}: Props) {
  const theme = useTheme();
  const n = typeof value === "string" ? parseFloat(value) : value ?? NaN;
  const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  const criticalThreshold = criticalAt ?? warnAt * 2;
  const tone =
    !Number.isFinite(n) ? "neutral" : n >= criticalThreshold ? "critical" : n >= warnAt ? "warning" : "positive";
  const barColor =
    tone === "critical"
      ? theme.colors.critical
      : tone === "warning"
        ? theme.colors.warning
        : theme.colors.moneyPositive;
  const text =
    Number.isFinite(n) ? `${Math.round(n)}%` : "—";

  return (
    <View
      accessible
      accessibilityLabel={`${label} ${text}${tone !== "neutral" && tone !== "positive" ? `, ${tone}` : ""}`}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>{label}</Text>
        <Text style={{ color: theme.colors.text, ...theme.typography.caption, fontWeight: "600" }}>
          {text}
        </Text>
      </View>
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: theme.colors.surfaceMuted,
          overflow: "hidden",
        }}
      >
        <View style={{ width: `${pct}%`, height: "100%", backgroundColor: barColor }} />
      </View>
    </View>
  );
}
