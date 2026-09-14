"""Send one test email. Never invoked automatically on deploy."""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email


class Command(BaseCommand):
    help = "Send a single FlowSight configuration test email to the given address."

    def add_arguments(self, parser):
        parser.add_argument("address", help="Recipient email address.")

    def handle(self, *args, **options):
        address = (options["address"] or "").strip()
        try:
            validate_email(address)
        except ValidationError as exc:
            raise CommandError(f"Invalid email address: {address}") from exc

        send_mail(
            subject="FlowSight email configuration test",
            message=(
                "This is a FlowSight configuration test message. "
                "No account tokens or secrets are included."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[address],
            fail_silently=False,
        )
        self.stdout.write(self.style.SUCCESS(f"Test email queued/sent to {address}"))
