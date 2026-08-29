import React from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { CurrencyDisplay } from "@/components/ui";
import { useTheme } from "@/theme";
import type { AccountRiskPresentation } from "./calendarPresentation";

type Props = {
  risk: AccountRiskPresentation;
  onPress?: () => void;
};

/** Compact account-level forecast risk for today/future days only. */
export function AccountRiskSection({ risk, onPress }: Props) {
  const theme = useTheme();
  const fg = risk.tone === "critical" ? theme.colors.critical : theme.colors.warning;
  const bg = risk.tone === "critical" ? theme.colors.criticalBg : theme.colors.warningBg;

  const content = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <FontAwesome name="exclamation-triangle" size={14} color={fg} />
        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>Account risk</Text>
      </View>
      <View style={{ marginTop: 8, gap: 4 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{risk.accountName}</Text>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{risk.balanceLabel}</Text>
          <CurrencyDisplay
            amount={risk.balanceAmount}
            tone={risk.tone === "critical" ? "negative" : "neutral"}
            style={{ fontSize: 15, fontWeight: "700" }}
          />
        </View>
        {risk.detail ? (
          <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{risk.detail}</Text>
        ) : null}
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${risk.accountName} account risk. ${risk.balanceLabel} ${risk.balanceAmount}. ${risk.detail ?? ""}`}
        style={{
          marginTop: 8,
          padding: 12,
          borderRadius: theme.radius.md,
          backgroundColor: bg,
        }}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      accessibilityRole="text"
      style={{
        marginTop: 8,
        padding: 12,
        borderRadius: theme.radius.md,
        backgroundColor: bg,
      }}
    >
      {content}
    </View>
  );
}
