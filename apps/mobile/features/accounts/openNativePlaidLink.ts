import { requireOptionalNativeModule } from "expo";

export type NativePlaidSuccess = {
  publicToken?: string;
  public_token?: string;
};

export class PlaidLinkUnavailableError extends Error {
  constructor() {
    super(
      "Plaid is not in this iOS build. Stop Expo Go / the current Debug app, then from apps/mobile run: npx expo run:ios --device"
    );
    this.name = "PlaidLinkUnavailableError";
  }
}

function successPublicToken(success: NativePlaidSuccess): string {
  return (success.publicToken || success.public_token || "").trim();
}

function hasPlaidNativeModule(): boolean {
  try {
    return requireOptionalNativeModule("ReactNativePlaidLinkSdk") != null;
  } catch {
    return false;
  }
}

/**
 * Opens native Plaid Link and returns the public token, or null if the user exited.
 * Never import the SDK until the native module is present — loading it otherwise
 * fatally errors with "Cannot find native module 'ReactNativePlaidLinkSdk'".
 */
export async function openNativePlaidLink(linkToken: string): Promise<string | null> {
  if (!hasPlaidNativeModule()) {
    throw new PlaidLinkUnavailableError();
  }

  let createPlaidLinkSession: typeof import("react-native-plaid-link-sdk").createPlaidLinkSession;
  try {
    ({ createPlaidLinkSession } = await import("react-native-plaid-link-sdk"));
  } catch {
    throw new PlaidLinkUnavailableError();
  }
  if (typeof createPlaidLinkSession !== "function") {
    throw new PlaidLinkUnavailableError();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    void (async () => {
      try {
        const session = await createPlaidLinkSession({
          token: linkToken,
          onSuccess: (success) => {
            const publicToken = successPublicToken(success);
            if (!publicToken) {
              fail(new Error("Plaid did not return a connection token."));
              return;
            }
            finish(publicToken);
          },
          onExit: (exit) => {
            const code = String(exit?.error?.errorCode ?? "").trim();
            const display =
              exit?.error?.displayMessage ||
              exit?.error?.errorMessage ||
              code;
            if (exit?.error && display) {
              fail(new Error(String(display)));
              return;
            }
            finish(null);
          },
          // v13 invokes this on every native event without optional chaining.
          onEvent: () => undefined,
        });
        await session.open();
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
}
