from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from accounts.models import Account
from core.models import Household

# Planning defaults only — user-editable, not lender approval limits.
DEFAULT_PLANNING_TARGET_BACK_END_DTI_PERCENT = Decimal("36.00")
DEFAULT_PLANNING_TARGET_FRONT_END_DTI_PERCENT = Decimal("28.00")


class DtiProfile(models.Model):
    """Household DTI planning configuration. One profile per household; optional until saved."""

    household = models.OneToOneField(
        Household, on_delete=models.CASCADE, related_name="dti_profile"
    )
    target_back_end_dti_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=DEFAULT_PLANNING_TARGET_BACK_END_DTI_PERCENT,
        validators=[MinValueValidator(Decimal("0.01")), MaxValueValidator(Decimal("100"))],
        help_text="Planning default for back-end DTI (%). User-editable; not an approval limit.",
    )
    target_front_end_dti_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        default=DEFAULT_PLANNING_TARGET_FRONT_END_DTI_PERCENT,
        validators=[MinValueValidator(Decimal("0.01")), MaxValueValidator(Decimal("100"))],
        help_text="Optional planning default for front-end DTI (%). Not an approval limit.",
    )
    current_housing_payment = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
        help_text="Saved current monthly housing payment (rent or mortgage PITI, etc.).",
    )
    current_housing_label = models.CharField(max_length=255, blank=True, default="")
    include_current_housing_in_current_dti = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "affordability_dti_profile"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(current_housing_payment__gte=0),
                name="dti_profile_housing_nonnegative",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    target_back_end_dti_percent__gt=0,
                    target_back_end_dti_percent__lte=100,
                ),
                name="dti_profile_back_end_target_range",
            ),
            models.CheckConstraint(
                condition=models.Q(target_front_end_dti_percent__isnull=True)
                | models.Q(
                    target_front_end_dti_percent__gt=0,
                    target_front_end_dti_percent__lte=100,
                ),
                name="dti_profile_front_end_target_range",
            ),
        ]

    def __str__(self) -> str:
        return f"DTI profile for household {self.household_id}"


class DtiIncomeSource(models.Model):
    class IncomeType(models.TextChoices):
        EMPLOYMENT = "employment", "Employment"
        SELF_EMPLOYMENT = "self_employment", "Self-employment"
        CONTRACT = "contract", "Contract"
        RENTAL = "rental", "Rental"
        RETIREMENT = "retirement", "Retirement"
        SOCIAL_SECURITY = "social_security", "Social Security"
        DISABILITY = "disability", "Disability"
        ALIMONY = "alimony", "Alimony"
        CHILD_SUPPORT = "child_support", "Child support"
        OTHER = "other", "Other"

    household = models.ForeignKey(
        Household, on_delete=models.CASCADE, related_name="dti_income_sources"
    )
    name = models.CharField(max_length=255)
    gross_monthly_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
        help_text="Gross monthly amount. Inclusion is user-controlled; type is a label only.",
    )
    income_type = models.CharField(
        max_length=32,
        choices=IncomeType.choices,
        default=IncomeType.OTHER,
        help_text="Organizational label only. Does not decide lender-qualifying status.",
    )
    included = models.BooleanField(default=True)
    notes = models.TextField(blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "affordability_dti_income_source"
        ordering = ["position", "id"]
        indexes = [
            models.Index(fields=["household", "position"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(gross_monthly_amount__gte=0),
                name="dti_income_amount_nonnegative",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class DtiDebtItem(models.Model):
    class DebtType(models.TextChoices):
        CREDIT_CARD = "credit_card", "Credit card"
        AUTO_LOAN = "auto_loan", "Auto loan"
        STUDENT_LOAN = "student_loan", "Student loan"
        MORTGAGE = "mortgage", "Mortgage"
        HOME_EQUITY = "home_equity", "Home equity"
        PERSONAL_LOAN = "personal_loan", "Personal loan"
        INSTALLMENT_LOAN = "installment_loan", "Installment loan"
        ALIMONY = "alimony", "Alimony"
        CHILD_SUPPORT = "child_support", "Child support"
        OTHER = "other", "Other"

    class PaymentSource(models.TextChoices):
        MANUAL = "manual", "Manual"
        LINKED_ACCOUNT_MINIMUM = "linked_account_minimum", "Linked account minimum"

    class StudentLoanStatus(models.TextChoices):
        REPAYMENT = "repayment", "In repayment"
        DEFERRED = "deferred", "Deferred"
        FORBEARANCE = "forbearance", "Forbearance"
        UNKNOWN = "unknown", "Unknown"

    class StudentLoanPaymentMethod(models.TextChoices):
        MANUAL = "manual", "Manual or reported monthly payment"
        FHA_DEFERRED_BALANCE_PERCENT = (
            "fha_deferred_balance_percent",
            "FHA deferred/zero-payment estimate — 0.5% of balance",
        )

    household = models.ForeignKey(
        Household, on_delete=models.CASCADE, related_name="dti_debt_items"
    )
    name = models.CharField(max_length=255)
    debt_type = models.CharField(
        max_length=32,
        choices=DebtType.choices,
        default=DebtType.OTHER,
    )
    monthly_payment = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
        help_text="Authoritative when payment_source=manual. Not overwritten from a linked account.",
    )
    outstanding_balance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0"))],
    )
    linked_account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dti_debt_items",
        help_text="Optional account link. Deleting the account nulls this; the DTI profile remains.",
    )
    payment_source = models.CharField(
        max_length=32,
        choices=PaymentSource.choices,
        default=PaymentSource.MANUAL,
    )
    student_loan_status = models.CharField(
        max_length=16,
        choices=StudentLoanStatus.choices,
        null=True,
        blank=True,
        help_text="Student-loan repayment status. Ignored for other debt types.",
    )
    student_loan_payment_method = models.CharField(
        max_length=40,
        choices=StudentLoanPaymentMethod.choices,
        null=True,
        blank=True,
        help_text=(
            "How the DTI monthly payment is determined for a student loan. "
            "Ignored for other debt types. Existing rows without a method use the stored monthly payment."
        ),
    )
    included = models.BooleanField(default=True)
    months_remaining = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "affordability_dti_debt_item"
        ordering = ["position", "id"]
        indexes = [
            models.Index(fields=["household", "position"]),
            models.Index(fields=["household", "linked_account"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(monthly_payment__gte=0),
                name="dti_debt_payment_nonnegative",
            ),
            models.CheckConstraint(
                condition=models.Q(outstanding_balance__isnull=True)
                | models.Q(outstanding_balance__gte=0),
                name="dti_debt_balance_nonnegative",
            ),
            models.CheckConstraint(
                condition=models.Q(months_remaining__isnull=True)
                | models.Q(months_remaining__gt=0),
                name="dti_debt_months_remaining_positive",
            ),
            models.UniqueConstraint(
                fields=["household", "linked_account"],
                condition=models.Q(linked_account__isnull=False),
                name="uniq_dti_debt_linked_account_per_household",
            ),
        ]

    def __str__(self) -> str:
        return self.name
