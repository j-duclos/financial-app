from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    RecurringRuleViewSet,
    ScenarioViewSet,
    ScenarioRuleOverrideViewSet,
    ScenarioOneTimeEventViewSet,
    ScenarioAddedRecurringViewSet,
    ScenarioCategoryShockViewSet,
    UpcomingChargeNotificationViewSet,
    MaterializeRecurringView,
    ResolveRuleOccurrenceView,
    TimelineView,
    TimelineCalendarView,
    TransferSimulationView,
    ResolveRiskView,
    ReconcileImportCsvView,
    ReconcileSuggestionsView,
    ReconcileMatchView,
    ReconcileUnmatchedView,
)
from transactions.reconcile_views import (
    ReconcileSetupView,
    ReconcileCompleteView,
    ReconcileSessionListView,
    ReconcileSessionDetailView,
    ReconcileSessionUndoView,
)

router = DefaultRouter()
router.register("rules", RecurringRuleViewSet, basename="rule")
router.register("scenarios", ScenarioViewSet, basename="scenario")
router.register("scenario-overrides", ScenarioRuleOverrideViewSet, basename="scenario-override")
router.register("scenario-one-time-events", ScenarioOneTimeEventViewSet, basename="scenario-one-time-event")
router.register("scenario-added-recurring", ScenarioAddedRecurringViewSet, basename="scenario-added-recurring")
router.register("scenario-category-shocks", ScenarioCategoryShockViewSet, basename="scenario-category-shock")
router.register("notifications", UpcomingChargeNotificationViewSet, basename="notification")

urlpatterns = [
    path("", include(router.urls)),
    path("timeline/materialize/", MaterializeRecurringView.as_view(), name="timeline-materialize"),
    path("timeline/resolve-occurrence/", ResolveRuleOccurrenceView.as_view(), name="timeline-resolve-occurrence"),
    path("timeline/", TimelineView.as_view(), name="timeline"),
    path("timeline/calendar/", TimelineCalendarView.as_view(), name="timeline-calendar"),
    path("timeline/simulate-transfer/", TransferSimulationView.as_view(), name="timeline-simulate-transfer"),
    path("timeline/resolve-risk/", ResolveRiskView.as_view(), name="timeline-resolve-risk"),
    path("reconcile/import_csv/", ReconcileImportCsvView.as_view(), name="reconcile-import-csv"),
    path("reconcile/suggestions/", ReconcileSuggestionsView.as_view(), name="reconcile-suggestions"),
    path("reconcile/match/", ReconcileMatchView.as_view(), name="reconcile-match"),
    path("reconcile/unmatched/", ReconcileUnmatchedView.as_view(), name="reconcile-unmatched"),
    path("reconcile/setup/", ReconcileSetupView.as_view(), name="reconcile-setup"),
    path("reconcile/complete/", ReconcileCompleteView.as_view(), name="reconcile-complete"),
    path("reconcile/sessions/", ReconcileSessionListView.as_view(), name="reconcile-sessions"),
    path("reconcile/sessions/<int:session_id>/", ReconcileSessionDetailView.as_view(), name="reconcile-session-detail"),
    path("reconcile/sessions/<int:session_id>/undo/", ReconcileSessionUndoView.as_view(), name="reconcile-session-undo"),
]
