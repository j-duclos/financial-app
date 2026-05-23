"""
Create in-app notifications for recurring rule charges due in the next 3 calendar days
(today through two days from now, inclusive).

Run daily (e.g. via cron at 06:00):
  python manage.py create_upcoming_charge_notifications

Optionally for a specific household:
  python manage.py create_upcoming_charge_notifications --household_id=1
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Household
from timeline.models import RecurringRule, UpcomingChargeNotification
from timeline.services.ledger import generate_rule_occurrences


class Command(BaseCommand):
    help = "Create notifications for charges due in the next 3 days (run daily)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--household_id",
            type=int,
            default=None,
            help="Optional: only process this household.",
        )

    def handle(self, *args, **options):
        today = timezone.localdate()
        window_end = today + timedelta(days=2)
        household_id = options.get("household_id")

        if household_id is not None:
            try:
                households = [Household.objects.get(pk=household_id)]
            except Household.DoesNotExist:
                self.stderr.write(self.style.ERROR(f"Household {household_id} not found."))
                return
        else:
            households = list(Household.objects.all())

        created_count = 0
        for household in households:
            # Only EXPENSE and TRANSFER are "charges" the user needs a reminder for
            rules = RecurringRule.objects.filter(
                household=household,
                active=True,
                direction__in=(RecurringRule.Direction.EXPENSE, RecurringRule.Direction.TRANSFER),
            ).select_related("account", "category")

            for rule in rules:
                occurrences = generate_rule_occurrences(
                    rule,
                    start_date=today,
                    end_date=window_end,
                )
                for due_date in occurrences:
                    _, created = UpcomingChargeNotification.objects.get_or_create(
                        household=household,
                        rule=rule,
                        due_date=due_date,
                        defaults={},
                    )
                    if created:
                        created_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Created {created_count} upcoming charge notification(s) for "
                f"{today.isoformat()}…{window_end.isoformat()}."
            )
        )
