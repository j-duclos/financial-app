/** Central product identity. UI should import these instead of hardcoding the name. */

export const APP_NAME = "FlowSight";

export const APP_WEB_URL = "https://flowsight.com";
export const APP_WEB_HOST = "flowsight.com";

export const APP_WEB_COMPANION_MESSAGE =
  "Use FlowSight on the web for the full planning experience.";

export const APP_TAGLINE = "See where your money is headed.";

export const APP_VALUE_STATEMENT =
  "Forecast your cash flow, bills, and balances before they happen.";

export const APP_DESCRIPTION =
  "See your future balance, upcoming bills, and whether you can afford what's next.";

/** Split wordmark: "Flow" (navy) + "Sight" (teal). */
export const APP_NAME_PREFIX = "Flow";
export const APP_NAME_SUFFIX = "Sight";

/** Brand accents for wordmark/logo treatment only — not a full palette swap. */
export const BRAND_COLORS = {
  navy: "#0A2540",
  teal: "#0D9AA8",
} as const;

export function appDisplayName(env?: string | null): string {
  if (env === "staging") return `${APP_NAME} (Staging)`;
  if (env === "development" || env === "dev") return `${APP_NAME} (Dev)`;
  return APP_NAME;
}
