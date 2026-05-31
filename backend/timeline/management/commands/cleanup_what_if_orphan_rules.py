"""
Remove household RecurringRules created by an earlier What-If bug (inactive rule + scenario override)
and delete their future materialized transactions.

Usage:
  python manage.py cleanup_what_if_orphan_rules
  python manage.py cleanup_what_if_orphan_rules --dry-run
"""
from django.core.management.base import BaseCommand

from timeline.models import RecurringRule, ScenarioRuleOverride
from timeline.services.rule_cleanup import delete_future_materialized_transactions_for_rule

MARKER = "what_if_new_recurring"


class Command(BaseCommand):
    help = "Delete orphan What-If recurring rules that polluted the real timeline."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List rules that would be deleted without changing data.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        rule_ids = set(
            RecurringRule.objects.filter(notes__icontains=MARKER).values_list("pk", flat=True)
        )
        rule_ids.update(
            ScenarioRuleOverride.objects.filter(notes__icontains=MARKER).values_list(
                "rule_id", flat=True
            )
        )
        rules = RecurringRule.objects.filter(pk__in=rule_ids).order_by("name", "pk")
        if not rules.exists():
            self.stdout.write(self.style.SUCCESS("No orphan What-If rules found."))
            return

        for rule in rules:
            self.stdout.write(f"{'[dry-run] ' if dry_run else ''}Rule {rule.pk}: {rule.name}")
            if dry_run:
                continue
            delete_future_materialized_transactions_for_rule(rule.pk)
            ScenarioRuleOverride.objects.filter(rule=rule).delete()
            rule.delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"{'Would remove' if dry_run else 'Removed'} {rules.count()} orphan rule(s)."
            )
        )
