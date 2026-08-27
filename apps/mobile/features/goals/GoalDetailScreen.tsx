import React from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDateDisplay } from "@budget-app/shared";
import {
  goalDetailForecastRows,
  goalDetailProgressLine,
  goalLinkedAccountId,
  goalLinkedAccountName,
  goalListStatusDisplay,
  goalPerPaycheckNeeded,
  goalProjectionLine,
  goalSuggestionLine,
  parseProgressPercent,
} from "@budget-app/shared";
import { getBucketDetail } from "@budget-app/api-client";
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SkeletonBlock,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { GoalProgressBar } from "./GoalProgressBar";
import {
  goalAccountPath,
  goalEditPath,
  goalRelatedTransactionsPath,
  goalWhatIfPath,
  goalsListPath,
} from "./navigation";
import { goalsQueryKeys } from "./queryKeys";

export function GoalDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const goalId = Number(id);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: goalsQueryKeys.detail(goalId),
    queryFn: () => getBucketDetail(goalId),
    enabled: Number.isInteger(goalId) && goalId > 0,
  });

  const goal = data?.goal;
  const history = data?.contribution_history ?? [];
  const pct = goal ? parseProgressPercent(goal.progress_percent) : 0;
  const status = goal ? goalListStatusDisplay(goal) : null;
  const forecastRows = goal ? goalDetailForecastRows(goal) : [];
  const perPaycheck = goal ? goalPerPaycheckNeeded(goal) : null;
  const suggestion = goal ? goalSuggestionLine(goal) : null;
  const projection = goal ? goalProjectionLine(goal) : "";
  const linkedAccountId = goal ? goalLinkedAccountId(goal) : null;
  const linkedAccountName = goal ? goalLinkedAccountName(goal) : null;

  if (!Number.isInteger(goalId) || goalId <= 0) {
    return (
      <Screen scroll={false}>
        <EmptyState title="Invalid goal" message="This goal link is not valid." />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <AppHeader title={goal?.name ?? "Goal"} onBack={() => router.push(goalsListPath())} />

      {isLoading ? (
        <SkeletonBlock lines={10} />
      ) : isError ? (
        <ErrorState message={describeApiError(error)} onRetry={() => refetch()} />
      ) : !goal ? (
        <EmptyState title="Goal not found" message="This goal may have been deleted." />
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: theme.colors.text, ...theme.typography.title, flex: 1 }}>
                {goal.name}
              </Text>
              {status ? <StatusChip label={status.label} tone={status.tone} /> : null}
            </View>

            <View style={{ marginTop: 12 }}>
              <GoalProgressBar percent={pct} />
            </View>

            <Text
              style={{
                color: theme.colors.text,
                ...theme.typography.bodyStrong,
                marginTop: 10,
                textAlign: "center",
              }}
            >
              {goalDetailProgressLine(goal)}
            </Text>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, textAlign: "center" }}>
              {pct}% complete
            </Text>

            {projection ? (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 8 }}>
                {projection}
              </Text>
            ) : null}

            {status && suggestion ? (
              <View style={{ marginTop: 12, gap: 4 }}>
                <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                  Recommendation
                </Text>
                <Text style={{ color: theme.colors.text, ...theme.typography.body }}>{suggestion}</Text>
              </View>
            ) : suggestion ? (
              <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 12 }}>
                {suggestion}
              </Text>
            ) : null}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
              <Button label="Edit goal" variant="secondary" onPress={() => router.push(goalEditPath(goal.id))} />
              <Button
                label="What-If"
                variant="secondary"
                onPress={() => router.push(goalWhatIfPath(goal.id))}
              />
            </View>
          </Card>

          {forecastRows.length > 0 ? (
            <Card>
              <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginBottom: 8 }}>
                Forecast
              </Text>
              {forecastRows.map((row) => (
                <View
                  key={row.label}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingVertical: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                  }}
                >
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    {row.label}
                  </Text>
                  <Text
                    style={{
                      color:
                        row.tone === "shortfall"
                          ? theme.colors.warning
                          : row.tone === "surplus"
                            ? theme.colors.moneyPositive
                            : theme.colors.text,
                      fontWeight: "600",
                    }}
                  >
                    {row.value}
                  </Text>
                </View>
              ))}
              {perPaycheck ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    Per paycheck needed
                  </Text>
                  <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{perPaycheck}</Text>
                </View>
              ) : null}
            </Card>
          ) : null}

          {linkedAccountName ? (
            <Card>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                Linked account
              </Text>
              <Pressable
                onPress={() => linkedAccountId && router.push(goalAccountPath(linkedAccountId))}
                accessibilityRole="button"
                accessibilityLabel={`View account ${linkedAccountName}`}
              >
                <Text style={{ color: theme.colors.tint, ...theme.typography.bodyStrong, marginTop: 4 }}>
                  {linkedAccountName}
                </Text>
              </Pressable>
              {goal.automatic_transfer_label ? (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 8 }}>
                  Automatic funding: {goal.automatic_transfer_label}
                </Text>
              ) : goal.has_automatic_funding === false ? (
                <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
                  No automatic funding configured
                </Text>
              ) : null}
              {linkedAccountId ? (
                <Button
                  label="View related transactions"
                  variant="secondary"
                  style={{ marginTop: 12 }}
                  onPress={() => router.push(goalRelatedTransactionsPath(linkedAccountId))}
                />
              ) : null}
            </Card>
          ) : null}

          {history.length > 0 ? (
            <Card>
              <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginBottom: 8 }}>
                Contribution history
              </Text>
              {history.map((entry) => (
                <View
                  key={entry.id}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                      {formatCurrency(entry.amount)}
                    </Text>
                    <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                      {entry.account_name ?? "Account"} · {entry.source}
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    {formatDateDisplay(entry.date)}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
