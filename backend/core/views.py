from django.conf import settings
from django.http import JsonResponse

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Household, HouseholdMembership
from .permissions import IsHouseholdMember
from .serializers import (
    ChangePasswordSerializer,
    HouseholdSerializer,
    HouseholdDetailSerializer,
    RegisterSerializer,
    UserProfileSerializer,
)
from .utils import get_user_profile, get_households_for_user


from common.services.redis_config import redis_diagnostics, verify_redis_cache


def home(request):
    return JsonResponse({
        "status": "ok",
        "service": "financial-app-api",
        "docs": "/api/docs/",
        "admin": "/admin/",
    })


def health(request):
    payload: dict = {"status": "ok"}
    diag = redis_diagnostics()
    payload["redis"] = {
        "configured": diag["redis_configured"],
        "timeline_cache_enabled": diag["timeline_cache_enabled"],
    }
    if diag["redis_configured"]:
        ok, _ = verify_redis_cache()
        payload["redis"]["connected"] = ok
        if not ok:
            payload["status"] = "degraded"
    return JsonResponse(payload)


class DatabaseInfoView(APIView):
    """Return which database the running backend is using. No auth required."""
    permission_classes = [AllowAny]

    def get(self, request):
        db = settings.DATABASES["default"]
        engine = db.get("ENGINE", "")
        name = db.get("NAME", "")
        if "sqlite" in engine:
            return Response({"database": "sqlite", "path": str(name)})
        return Response({
            "database": "postgres",
            "name": name,
            "host": db.get("HOST", ""),
            "port": db.get("PORT", ""),
            "user": db.get("USER", ""),
        })


class TokenObtainPairViewNoAuth(TokenObtainPairView):
    """Obtain JWT token; do not run JWT auth on this request so a stale/invalid token can't cause 401."""
    permission_classes = [AllowAny]
    authentication_classes = []


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(user)
        profile = get_user_profile(user)
        return Response(
            {
                "user": {"id": user.id, "username": user.username},
                "profile": UserProfileSerializer(profile).data if profile else None,
                "access": str(refresh.access_token),
                "refresh": str(refresh),
            },
            status=status.HTTP_201_CREATED,
        )


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = get_user_profile(request.user)
        serializer = UserProfileSerializer(profile, context={"request": request})
        return Response(serializer.data)

    def patch(self, request):
        profile = get_user_profile(request.user)
        serializer = UserProfileSerializer(profile, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["current_password"]):
            return Response(
                {"detail": "Current password is incorrect."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.set_password(serializer.validated_data["new_password"])
        user.save()
        return Response({"detail": "Password updated."})


class HouseholdViewSet(ModelViewSet):
    serializer_class = HouseholdSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return get_households_for_user(self.request.user)

    def get_serializer_class(self):
        if self.action == "retrieve":
            return HouseholdDetailSerializer
        return HouseholdSerializer

    def perform_create(self, serializer):
        household = serializer.save()
        HouseholdMembership.objects.create(
            household=household, user=self.request.user, role=HouseholdMembership.Role.OWNER
        )
