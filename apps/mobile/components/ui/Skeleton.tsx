import React, { useEffect } from "react";
import { Animated, View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";

type Props = {
  height?: number;
  width?: number | `${number}%`;
  style?: ViewStyle;
};

export function Skeleton({ height = 16, width = "100%", style }: Props) {
  const theme = useTheme();
  const opacity = React.useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityLabel="Loading"
      style={[
        {
          height,
          width,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.skeleton,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={i === 0 ? 22 : 14} width={i === lines - 1 ? "70%" : "100%"} />
      ))}
    </View>
  );
}
