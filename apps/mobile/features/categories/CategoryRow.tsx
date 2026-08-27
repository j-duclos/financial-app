import React from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { Category } from "@budget-app/shared";
import { useTheme } from "@/theme";
import { categoryRowSubtitle } from "./categoryList";

type Props = {
  category: Category;
  onPress: () => void;
};

export function CategoryRow({ category, onPress }: Props) {
  const theme = useTheme();
  const subtitle = categoryRowSubtitle(category);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${subtitle}`}
      style={({ pressed }) => ({
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderBottomWidth: StyleSheetHairline,
        borderBottomColor: theme.colors.border,
        opacity: category.is_archived ? 0.7 : 1,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.sm,
        minHeight: theme.touchTarget,
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            color: theme.colors.text,
            fontWeight: "600",
            fontSize: 16,
            textDecorationLine: category.is_archived ? "line-through" : "none",
          }}
          numberOfLines={1}
        >
          {category.name}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <FontAwesome name="chevron-right" size={12} color={theme.colors.textMuted} />
    </Pressable>
  );
}

const StyleSheetHairline = 1 / 2;
