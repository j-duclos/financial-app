import React from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useTheme } from "@/theme";

type Props = {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
};

export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  showChevron = !!onPress,
}: Props) {
  const theme = useTheme();
  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: theme.touchTarget,
        paddingVertical: theme.spacing.md,
        borderBottomWidth: StyleSheetHairline,
        borderBottomColor: theme.colors.border,
        gap: theme.spacing.md,
      }}
    >
      {left}
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{title}</Text>
        {subtitle ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {showChevron ? (
        <FontAwesome name="chevron-right" size={12} color={theme.colors.textMuted} />
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

const StyleSheetHairline = 1 / 2;
