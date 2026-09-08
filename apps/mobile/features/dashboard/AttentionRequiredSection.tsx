import React, { memo } from "react";
import { View } from "react-native";
import type { DashboardAttentionItem } from "@budget-app/shared";
import {
  attentionEmptyMessage,
  attentionShowsViewAllLink,
  GETTING_STARTED_HELP_LABELS,
} from "@budget-app/shared";
import { EmptyState, SectionHeader } from "@/components/ui";
import { useTheme } from "@/theme";
import { DASHBOARD_SECTION } from "./terminology";
import { DashboardAttentionCard } from "./DashboardAttentionCard";
import { AttentionRowsSkeleton } from "./DashboardSkeletons";

type Props = {
  forecastDays: number;
  items: DashboardAttentionItem[];
  totalCount: number;
  loading: boolean;
  visible: boolean;
  onViewAll: () => void;
  onHelpPress?: () => void;
};

export const AttentionRequiredSection = memo(function AttentionRequiredSection({
  forecastDays,
  items,
  totalCount,
  loading,
  visible,
  onViewAll,
  onHelpPress,
}: Props) {
  const theme = useTheme();

  if (!visible) {
    return null;
  }

  return (
    <>
      <SectionHeader
        title={DASHBOARD_SECTION.attention}
        subtitle={
          !loading && totalCount > items.length
            ? `Showing ${items.length} of ${totalCount}`
            : undefined
        }
        actionLabel={
          !loading && attentionShowsViewAllLink(items.length, totalCount) ? "View all" : undefined
        }
        onAction={
          !loading && attentionShowsViewAllLink(items.length, totalCount) ? onViewAll : undefined
        }
        infoAccessibilityLabel={GETTING_STARTED_HELP_LABELS.attentionRequired}
        onInfoPress={onHelpPress}
      />
      {loading ? (
        <AttentionRowsSkeleton count={2} />
      ) : items.length === 0 ? (
        <EmptyState title={attentionEmptyMessage(forecastDays)} />
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {items.map((item) => (
            <DashboardAttentionCard key={`${item.account_id}-${item.reason}`} item={item} />
          ))}
        </View>
      )}
    </>
  );
});
