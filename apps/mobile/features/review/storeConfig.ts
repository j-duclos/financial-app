import Constants from "expo-constants";

type StoreExtra = {
  iosAppStoreId?: string;
  googlePlayStoreUrl?: string;
  androidPackageName?: string;
};

function extra(): StoreExtra {
  return (Constants.expoConfig?.extra ?? {}) as StoreExtra;
}

/** Numeric App Store id only. Empty / placeholder values are treated as unset. */
export function getIosAppStoreId(): string | null {
  const raw = (
    process.env.EXPO_PUBLIC_IOS_APP_STORE_ID ??
    extra().iosAppStoreId ??
    ""
  ).trim();
  if (!/^\d{6,}$/.test(raw)) return null;
  return raw;
}

export function getAndroidPackageName(): string {
  const fromExpo = Constants.expoConfig?.android?.package?.trim();
  const fromExtra = extra().androidPackageName?.trim();
  return fromExpo || fromExtra || "";
}

export function getGooglePlayStoreUrl(): string {
  const override = (
    process.env.EXPO_PUBLIC_GOOGLE_PLAY_STORE_URL ??
    extra().googlePlayStoreUrl ??
    ""
  ).trim();
  if (override) return override.replace(/\/$/, "");
  const pkg = getAndroidPackageName();
  if (!pkg) return "";
  return `https://play.google.com/store/apps/details?id=${pkg}`;
}

export function iosWriteReviewUrl(appStoreId: string | null = getIosAppStoreId()): string | null {
  const id = (appStoreId ?? "").trim();
  if (!/^\d{6,}$/.test(id)) return null;
  return `https://apps.apple.com/app/id${id}?action=write-review`;
}
