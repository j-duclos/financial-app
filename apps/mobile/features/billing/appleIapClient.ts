import type { AppleIapClient, AppleIapStatus } from "@budget-app/shared";
import {
  APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID,
  APPLE_IAP_VERIFY_PATH,
} from "@budget-app/shared";

export { APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID, APPLE_IAP_VERIFY_PATH };

export class AppleIapNotImplementedError extends Error {
  constructor() {
    super("Apple In-App Purchase is not implemented in this version.");
    this.name = "AppleIapNotImplementedError";
  }
}

const UNAVAILABLE: AppleIapStatus = {
  productId: null,
  originalTransactionId: null,
  expiresAt: null,
  environment: null,
  isActive: false,
};

/** Stub only. Never treat this as an entitlement source. */
export const appleIapClient: AppleIapClient = {
  async purchasePremium() {
    throw new AppleIapNotImplementedError();
  },
  async restorePurchases() {
    throw new AppleIapNotImplementedError();
  },
  async getPurchaseStatus() {
    return UNAVAILABLE;
  },
};
