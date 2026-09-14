"""Report SMTP/email configuration presence. Never prints passwords."""

from django.core.management.base import BaseCommand, CommandError

from common.services.production_config import build_email_report, format_report


class Command(BaseCommand):
    help = "Print email/SMTP configuration status (no passwords)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--strict",
            action="store_true",
            help="Exit 1 if SMTP host or FRONTEND_ORIGIN is missing.",
        )

    def handle(self, *args, **options):
        report = build_email_report()
        self.stdout.write(format_report(report))
        if options["strict"]:
            rows = dict(report)
            missing = []
            if rows.get("SMTP_HOST") != "configured yes":
                missing.append("EMAIL_HOST")
            if "configured no" in rows.get("FRONTEND_ORIGIN", ""):
                missing.append("FRONTEND_ORIGIN")
            if missing:
                raise CommandError("Missing: " + ", ".join(missing))
