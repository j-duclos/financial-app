import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/theme";

type NetInfoModule = {
  fetch: () => Promise<{ isConnected: boolean | null; isInternetReachable: boolean | null }>;
  addEventListener: (
    listener: (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void
  ) => { remove: () => void };
};

let netInfoModule: NetInfoModule | null = null;

async function loadNetInfo(): Promise<NetInfoModule | null> {
  if (netInfoModule) return netInfoModule;
  try {
    const mod = await import("@react-native-community/netinfo");
    netInfoModule = mod.default as NetInfoModule;
    return netInfoModule;
  } catch {
    return null;
  }
}

/** Subtle banner when the device appears offline. Read-only cached data may still show. */
export function OfflineBanner() {
  const theme = useTheme();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      const netInfo = await loadNetInfo();
      if (!netInfo || !mounted) return;

      const apply = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => {
        const unreachable =
          state.isConnected === false ||
          (state.isInternetReachable === false && state.isConnected !== true);
        setOffline(unreachable);
      };

      const initial = await netInfo.fetch();
      apply(initial);
      unsubscribe = netInfo.addEventListener(apply).remove;
    })();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  if (!offline) return null;

  return (
    <View
      style={{
        backgroundColor: theme.colors.warningBg,
        paddingVertical: 6,
        paddingHorizontal: theme.spacing.lg,
      }}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
    >
      <Text style={{ color: theme.colors.text, textAlign: "center", fontSize: 13, fontWeight: "600" }}>
        Offline — showing cached data where available
      </Text>
    </View>
  );
}
