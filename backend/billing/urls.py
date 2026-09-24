from django.urls import path

from billing.staff_views import (
    StaffBetaTesterInvitationListCreateView,
    StaffBetaTesterInvitationResendView,
    StaffBetaTesterInvitationRevokeView,
    StaffComplimentaryPremiumView,
)
from billing.views import (
    BillingStatusView,
    ComplimentaryInvitationAcceptView,
    ComplimentaryInvitationPreviewView,
    CreateCheckoutSessionView,
    CreatePortalSessionView,
    StripeWebhookView,
)

urlpatterns = [
    path("status/", BillingStatusView.as_view(), name="billing-status"),
    path(
        "invitations/preview/",
        ComplimentaryInvitationPreviewView.as_view(),
        name="billing-invitation-preview",
    ),
    path(
        "invitations/accept/",
        ComplimentaryInvitationAcceptView.as_view(),
        name="billing-invitation-accept",
    ),
    path(
        "staff/beta-testers/",
        StaffBetaTesterInvitationListCreateView.as_view(),
        name="billing-staff-beta-testers",
    ),
    path(
        "staff/beta-testers/invitations/",
        StaffBetaTesterInvitationListCreateView.as_view(),
        name="billing-staff-beta-tester-invitations",
    ),
    path(
        "staff/beta-testers/invitations/<int:invitation_id>/resend/",
        StaffBetaTesterInvitationResendView.as_view(),
        name="billing-staff-beta-tester-resend",
    ),
    path(
        "staff/beta-testers/invitations/<int:invitation_id>/revoke/",
        StaffBetaTesterInvitationRevokeView.as_view(),
        name="billing-staff-beta-tester-revoke",
    ),
    path(
        "staff/beta-testers/users/<int:user_id>/complimentary-premium/",
        StaffComplimentaryPremiumView.as_view(),
        name="billing-staff-complimentary-premium",
    ),
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
