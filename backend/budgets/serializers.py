from rest_framework import serializers

from categories.models import Category
from categories.serializers import CategorySerializer

from .models import Budget, SpendingTarget
from .services.spending_targets import calculate_target_metrics, suggest_target_type


class BudgetSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)

    class Meta:
        model = Budget
        fields = [
            "id",
            "household",
            "category",
            "year",
            "month",
            "planned_amount",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class SpendingTargetSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)

    class Meta:
        model = SpendingTarget
        fields = [
            "id",
            "household",
            "category",
            "name",
            "target_amount",
            "period",
            "target_type",
            "account",
            "active",
            "warning_threshold_percent",
            "hard_limit",
            "notes",
            "metrics",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "metrics"]

    metrics = serializers.SerializerMethodField()

    def get_metrics(self, obj: SpendingTarget) -> dict:
        request = self.context.get("request")
        include_scheduled = True
        anchor = None
        if request:
            if request.query_params.get("include_scheduled", "true").lower() == "false":
                include_scheduled = False
            elif request.query_params.get("include_forecast", "true").lower() == "false":
                include_scheduled = False
            anchor_str = request.query_params.get("anchor")
            if anchor_str:
                from datetime import date

                try:
                    anchor = date.fromisoformat(anchor_str[:10])
                except ValueError:
                    anchor = None
        return calculate_target_metrics(
            obj,
            anchor=anchor,
            include_scheduled=include_scheduled,
        )


class SpendingTargetWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = SpendingTarget
        fields = [
            "id",
            "household",
            "category",
            "name",
            "target_amount",
            "period",
            "target_type",
            "account",
            "active",
            "warning_threshold_percent",
            "hard_limit",
            "notes",
        ]
        read_only_fields = ["id"]

    def validate_category(self, category: Category) -> Category:
        if category.category_type != Category.CategoryType.EXPENSE:
            raise serializers.ValidationError("Spending limits require an expense category.")
        household = self.initial_data.get("household") or (
            self.instance.household_id if self.instance else None
        )
        if household and category.household_id != int(household):
            raise serializers.ValidationError("Category must belong to the same household.")
        return category

    def create(self, validated_data):
        if not validated_data.get("target_type"):
            validated_data["target_type"] = suggest_target_type(validated_data["category"])[
                "target_type"
            ]
        return super().create(validated_data)
