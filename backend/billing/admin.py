from datetime import timedelta

from django import forms
from django.contrib import admin, messages
from django.utils import timezone
from django.utils.html import format_html

from billing.invitations import InvitationError, resend_invitation, revoke_invitation
from billing.models import BillingSubscription, ComplimentaryPremiumInvitation, StripeWebhookEvent


@admin.register(BillingSubscription)
class BillingSubscriptionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "plan",
        "status",
        "cancel_at_period_end",
        "current_period_end",
        "stripe_customer_id",
        "stripe_subscription_id",
        "updated_at",
    )
    list_filter = ("plan", "status", "cancel_at_period_end")
    search_fields = (
        "user__username",
        "user__email",
        "stripe_customer_id",
        "stripe_subscription_id",
        "stripe_price_id",
    )
    readonly_fields = (
        "user",
        "stripe_customer_id",
        "stripe_subscription_id",
        "stripe_price_id",
        "created_at",
        "updated_at",
    )
    ordering = ("-updated_at",)


@admin.register(StripeWebhookEvent)
class StripeWebhookEventAdmin(admin.ModelAdmin):
    list_display = ("stripe_event_id", "event_type", "livemode", "processed_at")
    list_filter = ("event_type", "livemode")
    search_fields = ("stripe_event_id", "event_type")
    readonly_fields = ("stripe_event_id", "event_type", "livemode", "processed_at")
    ordering = ("-processed_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class InvitationStatusFilter(admin.SimpleListFilter):
    title = "status"
    parameter_name = "invite_status"

    def lookups(self, request, model_admin):
        return (
            ("pending", "Pending"),
            ("accepted", "Accepted"),
            ("expired", "Expired"),
            ("revoked", "Revoked"),
        )

    def queryset(self, request, queryset):
        now = timezone.now()
        value = self.value()
        if value == "accepted":
            return queryset.filter(accepted_at__isnull=False)
        if value == "revoked":
            return queryset.filter(accepted_at__isnull=True, revoked_at__isnull=False)
        if value == "expired":
            return queryset.filter(
                accepted_at__isnull=True,
                revoked_at__isnull=True,
                expires_at__lte=now,
            )
        if value == "pending":
            return queryset.filter(
                accepted_at__isnull=True,
                revoked_at__isnull=True,
                expires_at__gt=now,
            )
        return queryset


class ComplimentaryPremiumInvitationForm(forms.ModelForm):
    complimentary_premium_until = forms.DateTimeField(
        help_text="When complimentary Premium access should end.",
        widget=forms.DateTimeInput(attrs={"type": "datetime-local"}, format="%Y-%m-%dT%H:%M"),
        input_formats=["%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"],
    )
    expires_at = forms.DateTimeField(
        required=False,
        help_text="Leave blank for 7 days from now.",
        widget=forms.DateTimeInput(attrs={"type": "datetime-local"}, format="%Y-%m-%dT%H:%M"),
        input_formats=["%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"],
    )

    class Meta:
        model = ComplimentaryPremiumInvitation
        fields = ("email", "complimentary_premium_until", "expires_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not self.instance.pk:
            now = timezone.now()
            self.fields["complimentary_premium_until"].initial = now + timedelta(days=90)
            self.fields["expires_at"].initial = now + timedelta(days=7)

    def clean_email(self):
        from core.email_identity import normalize_email

        email = normalize_email(self.cleaned_data.get("email"))
        if not email:
            raise forms.ValidationError("Enter a valid email address.")
        return email

    def clean_complimentary_premium_until(self):
        until = self.cleaned_data.get("complimentary_premium_until")
        if until and until <= timezone.now():
            raise forms.ValidationError("Complimentary Premium expiration must be in the future.")
        return until


@admin.register(ComplimentaryPremiumInvitation)
class ComplimentaryPremiumInvitationAdmin(admin.ModelAdmin):
    form = ComplimentaryPremiumInvitationForm
    list_display = (
        "email",
        "status_display",
        "premium_until_display",
        "invitation_expires_display",
        "created_display",
        "accepted_by",
        "accepted_at_display",
    )
    list_filter = (InvitationStatusFilter,)
    search_fields = ("email", "accepted_by__username", "accepted_by__email")
    readonly_fields = (
        "token_hash",
        "created_at",
        "accepted_at",
        "accepted_by",
        "created_by",
        "revoked_at",
        "sent_at",
    )
    ordering = ("-created_at",)
    actions = ("revoke_unused_invitations", "resend_unused_invitations")

    def get_readonly_fields(self, request, obj=None):
        if obj and obj.accepted_at:
            return self.readonly_fields + ("email", "complimentary_premium_until", "expires_at")
        return self.readonly_fields

    @admin.display(description="Status")
    def status_display(self, obj):
        label = obj.status_label()
        colors = {
            "pending": "#047857",
            "accepted": "#1d4ed8",
            "expired": "#b45309",
            "revoked": "#b91c1c",
        }
        return format_html(
            '<span style="color: {}; font-weight: 600;">{}</span>',
            colors.get(label, "#334155"),
            label.title(),
        )

    @admin.display(description="Premium until", ordering="complimentary_premium_until")
    def premium_until_display(self, obj):
        return obj.complimentary_premium_until

    @admin.display(description="Invitation expires", ordering="expires_at")
    def invitation_expires_display(self, obj):
        return obj.expires_at

    @admin.display(description="Created", ordering="created_at")
    def created_display(self, obj):
        return obj.created_at

    @admin.display(description="Accepted at", ordering="accepted_at")
    def accepted_at_display(self, obj):
        return obj.accepted_at

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        from billing.invitations import (
            default_invitation_expiry,
            generate_invitation_token,
            hash_invitation_token,
            send_invitation_email,
        )
        from core.email_identity import normalize_email

        if not change:
            raw = generate_invitation_token()
            obj.email = normalize_email(obj.email)
            obj.token_hash = hash_invitation_token(raw)
            obj.created_by = request.user
            if not obj.expires_at:
                obj.expires_at = default_invitation_expiry()
            super().save_model(request, obj, form, change)
            sent = send_invitation_email(obj, raw)
            if sent:
                self.message_user(
                    request,
                    f"Invitation sent to {obj.email}. The secure link is only in the email.",
                    level=messages.SUCCESS,
                )
            else:
                self.message_user(
                    request,
                    f"Invitation saved for {obj.email}, but the email could not be sent. Use Resend.",
                    level=messages.WARNING,
                )
            return
        super().save_model(request, obj, form, change)

    @admin.action(description="Revoke unused invitations")
    def revoke_unused_invitations(self, request, queryset):
        revoked = 0
        for invite in queryset:
            try:
                revoke_invitation(invite)
                revoked += 1
            except InvitationError:
                continue
        self.message_user(request, f"Revoked {revoked} invitation(s).")

    @admin.action(description="Resend unused invitations (new link)")
    def resend_unused_invitations(self, request, queryset):
        sent = 0
        for invite in queryset:
            try:
                resend_invitation(invite, created_by=request.user)
                sent += 1
            except InvitationError:
                continue
        self.message_user(
            request,
            f"Resent {sent} invitation(s) with new secure links. Previous links no longer work.",
        )
