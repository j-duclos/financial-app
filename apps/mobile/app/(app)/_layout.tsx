import { Redirect, Stack, usePathname } from "expo-router";
import { View } from "react-native";
import { LoadingScreen } from "@/components/brand";
import { useAuth } from "@/features/auth";
import { NotificationPermissionSheet, ProjectedFundsInAppBanner, useProjectedFundsPush } from "@/features/alerts";
import { ReviewPromptHost } from "@/features/review";
import { setPendingPostLoginRedirect } from "@/lib/postLoginRedirect";

function ProjectedFundsPushHost() {
  const { askVisible, enable, dismiss } = useProjectedFundsPush();
  return (
    <NotificationPermissionSheet
      visible={askVisible}
      onEnable={() => void enable()}
      onNotNow={() => void dismiss()}
    />
  );
}

export default function AppLayout() {
  const { auth } = useAuth();
  const pathname = usePathname();

  if (auth.initializing) {
    return <LoadingScreen />;
  }

  if (!auth.isAuthenticated) {
    if (pathname && pathname !== "/") {
      setPendingPostLoginRedirect(pathname);
    }
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <ReviewPromptHost>
    <View style={{ flex: 1 }}>
      <ProjectedFundsInAppBanner />
      <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="account/[id]" />
      <Stack.Screen name="account/new" />
      <Stack.Screen name="account/edit/[id]" />
      <Stack.Screen name="transaction/[id]" />
      <Stack.Screen name="transaction/new" />
      <Stack.Screen name="transaction/edit/[id]" />
      <Stack.Screen name="recurring" />
      <Stack.Screen name="recurring/[id]" />
      <Stack.Screen name="recurring/new" />
      <Stack.Screen name="recurring/edit/[id]" />
      <Stack.Screen name="budget/index" />
      <Stack.Screen name="budget/[targetId]" />
      <Stack.Screen name="spending-limits" />
      <Stack.Screen name="spending-limits/new" />
      <Stack.Screen name="spending-limits/edit/[id]" />
      <Stack.Screen name="goals" />
      <Stack.Screen name="goal/[id]" />
      <Stack.Screen name="goal/new" />
      <Stack.Screen name="goal/edit/[id]" />
      <Stack.Screen name="action-center" />
      <Stack.Screen name="payment-planner" />
      <Stack.Screen name="payment-planner/plan-details" />
      <Stack.Screen name="what-if" />
      <Stack.Screen name="reports" />
      <Stack.Screen name="reports/[type]" />
      <Stack.Screen name="reports/category/[categoryId]" />
      <Stack.Screen name="automation" />
      <Stack.Screen name="automation/[id]" />
      <Stack.Screen name="automation/new" />
      <Stack.Screen name="automation/edit/[id]" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="categories/new" />
      <Stack.Screen name="categories/edit/[id]" />
      <Stack.Screen name="reconcile" />
      <Stack.Screen name="reconcile/session/[id]" />
      <Stack.Screen name="profile" />
    </Stack>
      </View>
      <ProjectedFundsPushHost />
    </View>
    </ReviewPromptHost>
  );
}
