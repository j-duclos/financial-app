import { requireOptionalNativeModule } from "expo";
import {
  logPlaidLinkDiagnostic,
  PlaidLinkExitError,
  shouldLogPlaidLinkEvent,
  summarizePlaidExit,
  summarizePlaidLinkEvent,
  type PlaidLinkExitFields,
} from "./plaidLinkDiagnostics";

export type NativePlaidSuccess = {
  publicToken?: string;
  public_token?: string;
};

export { PlaidLinkExitError };

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

function exitFields(exit: {
  error?: {
    errorCode?: string;
    errorType?: string;
    displayMessage?: string;
    errorMessage?: string;
  };
  metadata?: {
    requestId?: string;
    status?: string;
    institution?: { id?: string; name?: string };
  };
}): PlaidLinkExitFields {
  return {
    errorCode: exit.error?.errorCode,
    errorType: exit.error?.errorType,
    displayMessage: exit.error?.displayMessage,
    errorMessage: exit.error?.errorMessage,
    institutionId: exit.metadata?.institution?.id,
    institutionName: exit.metadata?.institution?.name,
    requestId: exit.metadata?.requestId,
    status: exit.metadata?.status,
  };
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
            const fields = exitFields(exit);
            if (exit?.error) {
              logPlaidLinkDiagnostic("exit", summarizePlaidExit(fields));
              fail(new PlaidLinkExitError(fields));
              return;
            }
            finish(null);
          },
          onEvent: (event) => {
            const name = String(event?.eventName ?? "");
            if (!shouldLogPlaidLinkEvent(name)) return;
            logPlaidLinkDiagnostic(
              "event",
              summarizePlaidLinkEvent({
                eventName: name,
                metadata: event?.metadata as Record<string, unknown> | undefined,
              })
            );
          },
        });
        await session.open(true);
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
}
