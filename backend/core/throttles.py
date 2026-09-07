"""Rate limits for auth endpoints that are abuse-prone."""
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class AuthEmailAnonThrottle(AnonRateThrottle):
    """Forgot-password / public auth email: 5 requests per hour per IP."""

    scope = "auth_email_anon"


class AuthEmailUserThrottle(UserRateThrottle):
    """Authenticated resend-verification: 6 requests per hour per user."""

    scope = "auth_email_user"


class AuthLoginAnonThrottle(AnonRateThrottle):
    """Login: 10 requests per minute per IP."""

    scope = "auth_login_anon"


class AuthRegisterAnonThrottle(AnonRateThrottle):
    """Registration: 10 requests per hour per IP."""

    scope = "auth_register_anon"


class AuthSensitiveUserThrottle(UserRateThrottle):
    """Password change / account deletion: 10 requests per hour per user."""

    scope = "auth_sensitive_user"


class FeedbackUserThrottle(UserRateThrottle):
    """Authenticated product feedback: 5 submissions per hour per user."""

    scope = "feedback_user"
