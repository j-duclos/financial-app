"""Authenticated review-prompt state and product feedback."""
from __future__ import annotations

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .feedback import REVIEW_SESSION_GAP, deliver_feedback_email
from .models import Feedback, ReviewPromptState
from .serializers import (
    FeedbackCreateSerializer,
    ReviewPromptPatchSerializer,
    ReviewPromptStateSerializer,
)
from .throttles import FeedbackUserThrottle


def get_review_prompt_state(user) -> ReviewPromptState:
    state, _ = ReviewPromptState.objects.get_or_create(user=user)
    if not isinstance(state.enjoyment_prompt_ats, list):
        state.enjoyment_prompt_ats = []
    return state


class ReviewPromptView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        state = get_review_prompt_state(request.user)
        return Response(ReviewPromptStateSerializer(state).data)

    def patch(self, request):
        serializer = ReviewPromptPatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        state = get_review_prompt_state(request.user)
        now = timezone.now()
        fields = set()

        if data.get("record_session"):
            if state.first_eligible_use_at is None:
                state.first_eligible_use_at = now
                state.session_count = max(state.session_count, 1)
                state.last_session_at = now
                fields.update({"first_eligible_use_at", "session_count", "last_session_at"})
            elif state.last_session_at is None or (now - state.last_session_at) >= REVIEW_SESSION_GAP:
                state.session_count = (state.session_count or 0) + 1
                state.last_session_at = now
                fields.update({"session_count", "last_session_at"})

        if data.get("mark_prompt_shown"):
            stamps = list(state.enjoyment_prompt_ats or [])
            stamps.append(now.isoformat())
            state.enjoyment_prompt_ats = stamps[-20:]
            state.last_prompted_at = now
            fields.update({"enjoyment_prompt_ats", "last_prompted_at"})

        if "enjoyment_response" in data:
            state.enjoyment_response = data["enjoyment_response"]
            fields.add("enjoyment_response")

        if data.get("review_asked_at"):
            state.review_asked_at = now
            fields.add("review_asked_at")

        if data.get("feedback_submitted"):
            state.feedback_submitted_at = now
            fields.add("feedback_submitted_at")

        if "dismissed_until" in data:
            state.dismissed_until = data["dismissed_until"]
            fields.add("dismissed_until")

        if "review_flow_completed" in data:
            state.review_flow_completed = bool(data["review_flow_completed"])
            fields.add("review_flow_completed")

        if fields:
            state.save(update_fields=[*fields, "updated_at"])
        return Response(ReviewPromptStateSerializer(state).data)


class FeedbackView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [FeedbackUserThrottle]

    def post(self, request):
        serializer = FeedbackCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        record = Feedback.objects.create(
            user=request.user,
            source=payload["source"],
            platform=payload["platform"],
            category=payload.get("category") or "",
            message=payload["message"],
            allow_contact=bool(payload.get("allow_contact")),
            app_version=payload.get("app_version") or "",
            build_number=payload.get("build_number") or "",
            device_os_version=payload.get("device_os_version") or "",
        )
        deliver_feedback_email(record)
        return Response(
            {"id": record.pk, "email_sent": bool(record.email_sent_at)},
            status=status.HTTP_201_CREATED,
        )
