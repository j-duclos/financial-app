from rest_framework import serializers

from .models import Category


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = [
            "id",
            "household",
            "parent",
            "name",
            "category_type",
            "is_system",
            "is_archived",
            "sort_order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_system", "created_at", "updated_at"]

    def validate_name(self, value):
        name = (value or "").strip()
        if len(name) < 2:
            raise serializers.ValidationError("Name must be at least 2 characters.")
        return name

    def validate(self, attrs):
        household = attrs.get("household") or (self.instance and self.instance.household)
        name = attrs.get("name", "").strip()
        cat_type = attrs.get("category_type") or (self.instance and self.instance.category_type)
        parent = attrs.get("parent") if "parent" in attrs else getattr(self.instance, "parent", None)

        if household and name and cat_type:
            qs = Category.objects.filter(
                household=household,
                category_type=cat_type,
                is_archived=False,
            ).exclude(pk=getattr(self.instance, "pk", None))
            if qs.filter(name__iexact=name).exists():
                raise serializers.ValidationError(
                    {"name": f"A category with name '{name}' already exists for this type."}
                )

        if parent and household and cat_type:
            if parent.household_id != household.id:
                raise serializers.ValidationError(
                    {"parent": "Parent must belong to the same household."}
                )
            if parent.category_type != cat_type:
                raise serializers.ValidationError(
                    {"parent": "Parent must have the same type (Income/Expense)."}
                )

        return attrs
