import React, { useState } from "react";
import { Image, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import { APP_NAME } from "@budget-app/shared";
import { useTheme } from "@/theme";
import { BrandWordmark } from "./BrandWordmark";
import type { BrandSize } from "./types";
import logoSource from "../../assets/branding/flowsight-logo.jpg";

export type { BrandSize };

const HEIGHT: Record<BrandSize, number> = {
  small: 72,
  medium: 120,
  large: 176,
};

type Props = {
  size?: BrandSize;
  style?: StyleProp<ViewStyle>;
};

export function BrandLogo({ size = "medium", style }: Props) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const height = HEIGHT[size];

  if (failed) {
    return (
      <View style={[{ alignItems: "center" }, style]} accessibilityRole="image" accessibilityLabel={APP_NAME}>
        <BrandWordmark size={size} />
      </View>
    );
  }

  const imageStyle: ImageStyle = {
    height,
    width: height * 0.95,
    backgroundColor: theme.mode === "dark" ? "#FFFFFF" : undefined,
    borderRadius: theme.radius.md,
  };

  return (
    <View style={[{ alignItems: "center" }, style]}>
      <Image
        source={logoSource}
        style={imageStyle}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel={APP_NAME}
        onError={() => setFailed(true)}
      />
    </View>
  );
}
