from datetime import date
from decimal import Decimal

from django.db import models
from django.utils import timezone

from core.models import Household

from .managers import AccountManager, AllAccountsManager


class Account(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"
        CLOSED = "closed", "Closed"
        DELETED = "deleted", "Deleted"

    class AccountType(models.TextChoices):
        CHECKING = "CHECKING", "Checking"
        SAVINGS = "SAVINGS", "Savings"
        CREDIT = "CREDIT", "Credit"
        CASH = "CASH", "Cash"
        INVESTMENT = "INVESTMENT", "Investment"
        RETIREMENT_401K = "RETIREMENT_401K", "401k"
        OTHER = "OTHER", "Other"

    class AccountRole(models.TextChoices):
        SPENDING = "spending", "Spending"
        BILLS = "bills", "Bills"
        SAVINGS = "savings", "Savings"
        EMERGENCY_FUND = "emergency_fund", "Emergency Fund"
        CREDIT_CARD = "credit_card", "Credit Card"
        LOAN = "loan", "Loan"
        INVESTMENT = "investment", "Investment"
        CASH_RESERVE = "cash_reserve", "Cash Reserve"
        OTHER = "other", "Other"

    @classmethod
    def infer_role_from_account_type(cls, account_type: str) -> str:
        mapping = {
            cls.AccountType.CHECKING: cls.AccountRole.SPENDING,
            cls.AccountType.SAVINGS: cls.AccountRole.SAVINGS,
            cls.AccountType.CREDIT: cls.AccountRole.CREDIT_CARD,
        }
        return mapping.get(account_type, cls.AccountRole.OTHER)

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="accounts")
    account_type = models.CharField(max_length=20, choices=AccountType.choices)
    role = models.CharField(
        max_length=32,
        choices=AccountRole.choices,
        default=AccountRole.OTHER,
        db_index=True,
    )
    minimum_buffer = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0"),
        help_text="Amount to keep untouched in this account for safety.",
    )
    name = models.CharField(max_length=255)
    display_name = models.CharField(
        max_length=100,
        blank=True,
        default="",
        help_text="Short custom label shown throughout the app.",
    )
    purpose = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Concise description of how this account is used.",
    )
    notes = models.TextField(
        blank=True,
        default="",
        help_text="Optional freeform notes about this account.",
    )
    nickname = models.CharField(
        max_length=255,
        blank=True,
        help_text="Deprecated: use display_name. Kept for backward compatibility.",
    )
    institution = models.CharField(max_length=255, blank=True)
    last_four = models.CharField(
        max_length=4,
        blank=True,
        default="",
        help_text="Last four digits of the account or card (digits only). Used to attach Plaid to this row without matching by name.",
    )
    currency = models.CharField(max_length=3, default="USD")
    starting_balance = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    apr = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True, help_text="APR % for credit cards")
    interest_rate = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        help_text="APY % for savings accounts (interest paid/earned).",
    )
    interest_cycle_end_day = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text="Day of month (1-31) when interest is credited; for savings accounts.",
    )
    credit_limit = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
        help_text="Credit limit for credit cards; used to show available credit.",
    )
    billing_cycle_end_day = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text="Legacy alias for statement_closing_day; kept in sync for older clients.",
    )
    statement_closing_day = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Day of month (1-31) when the statement closes. Credit cards only.",
    )
    payment_due_day = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Day of month (1-31) when payment is due. Credit cards only.",
    )
    current_balance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0"),
        help_text="Total amount currently owed (positive = debt). Credit cards only.",
    )
    statement_balance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0"),
        help_text="Amount from the last closed statement (positive = owed). Credit cards only.",
    )
    last_statement_date = models.DateField(null=True, blank=True)
    next_statement_date = models.DateField(null=True, blank=True)
    next_payment_due_date = models.DateField(null=True, blank=True)
    minimum_payment_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0"),
    )
    autopay_enabled = models.BooleanField(default=False)
    autopay_account = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="autopay_funded_credit_cards",
        help_text="Checking/savings account that funds autopay.",
    )
    class AutopayType(models.TextChoices):
        MINIMUM_PAYMENT = "minimum_payment", "Minimum payment"
        STATEMENT_BALANCE = "statement_balance", "Statement balance"
        CURRENT_BALANCE = "current_balance", "Current balance"
        FIXED_AMOUNT = "fixed_amount", "Fixed amount"
        CUSTOM_AMOUNT = "custom_amount", "Custom amount"

    autopay_type = models.CharField(
        max_length=32,
        choices=AutopayType.choices,
        blank=True,
        default="",
    )
    autopay_fixed_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0"),
    )
    promotional_apr = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        help_text="Promotional APR % (e.g. 0 for interest-free). Used until promotional_end_date; then standard APR applies.",
    )
    promotional_end_date = models.DateField(
        null=True, blank=True,
        help_text="Last date the promotional APR applies (e.g. end of 0% intro period). After this date, standard APR is used.",
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
        db_index=True,
    )
    archived_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    is_hidden = models.BooleanField(
        default=False,
        help_text="When True, account is hidden from default UI lists.",
    )
    close_reason = models.CharField(max_length=255, blank=True, default="")
    archive_reason = models.CharField(max_length=255, blank=True, default="")
    preserve_in_net_worth = models.BooleanField(
        default=True,
        help_text="When True, balance still counts in net-worth views after lifecycle change.",
    )
    plaid_sync_enabled = models.BooleanField(
        default=True,
        help_text="When False, Plaid will not import new transactions for this account.",
    )
    is_active = models.BooleanField(default=True)
    archived = models.BooleanField(
        default=False,
        help_text="Legacy flag; kept in sync with status=archived for older clients.",
    )
    include_in_forecast = models.BooleanField(
        default=True,
        help_text="When true, this account is included in timeline scenarios.",
    )
    preserve_partner_transfer_legs = models.BooleanField(
        default=False,
        help_text=(
            "When True, deleting or clearing the counterparty account's leg of a transfer removes only "
            "that leg; rows on this account are kept and the transfer link is removed. "
            "Use for manual-only / non-Plaid ledgers (e.g. institution not responding)."
        ),
    )
    position = models.PositiveIntegerField(
        default=0,
        help_text="Display order within the account list (lower = higher in list).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = AccountManager()
    all_objects = AllAccountsManager()

    class Meta:
        db_table = "accounts_account"
        ordering = ["household", "position", "name"]
        indexes = [
            models.Index(fields=["household", "account_type"]),
            models.Index(fields=["household"]),
            models.Index(fields=["household", "status"]),
        ]

    def participates_in_forecast(self) -> bool:
        return (
            self.status == self.Status.ACTIVE
            and self.include_in_forecast
            and self.is_active
        )

    def allows_plaid_sync(self) -> bool:
        return self.status == self.Status.ACTIVE and self.plaid_sync_enabled

    def allows_new_transactions(self, on_date: date | None = None) -> bool:
        if self.status != self.Status.ACTIVE:
            return False
        if self.closed_at and on_date and on_date > self.closed_at:
            return False
        return True

    def _sync_legacy_lifecycle_flags(self) -> None:
        if self.status == self.Status.ACTIVE:
            self.is_active = True
            self.archived = False
        elif self.status == self.Status.ARCHIVED:
            self.is_active = False
            self.archived = True
            if not self.archived_at:
                self.archived_at = timezone.now()
        elif self.status in (self.Status.CLOSED, self.Status.DELETED):
            self.is_active = False
            self.archived = False
        if self.status == self.Status.DELETED:
            self.is_hidden = True

    def save(self, *args, **kwargs):
        self._sync_legacy_lifecycle_flags()
        super().save(*args, **kwargs)

    def is_credit_card(self) -> bool:
        return self.account_type == self.AccountType.CREDIT

    @property
    def effective_display_name(self) -> str:
        """User-facing label: display_name, legacy nickname, then official name."""
        for raw in (self.display_name, self.nickname):
            label = (raw or "").strip()
            if label:
                return label
        official = (self.name or "").strip()
        if official:
            return official
        inst = (self.institution or "").strip()
        if inst:
            return inst
        if self.pk:
            return f"Account #{self.pk}"
        return "Account"

    @property
    def short_description(self) -> str:
        """Compact role + purpose line for list subtitles."""
        parts: list[str] = []
        if self.role and self.role != self.AccountRole.OTHER:
            parts.append(self.get_role_display())
        purpose = (self.purpose or "").strip()
        if purpose:
            parts.append(purpose)
        return " • ".join(parts)

    def get_statement_closing_day(self) -> int | None:
        if self.statement_closing_day is not None:
            return int(self.statement_closing_day)
        if self.billing_cycle_end_day is not None:
            return int(self.billing_cycle_end_day)
        return None

    def get_payment_due_day(self) -> int | None:
        return int(self.payment_due_day) if self.payment_due_day is not None else None

    @property
    def available_credit(self) -> Decimal:
        if not self.is_credit_card():
            return Decimal("0")
        limit = Decimal(str(self.credit_limit or 0))
        owed = Decimal(str(self.current_balance or 0))
        return max(Decimal("0"), limit - owed)

    @property
    def utilization_percent(self) -> Decimal | None:
        if not self.is_credit_card():
            return None
        limit = Decimal(str(self.credit_limit or 0))
        if limit <= 0:
            return None
        owed = Decimal(str(self.current_balance or 0))
        return (owed / limit * Decimal("100")).quantize(Decimal("0.01"))

    def payments_applied_to_current_statement(self) -> Decimal:
        """Sum of card payments since last_statement_date (positive ledger amounts on card)."""
        if not self.is_credit_card() or not self.last_statement_date:
            return Decimal("0")
        from transactions.models import Transaction
        from transactions.services.matching import ledger_visible_transactions

        qs = ledger_visible_transactions(
            Transaction.objects.filter(
                account_id=self.pk,
                date__gt=self.last_statement_date,
                amount__gt=0,
            )
        )
        return sum((Decimal(str(t.amount)) for t in qs), Decimal("0"))

    @property
    def payoff_to_avoid_interest(self) -> Decimal:
        stmt = Decimal(str(self.statement_balance or 0))
        paid = self.payments_applied_to_current_statement()
        return max(Decimal("0"), stmt - paid)

    @property
    def is_payment_due_soon(self) -> bool:
        due = self.next_payment_due_date
        if due is None:
            return False
        today = date.today()
        return today <= due <= date.fromordinal(today.toordinal() + 7)

    @property
    def days_until_due(self) -> int | None:
        due = self.next_payment_due_date
        if due is None:
            return None
        return (due - date.today()).days

    @property
    def estimated_monthly_interest(self) -> Decimal:
        if not self.is_credit_card():
            return Decimal("0")
        apr_val = Decimal(str(self.apr or 0))
        if apr_val <= 0:
            return Decimal("0")
        unpaid = self.payoff_to_avoid_interest
        if unpaid <= 0:
            unpaid = Decimal(str(self.statement_balance or 0))
        if unpaid <= 0:
            return Decimal("0")
        return (unpaid * apr_val / Decimal("100") / Decimal("12")).quantize(Decimal("0.01"))

    @property
    def projected_interest_if_unpaid(self) -> Decimal:
        return self.estimated_monthly_interest


from .credit_card_models import CreditCardStatement  # noqa: E402, F401
from .relationship_models import AccountRelationship  # noqa: E402, F401
