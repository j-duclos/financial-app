import type { Href } from "expo-router";

/** Safe fallback when a secondary screen has no stack history (e.g. deep link). */
export const SECONDARY_SCREEN_BACK_FALLBACK: Href = "/more";

type StackRouter = {
  back: () => void;
  replace: (href: Href) => void;
};

/**
 * Pop the navigation stack when history exists; otherwise replace with a tab fallback.
 * Prefer this over hard-coding Home/More so Dashboard → Accounts → Back returns Home.
 */
export function navigateStackBack(
  router: StackRouter,
  navigation: { canGoBack: () => boolean },
  fallbackHref: Href = SECONDARY_SCREEN_BACK_FALLBACK
): void {
  if (navigation.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallbackHref);
}
