"""Report Stripe billing configuration presence. Never prints secrets."""

from django.core.management.base import BaseCommand, CommandError

from common.services.production_config import (
    build_billing_report,
    format_report,
    production_readiness,
)


class Command(BaseCommand):
    help = "Print Stripe billing configuration status (presence only; no secret values)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--offline",
            action="store_true",
            help="Skip Stripe API reachability (Price/Account retrieve).",
        )
        parser.add_argument(
            "--strict",
            action="store_true",
            help="Exit 1 if required production billing settings are missing.",
        )

    def handle(self, *args, **options):
        report = build_billing_report(probe_stripe=not options["offline"])
        self.stdout.write(format_report(report))
        if options["strict"]:
            readiness = production_readiness(probe_stripe=False)
            billing_missing = [
                name
                for name in readiness.missing
                if name.startswith("STRIPE_") or name == "FRONTEND_ORIGIN"
            ]
            if billing_missing:
                raise CommandError("Missing: " + ", ".join(billing_missing))
