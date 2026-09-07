"""
Evaluate projected insufficient-funds / credit-limit alerts and send due push notifications.

Run hourly (Render Cron Job):

  python manage.py evaluate_projected_funds_alerts

Optional:

  python manage.py evaluate_projected_funds_alerts --household_id=1
  python manage.py evaluate_projected_funds_alerts --skip-push
"""

from django.core.management.base import BaseCommand

from alerts.services.evaluate import evaluate_projected_funds_alerts


class Command(BaseCommand):
    help = "Evaluate 7-day projected funds alerts and send due Expo push notifications."

    def add_arguments(self, parser):
        parser.add_argument("--household_id", type=int, default=None)
        parser.add_argument(
            "--skip-push",
            action="store_true",
            help="Upsert/resolve alerts without sending push notifications.",
        )

    def handle(self, *args, **options):
        result = evaluate_projected_funds_alerts(
            household_id=options.get("household_id"),
            send_notifications=not options.get("skip_push"),
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Projected funds alerts: households={result['households']} "
                f"elapsed_ms={result['elapsed_ms']}"
            )
        )
