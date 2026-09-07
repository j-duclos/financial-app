import { Linking, Platform } from "react-native";
import * as StoreReview from "expo-store-review";
import { getGooglePlayStoreUrl, iosWriteReviewUrl } from "./storeConfig";

export type StoreReviewResult = "native" | "listing" | "unavailable";

export type StoreReviewBridge = {
  isAvailableAsync: () => Promise<boolean>;
  requestReview: () => Promise<void>;
  openUrl: (url: string) => Promise<boolean>;
  platform: typeof Platform.OS;
  iosListingUrl: () => string | null;
  androidListingUrl: () => string;
};

function defaultBridge(): StoreReviewBridge {
  return {
    isAvailableAsync: () => StoreReview.isAvailableAsync(),
    requestReview: () => StoreReview.requestReview(),
    openUrl: (url) => Linking.openURL(url),
    platform: Platform.OS,
    iosListingUrl: () => iosWriteReviewUrl(),
    androidListingUrl: () => getGooglePlayStoreUrl(),
  };
}

/**
 * Prefer the platform in-app review API. Fall back to the public listing.
 * Missing store configuration must not throw.
 */
export async function requestStoreReview(bridge: StoreReviewBridge = defaultBridge()): Promise<StoreReviewResult> {
  try {
    if (await bridge.isAvailableAsync()) {
      await bridge.requestReview();
      return "native";
    }
  } catch {
    // Fall through to listing / unavailable.
  }

  try {
    if (bridge.platform === "ios") {
      const url = bridge.iosListingUrl();
      if (!url) return "unavailable";
      await bridge.openUrl(url);
      return "listing";
    }
    if (bridge.platform === "android") {
      const url = bridge.androidListingUrl();
      if (!url) return "unavailable";
      await bridge.openUrl(url);
      return "listing";
    }
  } catch {
    return "unavailable";
  }
  return "unavailable";
}
