from rest_framework import serializers
from .models import Budget
from categories.serializers import CategorySerializer


class BudgetSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)

    class Meta:
        model = Budget
        fields = ["id", "household", "category", "year", "month", "planned_amount", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]
