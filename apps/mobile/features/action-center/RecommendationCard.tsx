import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Account, DashboardRecommendation } from "@budget-app/shared";
import {
  ACCOUNT_TYPE_LABELS,
  normalizeSeverity,
  recommendationCardCopy,
  recommendationSeverityLabel,
  type RecommendationDisplayState,
} from "@budget-app/shared";
import { Card, StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  accountDetailPath,
  openLedgerNavigation,
  openPaymentPlannerNavigation,
  recommendationActions,
  transferPresetPath,
  type RecommendationAction,
} from "./navigation";
import type { Router } from "expo-router";

function severityTone(severity: string): "positive" | "warning" | "critical" | "neutral" {
  const level = normalizeSeverity(severity);
  switch (level) {
    case "critical":
      return "critical";
    case "at_risk":
      return "warning";
    case "watch":
      return "warning";
    default:
      return "neutral";
  }
}

function ActionButton({
  label,
  primary,
  onPress,
}: {
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: theme.radius.sm,
        borderWidth: primary ? 0 : 1,
        borderColor: theme.colors.border,
        backgroundColor: primary ? theme.colors.tint : theme.colors.surface,
      })}
    >
      <Text
        style={{
          color: primary ? "#fff" : theme.colors.text,
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type Props = {
  rec: DashboardRecommendation;
  displayState?: RecommendationDisplayState;
  account?: Account | null;
  router: Router;
  onResolveRisk?: (accountId: number) => void;
  onSnooze?: () => void;
  onDismiss?: () => void;
  onRestore?: () => void;
  onUnsnooze?: () => void;
};

function runAction(action: RecommendationAction, router: Router, onResolveRisk?: (id: number) => void) {
  switch (action.kind) {
    case "open_ledger":
      if (action.accountId != null) router.push(openLedgerNavigation(action.accountId));
      break;
    case "payment_planner":
      if (action.accountId != null) router.push(openPaymentPlannerNavigation(action.accountId));
      break;
    case "transfer":
      if (action.transferPreset) router.push(transferPresetPath(action.transferPreset));
      else if (action.accountId != null) router.push(accountDetailPath(action.accountId));
      break;
    case "resolve_risk":
      if (action.accountId != null) onResolveRisk?.(action.accountId);
      break;
    case "navigate":
      if (action.href) router.push(action.href as never);
      break;
    case "view_account":
      if (action.accountId != null) router.push(accountDetailPath(action.accountId));
      break;
    default:
      break;
  }
}

export const RecommendationCard = memo(function RecommendationCard({
  rec,
  displayState = "active",
  account,
  router,
  onResolveRisk,
  onSnooze,
  onDismiss,
  onRestore,
  onUnsnooze,
}: Props) {
  const theme = useTheme();
  const { condition, action } = recommendationCardCopy(rec);
  const inactive = displayState !== "active";
  const actions = recommendationActions(rec);
  const accountType = account?.account_type
    ? ACCOUNT_TYPE_LABELS[account.account_type] ?? account.account_type
    : null;
  const accountId = rec.account_id ?? account?.id ?? null;

  const openAccount = () => {
    if (accountId != null) router.push(accountDetailPath(accountId));
  };

  const stateLabel =
    displayState === "snoozed" ? "Snoozed" : displayState === "dismissed" ? "Dismissed" : null;

  return (
    <Card style={inactive ? { opacity: 0.75 } : undefined}>
      <Pressable
        onPress={accountId != null ? openAccount : undefined}
        accessibilityRole={accountId != null ? "button" : undefined}
        accessibilityLabel={rec.title}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{rec.title}</Text>
            {accountType ? (
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
                {accountType}
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {stateLabel ? (
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, fontWeight: "600" }}>
                {stateLabel}
              </Text>
            ) : null}
            <StatusChip
              label={recommendationSeverityLabel(rec.severity).toUpperCase()}
              tone={severityTone(rec.severity)}
            />
          </View>
        </View>
      </Pressable>

      {condition ? (
        <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 10 }}>{condition}</Text>
      ) : null}
      {action ? (
        <Text style={{ color: theme.colors.text, ...theme.typography.caption, marginTop: 6, fontWeight: "600" }}>
          {action}
        </Text>
      ) : null}

      {!inactive ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {actions.map((item, index) => (
            <ActionButton
              key={`${item.kind}-${item.label}`}
              label={item.label}
              primary={index === actions.length - 1 && item.kind !== "open_ledger"}
              onPress={() => runAction(item, router, onResolveRisk)}
            />
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
          {displayState === "snoozed" && onUnsnooze ? (
            <Pressable onPress={onUnsnooze} accessibilityRole="button" accessibilityLabel="Unsnooze">
              <Text style={{ color: theme.colors.tint, fontWeight: "600" }}>Unsnooze</Text>
            </Pressable>
          ) : null}
          {displayState === "dismissed" && onRestore ? (
            <Pressable onPress={onRestore} accessibilityRole="button" accessibilityLabel="Restore">
              <Text style={{ color: theme.colors.tint, fontWeight: "600" }}>Restore</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {!inactive && (onSnooze || onDismiss) ? (
        <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
          {onSnooze ? (
            <Pressable onPress={onSnooze} accessibilityRole="button" accessibilityLabel="Snooze recommendation">
              <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>Snooze</Text>
            </Pressable>
          ) : null}
          {onDismiss ? (
            <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss recommendation">
              <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>Dismiss</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
});
