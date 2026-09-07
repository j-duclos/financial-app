import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listProjectedFundsAlerts, patchProjectedFundsAlert } from "@budget-app/api-client";
import {
  PROJECTED_FUNDS_ALERTS_QUERY_KEY,
  unreadProjectedFundsAlerts,
  type ProjectedFundsAlert,
} from "@budget-app/shared";
import { BottomSheet, Button, Card } from "@/components/ui";
import { useTheme } from "@/theme";
import { useAuth } from "@/features/auth";
import { accountDetailPath, transactionsForForecastRiskPath } from "@/features/payment-planner/navigation";

export function ProjectedFundsInAppBanner() {
  const theme = useTheme();
  const router = useRouter();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState<ProjectedFundsAlert | null>(null);
  const enabled = auth.isAuthenticated && auth.profile?.projected_funds_alerts_enabled !== false;

  const { data } = useQuery({
    queryKey: [...PROJECTED_FUNDS_ALERTS_QUERY_KEY, "unread"],
    queryFn: () => listProjectedFundsAlerts({ active: true, unread: true, page_size: 10 }),
    staleTime: 60_000,
    enabled,
  });
  const alert = unreadProjectedFundsAlerts(data?.results)[0] ?? null;
  const mark = useMutation({
    mutationFn: (payload: { id: number; dismissed?: boolean; read?: boolean }) =>
      patchProjectedFundsAlert(payload.id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...PROJECTED_FUNDS_ALERTS_QUERY_KEY] });
    },
  });

  if (!enabled || (!alert && !detail)) return null;

  return (
    <>
      {alert ? (
        <Pressable
          onPress={() => {
            setDetail(alert);
            mark.mutate({ id: alert.id, read: true });
          }}
          style={{
            backgroundColor: theme.colors.warningBg,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
          }}
          accessibilityRole="button"
          testID="projected-funds-mobile-banner"
        >
          <Text style={{ color: theme.colors.text, ...theme.typography.body }}>{alert.banner_message}</Text>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
            View details
          </Text>
        </Pressable>
      ) : null}
      <ProjectedFundsAlertSheet
        alert={detail}
        onClose={() => setDetail(null)}
        onDismiss={() => {
          if (detail) mark.mutate({ id: detail.id, dismissed: true });
          setDetail(null);
        }}
        onLedger={() => {
          if (!detail) return;
          router.push(
            transactionsForForecastRiskPath({
              accountId: detail.account,
              focusDate: detail.occurrence_date,
              focusTransactionId: detail.transaction,
            })
          );
          setDetail(null);
        }}
        onForecast={() => {
          if (!detail) return;
          router.push(accountDetailPath(detail.account));
          setDetail(null);
        }}
      />
    </>
  );
}

export function ProjectedFundsAlertSheet({
  alert,
  onClose,
  onDismiss,
  onLedger,
  onForecast,
}: {
  alert: ProjectedFundsAlert | null;
  onClose: () => void;
  onDismiss: () => void;
  onLedger: () => void;
  onForecast: () => void;
}) {
  const theme = useTheme();
  return (
    <BottomSheet visible={alert != null} title={alert?.title ?? "Alert"} onClose={onClose}>
      {alert ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>{alert.body}</Text>
          <Text style={{ color: theme.colors.text, ...theme.typography.caption }}>
            Account: {alert.account_name}
          </Text>
          <Text style={{ color: theme.colors.text, ...theme.typography.caption }}>
            {alert.payee || "Payment"} · {alert.occurrence_date} · ${alert.amount}
          </Text>
          <Text style={{ color: theme.colors.text, ...theme.typography.caption }}>
            Before ${alert.projected_balance_before} → after ${alert.projected_balance_after}
          </Text>
          <Text style={{ color: theme.colors.text, ...theme.typography.body }}>
            Shortfall: {alert.shortfall_display}
          </Text>
          <Button label="View in ledger" onPress={onLedger} />
          <Button label="View forecast" variant="secondary" onPress={onForecast} />
          <Button label="Dismiss" variant="ghost" onPress={onDismiss} />
        </View>
      ) : null}
    </BottomSheet>
  );
}

export function ProjectedFundsActionCards({ highlightId }: { highlightId?: number | null }) {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState<ProjectedFundsAlert | null>(null);
  const { data } = useQuery({
    queryKey: [...PROJECTED_FUNDS_ALERTS_QUERY_KEY, "active"],
    queryFn: () => listProjectedFundsAlerts({ active: true, page_size: 50 }),
    staleTime: 60_000,
  });
  const mark = useMutation({
    mutationFn: (payload: { id: number; dismissed?: boolean; read?: boolean }) =>
      patchProjectedFundsAlert(payload.id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...PROJECTED_FUNDS_ALERTS_QUERY_KEY] });
    },
  });
  const alerts = data?.results ?? [];
  if (alerts.length === 0 && !detail) return null;
  return (
    <View style={{ marginBottom: theme.spacing.lg, gap: theme.spacing.sm }}>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.label, textTransform: "uppercase" }}>
        Projected insufficient funds
      </Text>
      {alerts.map((alert) => (
        <Card key={alert.id}>
          <Pressable
            onPress={() => {
              setDetail(alert);
              mark.mutate({ id: alert.id, read: true });
            }}
            style={{
              borderWidth: highlightId === alert.id ? 1 : 0,
              borderColor: theme.colors.warning,
              borderRadius: theme.radius.md,
            }}
          >
            <Text style={{ color: theme.colors.text, ...theme.typography.body }}>{alert.title}</Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
              {alert.body}
            </Text>
          </Pressable>
        </Card>
      ))}
      <ProjectedFundsAlertSheet
        alert={detail}
        onClose={() => setDetail(null)}
        onDismiss={() => {
          if (detail) mark.mutate({ id: detail.id, dismissed: true });
          setDetail(null);
        }}
        onLedger={() => {
          if (!detail) return;
          router.push(
            transactionsForForecastRiskPath({
              accountId: detail.account,
              focusDate: detail.occurrence_date,
              focusTransactionId: detail.transaction,
            })
          );
          setDetail(null);
        }}
        onForecast={() => {
          if (!detail) return;
          router.push(accountDetailPath(detail.account));
          setDetail(null);
        }}
      />
    </View>
  );
}
