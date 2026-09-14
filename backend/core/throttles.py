"""Rate limits for auth endpoints that are abuse-prone."""
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
import logging

logger = logging.getLogger(__name__)


class AuthEmailAnonThrottle(AnonRateThrottle):
    """Forgot-password / public auth email: 5 requests per hour per IP."""

    scope = "auth_email_anon"

    def allow_request(self, request, view):
        allowed = super().allow_request(request, view)
        if not allowed:
            logger.warning("auth_email throttled scope=%s", self.scope)
        return allowed


class AuthEmailUserThrottle(UserRateThrottle):
    """Authenticated resend-verification."""

    scope = "auth_email_user"

    def allow_request(self, request, view):
        allowed = super().allow_request(request, view)
        if not allowed:
            logger.warning(
                "auth_email throttled scope=%s user_id=%s",
                self.scope,
                getattr(getattr(request, "user", None), "pk", None),
            )
        return allowed


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
