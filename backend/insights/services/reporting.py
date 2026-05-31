"""Shared filters for historical income/expense reporting."""

from django.db.models import QuerySet

from insights.services.dashboard_upcoming import BANK_TRANSFER_CATEGORY_NAMES


def exclude_internal_transfers(qs: QuerySet) -> QuerySet:
    """Drop paired transfer legs and bank-transfer categories from P&L-style totals."""
    return qs.exclude(transfer_group_id__isnull=False).exclude(
        category__name__in=BANK_TRANSFER_CATEGORY_NAMES
    )
