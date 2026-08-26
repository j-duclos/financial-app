import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme";
import { planItemDisplayDetail, planItemDisplayTitle, type PlanIncludeItem } from "../scenarioPlainLanguage";

type Props = {
  item: PlanIncludeItem;
  onEdit: () => void;
  onRemove: () => void;
};

export function ScenarioChangeRow({ item, onEdit, onRemove }: Props) {
  const theme = useTheme();
  const title = planItemDisplayTitle(item);
  const detail = planItemDisplayDetail(item);

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.spacing.md,
        marginBottom: theme.spacing.sm,
      }}
      accessibilityLabel={`Hypothetical change: ${title}. ${detail}`}
    >
      <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{title}</Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
        {detail}
      </Text>
      <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${title}`}>
          <Text style={{ color: theme.colors.tint, fontWeight: "600", fontSize: 14 }}>Edit</Text>
        </Pressable>
        <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove ${title}`}>
          <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", fontSize: 14 }}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}
