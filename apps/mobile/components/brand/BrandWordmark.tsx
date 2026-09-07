import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { APP_NAME, APP_NAME_PREFIX, APP_NAME_SUFFIX, BRAND_COLORS } from "@budget-app/shared";
import { useTheme } from "@/theme";
import type { BrandSize } from "./types";

const FONT: Record<BrandSize, { fontSize: number; lineHeight: number }> = {
  small: { fontSize: 18, lineHeight: 22 },
  medium: { fontSize: 24, lineHeight: 30 },
  large: { fontSize: 28, lineHeight: 34 },
};

type Props = {
  size?: BrandSize;
  style?: StyleProp<TextStyle>;
};

export function BrandWordmark({ size = "medium", style }: Props) {
  const theme = useTheme();
  const type = FONT[size];

  return (
    <Text
      accessibilityRole="header"
      accessibilityLabel={APP_NAME}
      style={[
        {
          fontWeight: "700",
          letterSpacing: -0.3,
          textAlign: "center",
          ...type,
        },
        style,
      ]}
    >
      <Text style={{ color: theme.mode === "dark" ? theme.colors.text : BRAND_COLORS.navy }}>
        {APP_NAME_PREFIX}
      </Text>
      <Text style={{ color: BRAND_COLORS.teal, fontWeight: "600" }}>{APP_NAME_SUFFIX}</Text>
    </Text>
  );
}
