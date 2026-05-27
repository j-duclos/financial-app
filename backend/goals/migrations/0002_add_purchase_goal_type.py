# Generated manually for purchase goal type

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("goals", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="financialgoal",
            name="goal_type",
            field=models.CharField(
                choices=[
                    ("savings", "Savings"),
                    ("debt_payoff", "Debt payoff"),
                    ("emergency_fund", "Emergency fund"),
                    ("house_down_payment", "House down payment"),
                    ("college", "College"),
                    ("vacation", "Vacation"),
                    ("taxes", "Taxes"),
                    ("car", "Car"),
                    ("purchase", "Purchase"),
                    ("custom", "Custom"),
                ],
                default="savings",
                max_length=32,
            ),
        ),
    ]
