from django.urls import include, path
from rest_framework.routers import DefaultRouter

from goals.views import (
    FinancialGoalViewSet,
    GoalBucketViewSet,
    GoalContributionViewSet,
    RuleAllocationViewSet,
)

router = DefaultRouter()
router.register("buckets", GoalBucketViewSet, basename="goal-bucket")
router.register("goals", FinancialGoalViewSet, basename="financial-goal")
router.register("goal-contributions", GoalContributionViewSet, basename="goal-contribution")
router.register("rule-allocations", RuleAllocationViewSet, basename="rule-allocation")

urlpatterns = [
    path("", include(router.urls)),
]
