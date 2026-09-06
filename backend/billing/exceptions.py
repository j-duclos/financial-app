class BillingConfigurationError(Exception):
    """Raised when a billing operation is attempted without required Stripe configuration."""
