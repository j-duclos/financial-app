from django.db.models import Prefetch
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.permissions import IsHouseholdMember
from core.utils import get_households_for_user
from goals.contribute import execute_contribution, preview_contribution
from goals.models import FinancialGoal, GoalBucket, GoalContribution, RuleAllocation
from goals.serializers import (
    ContributePreviewSerializer,
    ContributeSerializer,
    FinancialGoalSerializer,
)
from goals.services import (
    calculate_aggregate_goal_summary,
    calculate_goal_progress,
    enrich_goal_progress,
)


class FinancialGoalViewSet(ModelViewSet):
    """Financial goals API at /api/goals/."""

    serializer_class = FinancialGoalSerializer
    permission_classes = [IsHouseholdMember]
    filterset_fields = ["household", "status", "goal_type"]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return (
            FinancialGoal.objects.filter(household__in=households)
            .select_related("household", "linked_account", "linked_credit_account", "contribution_rule")
            .order_by("priority", "-created_at")
        )

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        qs = self.get_queryset().filter(
            status__in=(FinancialGoal.Status.ACTIVE, FinancialGoal.Status.PAUSED)
        )
        household = request.query_params.get("household")
        if household:
            qs = qs.filter(household_id=household)
        return Response(calculate_aggregate_goal_summary(list(qs)))

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        goal = self.get_object()
        goal.status = FinancialGoal.Status.ARCHIVED
        goal.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(goal).data)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        goal = self.get_object()
        goal.status = FinancialGoal.Status.COMPLETED
        goal.completed_at = timezone.now()
        goal.save(update_fields=["status", "completed_at", "updated_at"])
        return Response(self.get_serializer(goal).data)

    @action(detail=True, methods=["post"], url_path="pause")
    def pause(self, request, pk=None):
        goal = self.get_object()
        goal.status = FinancialGoal.Status.PAUSED
        goal.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(goal).data)

    @action(detail=True, methods=["post"], url_path="duplicate")
    def duplicate(self, request, pk=None):
        goal = self.get_object()
        copy = FinancialGoal.objects.create(
            household=goal.household,
            created_by=request.user if request.user.is_authenticated else None,
            name=f"{goal.name} (copy)",
            goal_type=goal.goal_type,
            target_amount=goal.target_amount,
            current_amount=0,
            starting_debt_amount=goal.starting_debt_amount,
            target_date=goal.target_date,
            linked_account=goal.linked_account,
            linked_credit_account=goal.linked_credit_account,
            monthly_contribution=goal.monthly_contribution,
            contribution_rule=None,
            priority=goal.priority,
            status=FinancialGoal.Status.ACTIVE,
            notes=goal.notes,
        )
        return Response(self.get_serializer(copy).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="contribute/preview")
    def contribute_preview(self, request, pk=None):
        goal = self.get_object()
        ser = ContributePreviewSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            preview = preview_contribution(
                request.user,
                goal,
                from_account_id=ser.validated_data["from_account"].id,
                amount=ser.validated_data["amount"],
                contrib_date=ser.validated_data["date"],
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(preview)

    @action(detail=True, methods=["post"], url_path="contribute")
    def contribute(self, request, pk=None):
        goal = self.get_object()
        ser = ContributeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        from_account = ser.validated_data.get("from_account")
        try:
            result = execute_contribution(
                request.user,
                goal,
                from_account_id=from_account.id if from_account else None,
                amount=ser.validated_data["amount"],
                contrib_date=ser.validated_data["date"],
                method=ser.validated_data["method"],
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        goal.refresh_from_db()
        return Response(
            {
                "goal_progress": result["goal_progress"],
                "goal": self.get_serializer(goal).data,
            }
        )

    @action(detail=True, methods=["get"], url_path="forecast")
    def forecast(self, request, pk=None):
        goal = self.get_object()
        progress = enrich_goal_progress(goal, calculate_goal_progress(goal))
        gap = progress.get("forecast_gap")
        recommendation = None
        if gap and float(gap) > 0:
            recommendation = f"Increase funding by ${gap}/mo to reach your target date."
        elif progress.get("on_track_status") == "behind":
            rec = progress.get("recommended_monthly_contribution")
            if rec:
                recommendation = f"Schedule ${rec}/mo to get back on track."
        return Response(
            {
                "projected_completion_date": progress.get("projected_completion_date"),
                "monthly_required": progress.get("monthly_required"),
                "current_contribution_rate": progress.get("current_contribution_rate"),
                "forecast_gap": gap,
                "on_track_status": progress.get("on_track_status"),
                "goal_health": progress.get("goal_health"),
                "recommendation": recommendation,
            }
        )


# Legacy bucket API (allocations / safe-to-spend reserves)
from goals.bucket_contribute import execute_bucket_contribution, preview_bucket_contribution
from goals.bucket_serializers import (
    AssignContributionSerializer,
    BucketFundingConfigSerializer,
    ContributePreviewSerializer as BucketContributePreviewSerializer,
    ContributeSerializer as BucketContributeSerializer,
    GoalBucketSerializer,
    GoalContributionSerializer,
    RuleAllocationSerializer,
)
from goals.bucket_services import (
    account_bucket_summary,
    build_goal_calculation_context,
    calculate_aggregate_bucket_summary,
    calculate_aggregate_bucket_summary_from_results,
    calculate_bucket_progress,
    calculate_goal_bucket_results,
    enrich_bucket,
    record_contribution,
)


class GoalBucketViewSet(ModelViewSet):
    """Goal buckets API at /api/buckets/."""

    serializer_class = GoalBucketSerializer
    permission_classes = [IsHouseholdMember]
    filterset_fields = ["household", "status", "type"]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return (
            GoalBucket.objects.filter(household__in=households)
            .select_related("household", "linked_account")
            .prefetch_related(
                Prefetch(
                    "rule_allocations",
                    queryset=RuleAllocation.objects.filter(active=True).select_related("rule"),
                )
            )
            .order_by("priority", "-created_at")
        )

    def list(self, request, *args, **kwargs):
        from datetime import date as date_cls

        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        buckets = list(page) if page is not None else list(queryset)
        today = date_cls.today()
        calc_ctx = build_goal_calculation_context(
            buckets, today=today, as_of=today, user=request.user
        )
        serializer = self.get_serializer(
            buckets,
            many=True,
            context={
                **self.get_serializer_context(),
                "goal_calculation_context": calc_ctx,
            },
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="overview")
    def overview(self, request):
        from datetime import date as date_cls

        qs = self.filter_queryset(self.get_queryset())
        household = request.query_params.get("household")
        if household:
            qs = qs.filter(household_id=household)
        buckets = list(qs)
        today = date_cls.today()
        results = calculate_goal_bucket_results(buckets, user=request.user, today=today)
        summary = calculate_aggregate_bucket_summary_from_results(results)
        return Response({"summary": summary, "goals": results})

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        qs = self.get_queryset().filter(
            status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED)
        )
        household = request.query_params.get("household")
        if household:
            qs = qs.filter(household_id=household)
        return Response(calculate_aggregate_bucket_summary(list(qs), user=request.user))

    @action(detail=False, methods=["get"], url_path="reports")
    def reports(self, request):
        from core.utils import get_households_for_user
        from goals.bucket_services import build_goals_report

        households = get_households_for_user(request.user)
        months = int(request.query_params.get("months", "12"))
        months = max(1, min(months, 36))
        month = request.query_params.get("month")
        include_history = request.query_params.get("include_history", "").lower() in (
            "1",
            "true",
            "yes",
        )
        return Response(
            build_goals_report(
                households,
                months=months,
                month=month,
                user=request.user,
                include_history=include_history,
            )
        )

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        bucket = self.get_object()
        bucket.status = GoalBucket.Status.ARCHIVED
        bucket.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(bucket).data)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        bucket = self.get_object()
        bucket.status = GoalBucket.Status.COMPLETED
        bucket.completed_at = timezone.now()
        bucket.save(update_fields=["status", "completed_at", "updated_at"])
        return Response(self.get_serializer(bucket).data)

    @action(detail=True, methods=["post"], url_path="pause")
    def pause(self, request, pk=None):
        bucket = self.get_object()
        bucket.status = GoalBucket.Status.PAUSED
        bucket.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(bucket).data)

    @action(detail=True, methods=["post"], url_path="duplicate")
    def duplicate(self, request, pk=None):
        bucket = self.get_object()
        copy = GoalBucket.objects.create(
            household=bucket.household,
            created_by=request.user if request.user.is_authenticated else None,
            name=f"{bucket.name} (copy)",
            description=bucket.description,
            type=bucket.type,
            target_amount=bucket.target_amount,
            allocated_amount=0,
            start_date=bucket.start_date,
            target_date=bucket.target_date,
            linked_account=bucket.linked_account,
            monthly_target=bucket.monthly_target,
            auto_fund_enabled=bucket.auto_fund_enabled,
            forecast_enabled=bucket.forecast_enabled,
            include_in_safe_to_spend=bucket.include_in_safe_to_spend,
            priority=bucket.priority,
            status=GoalBucket.Status.ACTIVE,
            notes=bucket.notes,
        )
        return Response(self.get_serializer(copy).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="contribute/preview")
    def contribute_preview(self, request, pk=None):
        bucket = self.get_object()
        ser = BucketContributePreviewSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            preview = preview_bucket_contribution(
                request.user,
                bucket,
                from_account_id=ser.validated_data["from_account"].id,
                amount=ser.validated_data["amount"],
                contrib_date=ser.validated_data["date"],
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(preview)

    @action(detail=True, methods=["post"], url_path="contribute")
    def contribute(self, request, pk=None):
        bucket = self.get_object()
        ser = BucketContributeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        from_account = ser.validated_data.get("from_account")
        try:
            result = execute_bucket_contribution(
                request.user,
                bucket,
                from_account_id=from_account.id if from_account else None,
                amount=ser.validated_data["amount"],
                contrib_date=ser.validated_data["date"],
                method=ser.validated_data["method"],
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        bucket.refresh_from_db()
        return Response(
            {
                "goal_progress": result["goal_progress"],
                "goal": self.get_serializer(bucket).data,
            }
        )

    @action(detail=True, methods=["get"], url_path="forecast")
    def forecast(self, request, pk=None):
        from datetime import date as date_cls

        bucket = self.get_object()
        today = date_cls.today()
        ctx = build_goal_calculation_context(
            [bucket], today=today, as_of=today, user=request.user
        )
        progress = enrich_bucket(
            bucket,
            calculate_bucket_progress(bucket, today=today, user=request.user, context=ctx),
            today=today,
            context=ctx,
        )
        recommendation = progress.get("contribution_recommendation")
        if not recommendation:
            gap = progress.get("forecast_gap")
            if gap and float(gap) > 0:
                recommendation = f"Increase funding by ${gap}/mo to reach your target date."
            elif progress.get("on_track_status") == "behind":
                rec = progress.get("recommended_monthly_contribution")
                if rec:
                    recommendation = f"Schedule ${rec}/mo to get back on track."
        return Response(
            {
                "projected_completion_date": progress.get("projected_completion_date"),
                "monthly_required": progress.get("monthly_required"),
                "current_contribution_rate": progress.get("current_contribution_rate"),
                "forecast_gap": progress.get("forecast_gap"),
                "forecast_surplus": progress.get("forecast_surplus"),
                "on_track_status": progress.get("on_track_status"),
                "goal_health": progress.get("goal_health"),
                "forecast_status": progress.get("forecast_status"),
                "pace_status": progress.get("pace_status"),
                "projection_headline": progress.get("projection_headline"),
                "suggested_monthly": progress.get("suggested_monthly"),
                "suggested_biweekly": progress.get("suggested_biweekly"),
                "suggested_weekly": progress.get("suggested_weekly"),
                "suggested_per_paycheck": progress.get("suggested_per_paycheck"),
                "paycheck_frequency": progress.get("paycheck_frequency"),
                "paycheck_frequency_label": progress.get("paycheck_frequency_label"),
                "automatic_transfer_label": progress.get("automatic_transfer_label"),
                "pace_warnings": progress.get("pace_warnings", []),
                "recommendation": recommendation,
            }
        )

    @action(detail=True, methods=["get"], url_path="detail")
    def goal_detail(self, request, pk=None):
        from goals.forecast_insights import build_goal_detail

        bucket = self.get_object()
        scenario_id = request.query_params.get("scenario")
        sid = int(scenario_id) if scenario_id and scenario_id.isdigit() else None
        return Response(build_goal_detail(bucket, user=request.user, scenario_id=sid))

    @action(detail=True, methods=["put", "patch"], url_path="funding")
    def configure_funding(self, request, pk=None):
        """Link a paycheck rule to this bucket and optionally enable auto-transfer."""
        from goals.auto_fund import apply_bucket_funding_config

        bucket = self.get_object()
        if bucket.is_debt_bucket():
            return Response(
                {"detail": "Debt payoff buckets cannot use paycheck auto-funding."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ser = BucketFundingConfigSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        try:
            apply_bucket_funding_config(
                bucket,
                auto_fund_enabled=data.get("auto_fund_enabled"),
                income_rule_id=data.get("income_rule_id"),
                fixed_amount=data.get("fixed_amount"),
                percent=data.get("percent"),
                clear_allocation=data.get("clear_allocation", False),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        bucket.refresh_from_db()
        from goals.auto_fund import find_auto_fund_transfer_rule

        transfer_rule = find_auto_fund_transfer_rule(bucket)
        payload = self.get_serializer(bucket).data
        payload["auto_fund_transfer_rule_id"] = transfer_rule.pk if transfer_rule else None
        return Response(payload)


class GoalContributionViewSet(ModelViewSet):
    serializer_class = GoalContributionSerializer
    permission_classes = [IsHouseholdMember]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return GoalContribution.objects.filter(bucket__household__in=households).select_related(
            "bucket", "transaction", "account"
        )

    def create(self, request, *args, **kwargs):
        ser = AssignContributionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        bucket = ser.validated_data["bucket"]
        txn = ser.validated_data["transaction"]
        households = get_households_for_user(request.user)
        if bucket.household not in households:
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        contrib = record_contribution(
            bucket,
            transaction=txn,
            account_id=txn.account_id,
            amount=ser.validated_data["amount"],
            contrib_date=txn.date,
            source=GoalContribution.Source.MANUAL,
        )
        return Response(GoalContributionSerializer(contrib).data, status=status.HTTP_201_CREATED)


class RuleAllocationViewSet(ModelViewSet):
    serializer_class = RuleAllocationSerializer
    permission_classes = [IsHouseholdMember]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        qs = RuleAllocation.objects.filter(bucket__household__in=households).select_related(
            "rule", "bucket"
        )
        bucket = self.request.query_params.get("bucket")
        if bucket:
            qs = qs.filter(bucket_id=int(bucket))
        rule = self.request.query_params.get("rule")
        if rule:
            qs = qs.filter(rule_id=int(rule))
        return qs

    def perform_create(self, serializer):
        allocation = serializer.save()
        from goals.auto_fund import sync_auto_fund_transfer_rule

        sync_auto_fund_transfer_rule(allocation.bucket)

    def perform_update(self, serializer):
        allocation = serializer.save()
        from goals.auto_fund import sync_auto_fund_transfer_rule

        sync_auto_fund_transfer_rule(allocation.bucket)

    def perform_destroy(self, instance):
        bucket = instance.bucket
        super().perform_destroy(instance)
        from goals.auto_fund import sync_auto_fund_transfer_rule

        sync_auto_fund_transfer_rule(bucket)
