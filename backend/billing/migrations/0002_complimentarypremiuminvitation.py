from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ComplimentaryPremiumInvitation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("email", models.EmailField(db_index=True, max_length=254)),
                ("token_hash", models.CharField(max_length=64, unique=True)),
                ("complimentary_premium_until", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("accepted_at", models.DateTimeField(blank=True, null=True)),
                (
                    "accepted_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="accepted_complimentary_invitations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_complimentary_invitations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={
                "db_table": "billing_complimentary_premium_invitation",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="complimentarypremiuminvitation",
            index=models.Index(fields=["email", "accepted_at"], name="billing_com_email_8f2a1c_idx"),
        ),
        migrations.AddIndex(
            model_name="complimentarypremiuminvitation",
            index=models.Index(fields=["expires_at"], name="billing_com_expires_4c91ab_idx"),
        ),
    ]
