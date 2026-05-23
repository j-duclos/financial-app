from django.conf import settings
from django.db import models


class Household(models.Model):
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "core_household"
        ordering = ["name"]


class HouseholdMembership(models.Model):
    class Role(models.TextChoices):
        OWNER = "OWNER", "Owner"
        MEMBER = "MEMBER", "Member"

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="household_memberships")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_household_membership"
        constraints = [
            models.UniqueConstraint(fields=["household", "user"], name="uniq_household_user"),
        ]
        indexes = [
            models.Index(fields=["user"]),
            models.Index(fields=["household"]),
        ]


class UserProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    display_name = models.CharField(max_length=255, blank=True)
    phone_e164 = models.CharField(
        max_length=20,
        blank=True,
        default="",
        help_text="Mobile E.164 for Plaid Link (e.g. +15204615387).",
    )
    default_household = models.ForeignKey(
        Household, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    default_account = models.ForeignKey(
        "accounts.Account", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "core_user_profile"
