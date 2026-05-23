from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    RecurringRuleViewSet,
    ScenarioViewSet,
    ScenarioRuleOverrideViewSet,
    UpcomingChargeNotificationViewSet,
    TimelineView,
    ReconcileImportCsvView,
    ReconcileSuggestionsView,
    ReconcileMatchView,
    ReconcileUnmatchedView,
)
from transactions.reconcile_views import ReconcileSetupView, ReconcileCompleteView

router = DefaultRouter()
router.register("rules", RecurringRuleViewSet, basename="rule")
router.register("scenarios", ScenarioViewSet, basename="scenario")
router.register("scenario-overrides", ScenarioRuleOverrideViewSet, basename="scenario-override")
router.register("notifications", UpcomingChargeNotificationViewSet, basename="notification")

urlpatterns = [
    path("", include(router.urls)),
    path("timeline/", TimelineView.as_view(), name="timeline"),
    path("reconcile/import_csv/", ReconcileImportCsvView.as_view(), name="reconcile-import-csv"),
    path("reconcile/suggestions/", ReconcileSuggestionsView.as_view(), name="reconcile-suggestions"),
    path("reconcile/match/", ReconcileMatchView.as_view(), name="reconcile-match"),
    path("reconcile/unmatched/", ReconcileUnmatchedView.as_view(), name="reconcile-unmatched"),
    path("reconcile/setup/", ReconcileSetupView.as_view(), name="reconcile-setup"),
    path("reconcile/complete/", ReconcileCompleteView.as_view(), name="reconcile-complete"),
]
