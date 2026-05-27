from django.urls import path

from recommendations.views import RecommendationsListView, ScenarioRecommendationsView

urlpatterns = [
    path("", RecommendationsListView.as_view(), name="recommendations-list"),
    path(
        "scenario/<int:scenario_id>/",
        ScenarioRecommendationsView.as_view(),
        name="recommendations-scenario",
    ),
]
