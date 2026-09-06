from django.urls import path

from billing.views import (
    BillingStatusView,
    CreateCheckoutSessionView,
    CreatePortalSessionView,
    StripeWebhookView,
)

urlpatterns = [
    path("status/", BillingStatusView.as_view(), name="billing-status"),
    path(
        "create-checkout-session/",
        CreateCheckoutSessionView.as_view(),
        name="billing-create-checkout-session",
    ),
    path(
        "create-portal-session/",
        CreatePortalSessionView.as_view(),
        name="billing-create-portal-session",
    ),
    path("webhook/", StripeWebhookView.as_view(), name="billing-webhook"),
]
