import { useEffect } from "react";
import { useRouter } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useAuth } from "@/context/AuthContext";

export default function Index() {
  const { auth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.loading) return;
    if (auth.access) {
      router.replace("/(tabs)");
    } else {
      router.replace("/(auth)/login");
    }
  }, [auth.loading, auth.access]);

  if (auth.loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
});
