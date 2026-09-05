from django.contrib import admin

from affordability.models import DtiDebtItem, DtiIncomeSource, DtiProfile


@admin.register(DtiProfile)
class DtiProfileAdmin(admin.ModelAdmin):
    list_display = (
        "household",
        "target_back_end_dti_percent",
        "target_front_end_dti_percent",
        "current_housing_payment",
        "include_current_housing_in_current_dti",
        "updated_at",
    )
    search_fields = ("household__name",)


@admin.register(DtiIncomeSource)
class DtiIncomeSourceAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "household",
        "income_type",
        "gross_monthly_amount",
        "included",
        "position",
    )
    list_filter = ("income_type", "included", "household")
    search_fields = ("name",)


@admin.register(DtiDebtItem)
class DtiDebtItemAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "household",
        "debt_type",
        "monthly_payment",
        "payment_source",
        "included",
        "linked_account",
        "position",
    )
    list_filter = ("debt_type", "payment_source", "included", "household")
    search_fields = ("name",)
