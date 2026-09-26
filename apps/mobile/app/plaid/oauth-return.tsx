import { Redirect } from "expo-router";

/**
 * Safety net if an HTTPS OAuth return ever opens the app.
 * Plaid Link should keep the OAuth session in-app; this must not remount Home.
 */
export default function PlaidOAuthReturnScreen() {
  return <Redirect href="/(app)/(tabs)/accounts" />;
}
