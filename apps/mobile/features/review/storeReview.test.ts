import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-store-review", () => ({
  isAvailableAsync: vi.fn(),
  requestReview: vi.fn(),
}));

vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn() },
  Platform: { OS: "ios" },
}));

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: {}, android: { package: "com.budgetapp.mobile" } } },
}));

import { requestStoreReview, type StoreReviewBridge } from "./storeReview";
import { iosWriteReviewUrl } from "./storeConfig";

function bridge(overrides: Partial<StoreReviewBridge> = {}): StoreReviewBridge {
  return {
    isAvailableAsync: async () => false,
    requestReview: async () => undefined,
    openUrl: async () => true,
    platform: "ios",
    iosListingUrl: () => null,
    androidListingUrl: () => "https://play.google.com/store/apps/details?id=com.budgetapp.mobile",
    ...overrides,
  };
}

describe("store review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses StoreReview on iOS when available", async () => {
    const requestReview = vi.fn(async () => undefined);
    const result = await requestStoreReview(
      bridge({
        platform: "ios",
        isAvailableAsync: async () => true,
        requestReview,
      })
    );
    expect(result).toBe("native");
    expect(requestReview).toHaveBeenCalledOnce();
  });

  it("falls back to the App Store listing when native review is unavailable", async () => {
    const openUrl = vi.fn(async () => true);
    const url = "https://apps.apple.com/app/id1234567890?action=write-review";
    const result = await requestStoreReview(
      bridge({
        platform: "ios",
        isAvailableAsync: async () => false,
        iosListingUrl: () => url,
        openUrl,
      })
    );
    expect(result).toBe("listing");
    expect(openUrl).toHaveBeenCalledWith(url);
  });

  it("fails gracefully when the iOS App Store id is missing", async () => {
    const openUrl = vi.fn(async () => true);
    const result = await requestStoreReview(
      bridge({
        platform: "ios",
        isAvailableAsync: async () => false,
        iosListingUrl: () => null,
        openUrl,
      })
    );
    expect(result).toBe("unavailable");
    expect(openUrl).not.toHaveBeenCalled();
    expect(iosWriteReviewUrl("")).toBeNull();
    expect(iosWriteReviewUrl("YOUR_APP_ID")).toBeNull();
  });

  it("opens the Play Store listing on Android when native review is unavailable", async () => {
    const openUrl = vi.fn(async () => true);
    const result = await requestStoreReview(
      bridge({
        platform: "android",
        isAvailableAsync: async () => false,
        androidListingUrl: () => "https://play.google.com/store/apps/details?id=com.budgetapp.mobile",
        openUrl,
      })
    );
    expect(result).toBe("listing");
    expect(openUrl).toHaveBeenCalledWith(
      "https://play.google.com/store/apps/details?id=com.budgetapp.mobile"
    );
  });

  it("uses native review on Android when available", async () => {
    const requestReview = vi.fn(async () => undefined);
    const result = await requestStoreReview(
      bridge({
        platform: "android",
        isAvailableAsync: async () => true,
        requestReview,
      })
    );
    expect(result).toBe("native");
    expect(requestReview).toHaveBeenCalledOnce();
  });
});
