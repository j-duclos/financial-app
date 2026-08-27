import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useCallback } from "react";
import { navigateStackBack, SECONDARY_SCREEN_BACK_FALLBACK } from "./navigateStackBack";

export { navigateStackBack, SECONDARY_SCREEN_BACK_FALLBACK } from "./navigateStackBack";

export function useStackBack(fallbackHref: Href = SECONDARY_SCREEN_BACK_FALLBACK): () => void {
  const router = useRouter();
  const navigation = useNavigation();

  return useCallback(() => {
    navigateStackBack(router, navigation, fallbackHref);
  }, [router, navigation, fallbackHref]);
}
