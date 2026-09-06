"""DRF exception handler that preserves entitlement error JSON."""
from rest_framework.views import exception_handler as drf_exception_handler

from billing.entitlements import EntitlementDenied, entitlement_error_response


def billing_exception_handler(exc, context):
    if isinstance(exc, EntitlementDenied):
        return entitlement_error_response(exc)
    return drf_exception_handler(exc, context)
