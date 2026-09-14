"""Future Apple In-App Purchase verification.

Not implemented. Do not grant Premium from a client-supplied receipt,
transaction id, or on-device purchase flag.

When this is implemented:

- Verify signed transactions with Apple on the server
- Store Apple original_transaction_id separately from Stripe customer/subscription ids
- Grant Premium only after Apple verification succeeds
- Keep ``user_has_premium`` as the single entitlement predicate
"""

APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID = "com.jduclos.flowsight.premium.monthly"
APPLE_IAP_VERIFY_PATH = "/api/billing/apple/verify/"


def apple_iap_verification_enabled() -> bool:
    return False
