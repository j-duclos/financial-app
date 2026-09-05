from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("affordability", "0001_dti_profile_income_and_debt"),
    ]

    operations = [
        migrations.AddField(
            model_name="dtidebtitem",
            name="student_loan_payment_method",
            field=models.CharField(
                blank=True,
                choices=[
                    ("manual", "Manual or reported monthly payment"),
                    (
                        "fha_deferred_balance_percent",
                        "FHA deferred/zero-payment estimate — 0.5% of balance",
                    ),
                ],
                help_text=(
                    "How the DTI monthly payment is determined for a student loan. "
                    "Ignored for other debt types. Existing rows without a method use the stored monthly payment."
                ),
                max_length=40,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="dtidebtitem",
            name="student_loan_status",
            field=models.CharField(
                blank=True,
                choices=[
                    ("repayment", "In repayment"),
                    ("deferred", "Deferred"),
                    ("forbearance", "Forbearance"),
                    ("unknown", "Unknown"),
                ],
                help_text="Student-loan repayment status. Ignored for other debt types.",
                max_length=16,
                null=True,
            ),
        ),
    ]
