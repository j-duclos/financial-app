import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Card } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  title: string;
  subtitle?: string;
  initiallyExpanded?: boolean;
  children: React.ReactNode;
};

export function CollapsibleReportSection({
  title,
  subtitle,
  initiallyExpanded = false,
  children,
}: Props) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(initiallyExpanded);

  return (
    <Card>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}${expanded ? ", expanded" : ", collapsed"}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>{title}</Text>
          {subtitle && !expanded ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
          ) : null}
        </View>
        <FontAwesome
          name={expanded ? "chevron-up" : "chevron-down"}
          size={12}
          color={theme.colors.textMuted}
        />
      </Pressable>
      {expanded ? <View style={{ marginTop: 12 }}>{children}</View> : null}
    </Card>
  );
}
