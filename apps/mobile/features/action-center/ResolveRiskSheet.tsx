import React from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Account } from "@budget-app/shared";
import {
  formatResolveRiskLowest,
  resolveRiskPlannerAccountId,
  resolveRiskTransferPreset,
  resolveRiskViewAccountId,
  simulationPreviewLines,
} from "@budget-app/shared";
import { getResolveRiskPlan } from "@budget-app/api-client";
import { BottomSheet, Button, ErrorState, SkeletonBlock } from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { actionCenterQueryKeys } from "./queryKeys";
import {
  accountDetailPath,
  openPaymentPlannerNavigation,
  transferPresetPath,
} from "./navigation";
import { dismissRecommendation, snoozeResolveRisk } from "./recommendationStorage";
import type { Router } from "expo-router";

type Props = {
  visible: boolean;
  accountId: number;
  accountName: string;
  forecastDays: number;
  accounts: Account[];
  router: Router;
  onClose: () => void;
  onPresentationChanged: () => void;
};

export function ResolveRiskSheet({
  visible,
  accountId,
  accountName,
  forecastDays,
  accounts,
  router,
  onClose,
  onPresentationChanged,
}: Props) {
  const theme = useTheme();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: actionCenterQueryKeys.resolveRisk(accountId, forecastDays),
    queryFn: () => getResolveRiskPlan({ account_id: accountId, days: forecastDays }),
    enabled: visible && accountId > 0,
    staleTime: 30_000,
  });

  const plan = data;
  const actions = plan?.actions ?? [];
  const lowestBalance = plan?.summary?.lowest_projected_balance;

  return (
    <BottomSheet visible={visible} title={`Resolve risk — ${accountName}`} onClose={onClose}>
      {isLoading ? (
        <SkeletonBlock lines={6} />
      ) : isError ? (
        <ErrorState message={describeApiError(error)} onRetry={() => refetch()} />
      ) : !plan ? (
        <Text style={{ color: theme.colors.textMuted }}>No resolve-risk plan available.</Text>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>
            Lowest projected: {formatResolveRiskLowest(lowestBalance)}
          </Text>

          {actions.map((action, index) => {
            const preview = simulationPreviewLines(action.simulation);
            const transferPreset = resolveRiskTransferPreset(action, accounts);
            const viewAccountId = resolveRiskViewAccountId(action);
            const plannerAccountId = resolveRiskPlannerAccountId(action);

            return (
              <View
                key={action.id ?? `action-${index}`}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  padding: theme.spacing.md,
                  gap: 8,
                }}
              >
                <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{action.title}</Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>{action.why}</Text>
                {action.recommended_action ? (
                  <Text style={{ color: theme.colors.text, ...theme.typography.body }}>
                    {action.recommended_action}
                  </Text>
                ) : null}
                {preview.lowestLine ? (
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    {preview.lowestLine}
                  </Text>
                ) : null}
                {preview.improvementLine ? (
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    {preview.improvementLine}
                  </Text>
                ) : null}

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                  {transferPreset ? (
                    <Button
                      label="Apply transfer"
                      onPress={() => {
                        onClose();
                        router.push(transferPresetPath(transferPreset));
                      }}
                    />
                  ) : null}
                  {viewAccountId != null ? (
                    <Button
                      label="View account"
                      variant="secondary"
                      onPress={() => {
                        onClose();
                        router.push(accountDetailPath(viewAccountId));
                      }}
                    />
                  ) : null}
                  {plannerAccountId != null ? (
                    <Button
                      label="Payment Planner"
                      variant="secondary"
                      onPress={() => {
                        onClose();
                        router.push(openPaymentPlannerNavigation(plannerAccountId));
                      }}
                    />
                  ) : null}
                </View>
              </View>
            );
          })}

          <View style={{ flexDirection: "row", gap: 16 }}>
            <Pressable
              onPress={async () => {
                await snoozeResolveRisk(plan?.snooze_id);
                onPresentationChanged();
                onClose();
              }}
            >
              <Text style={{ color: theme.colors.tint, fontWeight: "600" }}>Snooze</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                await dismissRecommendation(`attention-${accountId}`);
                onPresentationChanged();
                onClose();
              }}
            >
              <Text style={{ color: theme.colors.textMuted, fontWeight: "600" }}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheet>
  );
}
