from django.db import migrations, models


def dedupe_categories_forward(apps, schema_editor):
    from categories.services.dedupe import merge_duplicate_categories

    merge_duplicate_categories(dry_run=False)


class Migration(migrations.Migration):
    dependencies = [
        ("categories", "0003_timeline_models"),
    ]

    operations = [
        migrations.RunPython(dedupe_categories_forward, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="category",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_archived", False), ("parent__isnull", True)),
                fields=("household", "name", "category_type"),
                name="uniq_category_root_active",
            ),
        ),
        migrations.AddConstraint(
            model_name="category",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_archived", False), ("parent__isnull", False)),
                fields=("household", "parent", "name", "category_type"),
                name="uniq_category_child_active",
            ),
        ),
    ]
