"""Credit card statement history (separate from CSV reconcile StatementTransaction)."""
from decimal import Decimal

from django.db import models

from .models import Account


class CreditCardStatement(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        CLOSED = "closed", "Closed"
        PAID = "paid", "Paid"
        PARTIAL = "partial", "Partial"
        LATE = "late", "Late"

    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="credit_card_statements",
    )
    period_start = models.DateField()
    period_end = models.DateField()
    statement_balance = models.DecimalField(max_digits=12, decimal_places=2)
    minimum_payment = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    payment_due_date = models.DateField()
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.OPEN,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "accounts_credit_card_statement"
        ordering = ["-period_end", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "period_start", "period_end"],
                name="uniq_credit_card_statement_period",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.account_id} {self.period_start}–{self.period_end}"
