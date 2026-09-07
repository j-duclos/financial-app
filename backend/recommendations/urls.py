from django.urls import path

from recommendations.views import (
    RecommendationPreferenceActionView,
    RecommendationPreferencesView,
    RecommendationsListView,
    ScenarioRecommendationsView,
)

urlpatterns = [
    path("", RecommendationsListView.as_view(), name="recommendations-list"),
    path(
        "preferences/",
        RecommendationPreferencesView.as_view(),
        name="recommendation-preferences",
    ),
    path(
        "scenario/<int:scenario_id>/",
        ScenarioRecommendationsView.as_view(),
        name="recommendations-scenario",
    ),
    path(
        "<str:recommendation_id>/snooze/",
        RecommendationPreferenceActionView.as_view(),
        {"action": "snooze"},
        name="recommendation-snooze",
    ),
    path(
        "<str:recommendation_id>/dismiss/",
        RecommendationPreferenceActionView.as_view(),
        {"action": "dismiss"},
        name="recommendation-dismiss",
    ),
    path(
        "<str:recommendation_id>/restore/",
        RecommendationPreferenceActionView.as_view(),
        {"action": "restore"},
        name="recommendation-restore",
    ),
    path(
        "<str:recommendation_id>/unsnooze/",
        RecommendationPreferenceActionView.as_view(),
        {"action": "unsnooze"},
        name="recommendation-unsnooze",
    ),
]
