"""Account queryset helpers for lifecycle-aware queries."""
from __future__ import annotations

from django.db import models


class AccountQuerySet(models.QuerySet):
    def active(self):
        from .models import Account

        return self.filter(status=Account.Status.ACTIVE)

    def archived(self):
        from .models import Account

        return self.filter(status=Account.Status.ARCHIVED)

    def closed(self):
        from .models import Account

        return self.filter(status=Account.Status.CLOSED)

    def deleted(self):
        from .models import Account

        return self.filter(status=Account.Status.DELETED)

    def non_deleted(self):
        from .models import Account

        return self.exclude(status=Account.Status.DELETED)

    def visible(self):
        """Non-deleted accounts that are not UI-hidden."""
        return self.non_deleted().filter(is_hidden=False)

    def for_historical_reporting(self):
        """Include active, archived, and closed; exclude soft-deleted."""
        return self.non_deleted()

    def operational(self):
        """Accounts that participate in live forecasting and safe-to-spend."""
        from .models import Account

        return self.filter(
            status=Account.Status.ACTIVE,
            include_in_forecast=True,
        )

    def for_net_worth(self):
        """Balances for net-worth views: non-deleted with preserve flag or still active."""
        from .models import Account

        return self.non_deleted().filter(
            models.Q(preserve_in_net_worth=True)
            | models.Q(status__in=[Account.Status.ACTIVE, Account.Status.ARCHIVED, Account.Status.CLOSED])
        )

    def plaid_linkable(self):
        """Eligible for new Plaid attachment (active, not already lifecycle-inactive)."""
        from .models import Account

        return self.filter(
            status=Account.Status.ACTIVE,
            archived=False,
            plaid_sync_enabled=True,
        )


class AccountManager(models.Manager.from_queryset(AccountQuerySet)):
    """Default manager excludes soft-deleted accounts."""

    def get_queryset(self):
        return super().get_queryset().non_deleted()


class AllAccountsManager(models.Manager.from_queryset(AccountQuerySet)):
    """Unfiltered manager for admin, recovery, and lifecycle transitions."""

    pass
