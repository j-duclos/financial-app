import React from "react";
import { Pressable, Text, View } from "react-native";
import { IconButton } from "@/components/ui";
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
        marginBottom: theme.spacing.sm,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit change: ${title}. ${detail}`}
        style={({ pressed }) => ({
          opacity: pressed ? 0.85 : 1,
          flex: 1,
          padding: theme.spacing.md,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        })}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{title}</Text>
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
            {detail}
          </Text>
        </View>
        <Text style={{ color: theme.colors.textMuted, fontSize: 18 }}>›</Text>
      </Pressable>
      <IconButton
        name="ellipsis-v"
        accessibilityLabel={`Remove ${title}`}
        onPress={onRemove}
      />
    </View>
  );
}
