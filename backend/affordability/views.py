from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.generics import ListCreateAPIView, RetrieveUpdateDestroyAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Account
from affordability.models import (
    DEFAULT_PLANNING_TARGET_BACK_END_DTI_PERCENT,
    DEFAULT_PLANNING_TARGET_FRONT_END_DTI_PERCENT,
    DtiDebtItem,
    DtiIncomeSource,
    DtiProfile,
)
from affordability.serializers import (
    DtiCalculateSerializer,
    DtiDebtItemSerializer,
    DtiIncomeSourceSerializer,
    DtiProfileSerializer,
    proposed_housing_from_validated,
)
from affordability.services.dti import (
    ProfileInput,
    calculate_dti,
    load_dti_records,
    serialize_dti_result,
    suggestions_from_accounts,
)
from core.models import Household
from core.permissions import IsHouseholdMember
from core.utils import get_households_for_user


def _household_id_param(request) -> str | None:
    return request.query_params.get("household_id") or request.query_params.get("household")


def get_authorized_household(request, household_id=None) -> Household | None:
    if household_id is None:
        raw = _household_id_param(request)
        if raw in (None, ""):
            return None
        try:
            household_id = int(raw)
        except (TypeError, ValueError):
            return None
    return get_households_for_user(request.user).filter(pk=household_id).first()


def _require_household(request, household_id=None) -> tuple[Household | None, Response | None]:
    raw = household_id
    if raw is None:
        raw = _household_id_param(request)
    if raw in (None, ""):
        return None, Response(
            {"detail": "household_id is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        pk = int(raw)
    except (TypeError, ValueError):
        return None, Response(
            {"detail": "household_id must be an integer."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    household = get_authorized_household(request, pk)
    if household is None:
        return None, Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return household, None


def unsaved_profile_payload(household: Household) -> dict:
    return {
        "id": None,
        "household_id": household.id,
        "target_back_end_dti_percent": str(DEFAULT_PLANNING_TARGET_BACK_END_DTI_PERCENT),
        "target_front_end_dti_percent": str(DEFAULT_PLANNING_TARGET_FRONT_END_DTI_PERCENT),
        "current_housing_payment": "0.00",
        "current_housing_label": "",
        "include_current_housing_in_current_dti": True,
        "is_saved": False,
        "created_at": None,
        "updated_at": None,
    }


class DtiProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        household, error = _require_household(request)
        if error:
            return error
        profile = DtiProfile.objects.filter(household=household).first()
        if profile is None:
            return Response(unsaved_profile_payload(household))
        return Response(
            DtiProfileSerializer(profile, context={"request": request, "household": household}).data
        )

    def put(self, request):
        household, error = _require_household(request)
        if error:
            return error
        instance = DtiProfile.objects.filter(household=household).first()
        serializer = DtiProfileSerializer(
            instance,
            data=request.data,
            context={"request": request, "household": household},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(household=household)
        return Response(serializer.data)


class HouseholdScopedListCreateView(ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method == "GET":
            _, error = _require_household(request)
            if error:
                self._household_error = error
            else:
                self._household_error = None
        else:
            self._household_error = None

    def list(self, request, *args, **kwargs):
        if getattr(self, "_household_error", None):
            return self._household_error
        return super().list(request, *args, **kwargs)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        household = get_authorized_household(self.request)
        if household is not None:
            ctx["household"] = household
        return ctx


class DtiIncomeSourceListCreateView(HouseholdScopedListCreateView):
    serializer_class = DtiIncomeSourceSerializer

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        qs = DtiIncomeSource.objects.filter(household__in=households).order_by("position", "id")
        household = get_authorized_household(self.request)
        if household is not None:
            qs = qs.filter(household=household)
        return qs


class DtiIncomeSourceDetailView(RetrieveUpdateDestroyAPIView):
    serializer_class = DtiIncomeSourceSerializer
    permission_classes = [IsHouseholdMember]
    http_method_names = ["get", "patch", "put", "delete", "head", "options"]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return DtiIncomeSource.objects.filter(household__in=households)


class DtiDebtItemListCreateView(HouseholdScopedListCreateView):
    serializer_class = DtiDebtItemSerializer

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        qs = (
            DtiDebtItem.objects.filter(household__in=households)
            .select_related("linked_account")
            .order_by("position", "id")
        )
        household = get_authorized_household(self.request)
        if household is not None:
            qs = qs.filter(household=household)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                self.perform_create(serializer)
        except IntegrityError:
            return Response(
                {"linked_account_id": ["This account is already linked to a DTI debt item."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)


class DtiDebtItemDetailView(RetrieveUpdateDestroyAPIView):
    serializer_class = DtiDebtItemSerializer
    permission_classes = [IsHouseholdMember]
    http_method_names = ["get", "patch", "put", "delete", "head", "options"]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return (
            DtiDebtItem.objects.filter(household__in=households).select_related("linked_account")
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                self.perform_update(serializer)
        except IntegrityError:
            return Response(
                {"linked_account_id": ["This account is already linked to a DTI debt item."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(serializer.data)


class DtiCalculateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = DtiCalculateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        household = get_authorized_household(request, data["household_id"])
        if household is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        profile, income_sources, debt_items, suggestions = load_dti_records(household)
        if "target_back_end_dti_percent" in data:
            profile = ProfileInput(
                target_back_end_dti_percent=data["target_back_end_dti_percent"],
                target_front_end_dti_percent=(
                    data["target_front_end_dti_percent"]
                    if "target_front_end_dti_percent" in data
                    else profile.target_front_end_dti_percent
                ),
                current_housing_payment=profile.current_housing_payment,
                current_housing_label=profile.current_housing_label,
                include_current_housing_in_current_dti=profile.include_current_housing_in_current_dti,
            )
        elif "target_front_end_dti_percent" in data:
            profile = ProfileInput(
                target_back_end_dti_percent=profile.target_back_end_dti_percent,
                target_front_end_dti_percent=data["target_front_end_dti_percent"],
                current_housing_payment=profile.current_housing_payment,
                current_housing_label=profile.current_housing_label,
                include_current_housing_in_current_dti=profile.include_current_housing_in_current_dti,
            )

        proposed = None
        if "proposed_housing" in data and data["proposed_housing"] is not None:
            proposed = proposed_housing_from_validated(data["proposed_housing"])

        result = calculate_dti(
            household_id=household.id,
            profile=profile,
            income_sources=income_sources,
            debt_items=debt_items,
            proposed_housing=proposed,
            excluded_debt_item_ids=data.get("excluded_debt_item_ids") or [],
            credit_card_suggestions=suggestions,
            known_debt_item_ids=[item.id for item in debt_items if item.id is not None],
        )
        return Response(serialize_dti_result(result))


class DtiCreditCardSuggestionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        household, error = _require_household(request)
        if error:
            return error
        linked_ids = DtiDebtItem.objects.filter(
            household=household, linked_account_id__isnull=False
        ).values_list("linked_account_id", flat=True)
        cards = (
            Account.objects.filter(
                household=household,
                account_type=Account.AccountType.CREDIT,
                status=Account.Status.ACTIVE,
                is_active=True,
                is_hidden=False,
            )
            .exclude(id__in=linked_ids)
            .order_by("position", "name", "id")
        )
        return Response([item.to_dict() for item in suggestions_from_accounts(cards)])
