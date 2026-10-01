"""Authenticated plan simulation API.

Local DEBUG (ALLOW_PLAN_TEST_OVERRIDE) or staff/superuser accounts.
"""
from __future__ import annotations

from django.http import Http404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.plan_override import (
    PLAN_FREE,
    PLAN_PREMIUM,
    set_own_test_plan_override,
    user_may_use_plan_test_override,
)
from billing.services import get_user_plan

try:
    from drf_spectacular.utils import extend_schema
except ImportError:  # pragma: no cover
    def extend_schema(**_kwargs):
        def decorator(cls):
            return cls

        return decorator


@extend_schema(exclude=True)
class TestPlanOverrideView(APIView):
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not user_may_use_plan_test_override(request.user):
            raise Http404()

    def post(self, request):
        if "plan" not in request.data:
            return Response(
                {"detail": "plan is required and must be FREE, PREMIUM, or null."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        raw = request.data.get("plan")
        if raw is None or raw == "":
            plan = None
        else:
            plan = str(raw).strip().upper()
            if plan not in {PLAN_FREE, PLAN_PREMIUM}:
                return Response(
                    {"detail": "plan must be FREE, PREMIUM, or null."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        stored = set_own_test_plan_override(request.user, plan)
        effective = get_user_plan(request.user)
        return Response(
            {
                "test_plan_override": stored,
                "effective_plan": effective,
            }
        )
