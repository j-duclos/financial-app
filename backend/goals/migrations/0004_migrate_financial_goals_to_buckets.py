"""Copy FinancialGoal rows into GoalBucket (allocated_amount=0 per spec)."""

from decimal import Decimal

from django.db import migrations

GOAL_TYPE_TO_BUCKET = {
    "emergency_fund": "emergency",
    "savings": "custom",
    "house_down_payment": "house",
    "college": "education",
    "vacation": "vacation",
    "taxes": "purchase",
    "car": "purchase",
    "purchase": "purchase",
    "debt_payoff": "debt_payoff",
    "custom": "custom",
}


def migrate_goals_to_buckets(apps, schema_editor):
    FinancialGoal = apps.get_model("goals", "FinancialGoal")
    GoalBucket = apps.get_model("goals", "GoalBucket")

    for goal in FinancialGoal.objects.all():
        if GoalBucket.objects.filter(legacy_goal_id=goal.id).exists():
            continue
        bucket_type = GOAL_TYPE_TO_BUCKET.get(goal.goal_type, "custom")
        priority = "medium"
        if goal.priority == 1:
            priority = "high"
        elif goal.priority >= 4:
            priority = "low"
        linked = goal.linked_account_id
        if goal.goal_type == "debt_payoff" and goal.linked_credit_account_id:
            linked = goal.linked_credit_account_id
        GoalBucket.objects.create(
            household_id=goal.household_id,
            created_by_id=goal.created_by_id,
            legacy_goal_id=goal.id,
            name=goal.name,
            description=goal.notes or "",
            type=bucket_type,
            status=goal.status,
            priority=priority,
            target_amount=goal.target_amount,
            allocated_amount=Decimal("0"),
            start_date=goal.created_at.date() if goal.created_at else None,
            target_date=goal.target_date,
            linked_account_id=linked,
            monthly_target=goal.monthly_contribution or Decimal("0"),
            auto_fund_enabled=False,
            forecast_enabled=True,
            include_in_safe_to_spend=True,
            notes=goal.notes or "",
            completed_at=goal.completed_at,
            created_at=goal.created_at,
            updated_at=goal.updated_at,
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("goals", "0003_goal_buckets"),
    ]

    operations = [
        migrations.RunPython(migrate_goals_to_buckets, noop_reverse),
    ]
