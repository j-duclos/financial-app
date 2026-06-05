from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from common.services.forecast_horizon import (
    ADVANCED_DEFAULT_FORECAST_DAYS,
    parse_forecast_days_param,
)
from recommendations.services.engine import (
    build_dashboard_recommendation_list,
    build_recommendation_context,
    build_recommendations,
    build_scenario_recommendations,
    recommendation_timeline_hints,
)
from recommendations.services.serializers import to_dashboard_recommendation


class RecommendationsListView(APIView):
    """Deterministic financial recommendations (not AI)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            days = parse_forecast_days_param(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        scenario_id = request.query_params.get("scenario_id")
        sid = None
        if scenario_id:
            try:
                sid = int(scenario_id)
            except ValueError:
                return Response({"detail": "scenario_id must be an integer."}, status=400)

        ctx = build_recommendation_context(request.user, days=days, scenario_id=sid)
        full = build_recommendations(ctx)
        dashboard = [to_dashboard_recommendation(r) for r in full]
        return Response(
            {
                "as_of": ctx.today.isoformat(),
                "days": days,
                "scenario_id": sid,
                "recommendations": dashboard,
                "recommendations_full": full,
                "timeline_hints": recommendation_timeline_hints(dashboard),
            }
        )


class ScenarioRecommendationsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, scenario_id: int):
        try:
            days = parse_forecast_days_param(
                request, default=ADVANCED_DEFAULT_FORECAST_DAYS, allow_extended=True
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        recs = build_scenario_recommendations(request.user, scenario_id, days=days)
        return Response(
            {
                "scenario_id": scenario_id,
                "days": days,
                "recommendations": recs,
                "timeline_hints": recommendation_timeline_hints(recs),
            }
        )
