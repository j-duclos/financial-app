"""Rate limits for outbound auth email endpoints."""
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class AuthEmailAnonThrottle(AnonRateThrottle):
    """Forgot-password / public auth email: 5 requests per hour per IP."""

    scope = "auth_email_anon"


class AuthEmailUserThrottle(UserRateThrottle):
    """Authenticated resend-verification: 6 requests per hour per user."""

    scope = "auth_email_user"
