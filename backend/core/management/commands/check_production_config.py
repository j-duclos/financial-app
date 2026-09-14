"""Summarize production dependencies without exposing secrets."""

from django.core.management.base import BaseCommand, CommandError

from common.services.production_config import (
    build_production_health_report,
    format_report,
    production_readiness,
)


class Command(BaseCommand):
    help = "Print database/redis/email/stripe/plaid/frontend readiness (no secrets)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--offline",
            action="store_true",
            help="Skip Stripe API reachability probe.",
        )
        parser.add_argument(
            "--strict",
            action="store_true",
            help="Exit 1 if required production settings are missing.",
        )

    def handle(self, *args, **options):
        report = build_production_health_report(probe_stripe=not options["offline"])
        self.stdout.write(format_report(report))
        if options["strict"]:
            readiness = production_readiness(probe_stripe=False)
            if not readiness.ok:
                raise CommandError("Missing: " + ", ".join(readiness.missing))
