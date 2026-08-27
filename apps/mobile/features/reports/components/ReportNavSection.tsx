import React from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Card } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  title: string;
  onPress: () => void;
  accessibilityHint?: string;
  children: React.ReactNode;
  footerLabel?: string;
};

/** Compact Overview section: whole card taps through; single chevron / see-details footer. */
export function ReportNavSection({
  title,
  onPress,
  accessibilityHint,
  children,
  footerLabel = "See details",
}: Props) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint ?? footerLabel}
      style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}
    >
      <Card>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: theme.spacing.sm,
          }}
        >
          <Text style={{ color: theme.colors.text, ...theme.typography.headline }}>{title}</Text>
          <FontAwesome name="chevron-right" size={12} color={theme.colors.textMuted} />
        </View>
        {children}
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: 10 }}>
          {footerLabel}
        </Text>
      </Card>
    </Pressable>
  );
}
