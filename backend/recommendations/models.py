from django.conf import settings
from django.db import models


class RecommendationPreference(models.Model):
    """User presentation state for dynamically generated recommendations.

    Recommendations themselves are not stored — only snooze/dismiss choices.
    """

    class State(models.TextChoices):
        DISMISSED = "dismissed", "Dismissed"
        SNOOZED = "snoozed", "Snoozed"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="recommendation_preferences",
    )
    recommendation_id = models.CharField(max_length=255)
    state = models.CharField(max_length=16, choices=State.choices)
    snoozed_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "recommendations_preference"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "recommendation_id"],
                name="uniq_recommendation_pref_user_id",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "state"]),
            models.Index(fields=["user", "recommendation_id"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} {self.recommendation_id} {self.state}"
