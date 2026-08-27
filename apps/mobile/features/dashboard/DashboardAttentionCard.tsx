import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import type { DashboardAttentionItem } from "@budget-app/shared";
import {
  attentionAccountTypeLabel,
  attentionActionLine,
  attentionPrimaryIssue,
  attentionSeverityLabel,
  attentionShowsActionLine,
} from "@budget-app/shared";
import { Card, StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  attentionCardAccessibilityLabel,
  attentionCardTapDestination,
} from "./navigation";
import { markAttentionNavigation } from "./attentionNavigationTiming";
import { attentionPrimaryIssueDisplay, attentionStatusTone } from "./display";

type Props = {
  item: DashboardAttentionItem;
};

function AccountTypePill({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.surfaceMuted,
        borderRadius: theme.radius.sm,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.label, fontSize: 11 }}>
        {label}
      </Text>
    </View>
  );
}

/** Bold the leading action + amount segment (e.g. "Pay $590.96"). */
function AttentionActionText({ line }: { line: string }) {
  const theme = useTheme();
  const boldPrefix = line.match(/^(.+?\$[\d,]+(?:\.\d{2})?)/)?.[1];
  const regularStyle = { color: theme.colors.text, ...theme.typography.body, lineHeight: 20 };
  const boldStyle = { ...regularStyle, ...theme.typography.bodyStrong };

  if (boldPrefix && boldPrefix.length < line.length) {
    return (
      <Text style={regularStyle}>
        <Text style={boldStyle}>{boldPrefix}</Text>
        {line.slice(boldPrefix.length)}
      </Text>
    );
  }

  return <Text style={boldStyle}>{line}</Text>;
}

export const DashboardAttentionCard = memo(function DashboardAttentionCard({ item }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const issueLine = attentionPrimaryIssueDisplay(attentionPrimaryIssue(item));
  const actionLine = attentionShowsActionLine(item) ? attentionActionLine(item) : null;
  const accessibilityLabel = attentionCardAccessibilityLabel(item);

  const onPress = () => {
    markAttentionNavigation("attention-tap");
    router.push(attentionCardTapDestination(item) as never);
    markAttentionNavigation("navigation-started");
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}
    >
      <Card style={{ paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}>
        {/* Row 1: account name + type pill ············· status */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, flexShrink: 1 }}>
            <Text
              style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}
              numberOfLines={1}
            >
              {item.account_name}
            </Text>
            <AccountTypePill label={attentionAccountTypeLabel(item)} />
          </View>
          <StatusChip
            label={attentionSeverityLabel(item.status)}
            tone={attentionStatusTone(item.status)}
          />
        </View>

        {/* Row 2: issue ············· chevron */}
        {issueLine ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: theme.spacing.sm,
              gap: 8,
            }}
          >
            <Text
              style={{ color: theme.colors.text, ...theme.typography.body, flex: 1, lineHeight: 20 }}
              numberOfLines={1}
            >
              {issueLine}
            </Text>
            <FontAwesome
              name="chevron-right"
              size={12}
              color={theme.colors.textMuted}
              accessibilityElementsHidden
            />
          </View>
        ) : null}

        {/* Row 3: recommended action */}
        {actionLine ? (
          <View style={{ marginTop: 4 }}>
            <AttentionActionText line={actionLine} />
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
});
