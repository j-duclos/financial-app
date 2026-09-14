/**
 * Future Apple In-App Purchase types.
 *
 * Purchases are not implemented. Clients must not invent receipts or grant
 * Premium from device-only state. Server verification is required.
 */

/** Intended App Store product id. Create the product in App Store Connect before use. */
export const APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID = "com.jduclos.flowsight.premium.monthly";

/** Planned backend verification path. Not routed yet. */
export const APPLE_IAP_VERIFY_PATH = "/api/billing/apple/verify/";

export type AppleIapEnvironment = "sandbox" | "production";

export type AppleIapPurchaseRequest = {
  productId: string;
};

export type AppleIapRestoreRequest = {
  productId?: string;
};

export type AppleIapStatus = {
  productId: string | null;
  originalTransactionId: string | null;
  expiresAt: string | null;
  environment: AppleIapEnvironment | null;
  isActive: boolean;
};

export type AppleIapVerificationPayload = {
  signedTransaction: string;
  productId: string;
};

export type AppleIapClient = {
  purchasePremium: (request: AppleIapPurchaseRequest) => Promise<AppleIapStatus>;
  restorePurchases: (request?: AppleIapRestoreRequest) => Promise<AppleIapStatus>;
  getPurchaseStatus: () => Promise<AppleIapStatus>;
};
