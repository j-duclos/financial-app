import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Text, View } from "react-native";
import { APP_NAME, APP_TAGLINE } from "@budget-app/shared";
import { useTheme } from "@/theme";
import { BrandLogo } from "./BrandLogo";

type Props = {
  showTagline?: boolean;
  accessibilityLabel?: string;
};

export function LoadingScreen({ showTagline = true, accessibilityLabel }: Props) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.background,
        paddingHorizontal: theme.spacing.xl,
      }}
      accessibilityLabel={accessibilityLabel ?? `Loading ${APP_NAME}`}
      accessibilityRole="progressbar"
    >
      <Animated.View style={{ alignItems: "center", opacity }}>
        <BrandLogo size="large" />
        {showTagline ? (
          <Text
            style={{
              color: theme.colors.textMuted,
              ...theme.typography.caption,
              textAlign: "center",
              marginTop: theme.spacing.md,
            }}
          >
            {APP_TAGLINE}
          </Text>
        ) : null}
        <ActivityIndicator
          size="small"
          color={theme.colors.tint}
          style={{ marginTop: theme.spacing.xl }}
        />
      </Animated.View>
    </View>
  );
}
