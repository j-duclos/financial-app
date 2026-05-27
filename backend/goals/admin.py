from django.contrib import admin

from goals.models import FinancialGoal


@admin.register(FinancialGoal)
class FinancialGoalAdmin(admin.ModelAdmin):
    list_display = ("name", "goal_type", "household", "target_amount", "status", "priority")
    list_filter = ("status", "goal_type", "household")
    search_fields = ("name",)
