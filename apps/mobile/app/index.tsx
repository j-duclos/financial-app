import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/features/auth";
import { LoadingScreen } from "@/components/brand";

export default function Index() {
  const { auth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.initializing) return;
    if (auth.isAuthenticated) {
      router.replace("/(app)/(tabs)");
    } else {
      router.replace("/(auth)/login");
    }
  }, [auth.initializing, auth.isAuthenticated, router]);

  return <LoadingScreen />;
}
