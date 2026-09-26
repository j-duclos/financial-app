export type NativePlaidSuccess = {
  publicToken?: string;
  public_token?: string;
};

export class PlaidLinkUnavailableError extends Error {
  constructor() {
    super(
      "Bank linking needs a native FlowSight build. Rebuild the iOS app after this update (Expo Go cannot open Plaid)."
    );
    this.name = "PlaidLinkUnavailableError";
  }
}

function successPublicToken(success: NativePlaidSuccess): string {
  return (success.publicToken || success.public_token || "").trim();
}

/**
 * Opens native Plaid Link and returns the public token, or null if the user exited.
 * Dynamically imports the native SDK so unit tests do not load it.
 */
export async function openNativePlaidLink(linkToken: string): Promise<string | null> {
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
    void (async () => {
      try {
        const session = await createPlaidLinkSession({
          token: linkToken,
          onSuccess: (success) => {
            const publicToken = successPublicToken(success);
            if (!publicToken) {
              reject(new Error("Plaid did not return a connection token."));
              return;
            }
            resolve(publicToken);
          },
          onExit: (exit) => {
            const display =
              exit?.error?.displayMessage ||
              exit?.error?.errorMessage ||
              exit?.error?.errorCode ||
              "";
            if (exit?.error && display) {
              reject(new Error(String(display)));
              return;
            }
            resolve(null);
          },
        });
        await session.open();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
}
