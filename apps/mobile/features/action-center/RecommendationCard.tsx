import React, { memo, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { Account, DashboardRecommendation } from "@budget-app/shared";
import {
  ACCOUNT_TYPE_LABELS,
  normalizeSeverity,
  recommendationCardCopy,
  recommendationSeverityLabel,
  type RecommendationDisplayState,
} from "@budget-app/shared";
import { Card, IconButton, StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  accountDetailPath,
  getRecommendationDestination,
  getRecommendationSecondaryActions,
  openLedgerNavigation,
  openPaymentPlannerNavigation,
  transferPresetPath,
  type RecommendationAction,
} from "./navigation";
import { RecommendationOverflowSheet } from "./RecommendationOverflowSheet";
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

function runAction(
  action: RecommendationAction,
  router: Router,
  onResolveRisk?: (id: number) => void
): void {
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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const { condition, action } = recommendationCardCopy(rec);
  const inactive = displayState !== "active";
  const destination = useMemo(() => getRecommendationDestination(rec), [rec]);
  const overflowActions = useMemo(
    () =>
      getRecommendationSecondaryActions(rec, {
        includeSnoozeDismiss: Boolean(onSnooze || onDismiss),
      }),
    [rec, onSnooze, onDismiss]
  );

  const accountType = account?.account_type
    ? ACCOUNT_TYPE_LABELS[account.account_type] ?? account.account_type
    : null;
  const contextLine =
    account?.effective_display_name ||
    account?.name ||
    (accountType ?? null);

  const stateLabel =
    displayState === "snoozed" ? "Snoozed" : displayState === "dismissed" ? "Dismissed" : null;

  const onPrimaryPress = useCallback(() => {
    if (!destination) return;
    runAction(destination, router, onResolveRisk);
  }, [destination, router, onResolveRisk]);

  const onOverflowSelect = useCallback(
    (item: RecommendationAction) => {
      setOverflowOpen(false);
      if (item.kind === "snooze") {
        onSnooze?.();
        return;
      }
      if (item.kind === "dismiss") {
        onDismiss?.();
        return;
      }
      runAction(item, router, onResolveRisk);
    },
    [onDismiss, onResolveRisk, onSnooze, router]
  );

  const showOverflow = !inactive && overflowActions.length > 0;

  return (
    <Card style={inactive ? { opacity: 0.75 } : undefined}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
        <Pressable
          onPress={inactive || !destination ? undefined : onPrimaryPress}
          accessibilityRole={destination && !inactive ? "button" : undefined}
          accessibilityLabel={rec.title}
          disabled={inactive || !destination}
          style={{ flex: 1 }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1, paddingRight: 4 }}>
              <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                {rec.title}
              </Text>
              {contextLine ? (
                <Text
                  style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}
                >
                  {contextLine}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
              {stateLabel ? (
                <Text
                  style={{
                    color: theme.colors.textMuted,
                    ...theme.typography.caption,
                    fontWeight: "600",
                    marginTop: 6,
                  }}
                >
                  {stateLabel}
                </Text>
              ) : null}
              <StatusChip
                label={recommendationSeverityLabel(rec.severity).toUpperCase()}
                tone={severityTone(rec.severity)}
              />
            </View>
          </View>

          {condition ? (
            <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 10 }}>
              {condition}
            </Text>
          ) : null}

          {!inactive && (action || destination) ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 10,
              }}
            >
              <Text
                style={{
                  flex: 1,
                  color: theme.colors.text,
                  ...theme.typography.caption,
                  fontWeight: "600",
                }}
                numberOfLines={2}
              >
                {action ?? destination?.label ?? "View details"}
              </Text>
              <FontAwesome name="chevron-right" size={12} color={theme.colors.textMuted} />
            </View>
          ) : null}
        </Pressable>

        {showOverflow ? (
          <IconButton
            name="ellipsis-h"
            accessibilityLabel="More recommendation actions"
            size={18}
            onPress={() => setOverflowOpen(true)}
          />
        ) : null}
      </View>

      {inactive ? (
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
      ) : null}

      <RecommendationOverflowSheet
        visible={overflowOpen}
        title={rec.title}
        actions={overflowActions}
        onClose={() => setOverflowOpen(false)}
        onSelect={onOverflowSelect}
      />
    </Card>
  );
});
