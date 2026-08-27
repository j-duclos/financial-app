import "react-native-reanimated";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ThemeProvider as NavigationThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useColorScheme, View } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";

import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PrivacyOverlay } from "@/components/PrivacyOverlay";
import { AuthProvider } from "@/features/auth";
import { useAppLifecycleRefresh } from "@/hooks/useAppLifecycleRefresh";
import { createAppQueryClient } from "@/lib/queryClient";
import { initMonitoring } from "@/lib/monitoring";
import { ThemeProvider } from "@/theme";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "index",
};

const queryClient = createAppQueryClient();

SplashScreen.preventAutoHideAsync();

function AppLifecycleBridge() {
  useAppLifecycleRefresh();
  return null;
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  useEffect(() => {
    initMonitoring();
  }, []);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <View style={{ flex: 1 }}>
              <OfflineBanner />
              <AppLifecycleBridge />
              <RootLayoutNav />
              <PrivacyOverlay />
            </View>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <NavigationThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </NavigationThemeProvider>
  );
}
