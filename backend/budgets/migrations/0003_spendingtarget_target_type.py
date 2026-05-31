from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("budgets", "0002_spendingtarget"),
    ]

    operations = [
        migrations.AddField(
            model_name="spendingtarget",
            name="target_type",
            field=models.CharField(
                choices=[
                    ("fixed", "Fixed / scheduled"),
                    ("variable", "Variable / paced"),
                ],
                default="variable",
                max_length=20,
            ),
        ),
    ]
