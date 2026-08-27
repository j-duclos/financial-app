import React from "react";
import { View } from "react-native";
import { Card, Skeleton } from "@/components/ui";
import { useTheme } from "@/theme";

/** Compact attention-row placeholder (~2–3 visible cards). */
export function AttentionRowsSkeleton({ count = 2 }: { count?: number }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {Array.from({ length: count }).map((_, index) => (
        <Card
          key={index}
          style={{ paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.lg, gap: 8 }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Skeleton height={16} width="42%" />
            <Skeleton height={20} width={56} />
          </View>
          <Skeleton height={14} width="78%" />
        </Card>
      ))}
    </View>
  );
}

/** One grouped-list skeleton with ~3 transaction rows. */
export function UpcomingPreviewSkeleton() {
  const theme = useTheme();
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {Array.from({ length: 3 }).map((_, index) => (
        <View
          key={index}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderTopWidth: index > 0 ? 1 : 0,
            borderTopColor: theme.colors.border,
            gap: 12,
          }}
        >
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton height={14} width="62%" />
            <Skeleton height={12} width="38%" />
          </View>
          <Skeleton height={16} width={56} />
        </View>
      ))}
    </Card>
  );
}

/** One compact goal-card skeleton. */
export function GoalCardSkeleton() {
  const theme = useTheme();
  return (
    <Card style={{ gap: 8 }}>
      <Skeleton height={16} width="55%" />
      <Skeleton height={10} width="100%" />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Skeleton height={12} width="40%" />
        <Skeleton height={12} width="28%" />
      </View>
    </Card>
  );
}
