"""
Guided What-If strategy: eligibility, validation, persistence, and serialization.

Phase 1 stores configuration only. Simulation / cash reallocation is Phase 2.
Saving a strategy must not create real Transaction or RecurringRule rows, bump
household financial_revision, or change comparison results.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Iterable

from django.db import transaction
from rest_framework import serializers
from rest_framework.fields import DateTimeField

from accounts.models import Account
from accounts.services.available_to_spend import account_supports_available_to_spend
from credit_cards.services.debt_engine import DEBT_STRATEGIES
from timeline.models import RecurringRule, Scenario, ScenarioGuidedDebtPriority, ScenarioGuidedStrategy

_ZERO = Decimal("0")
_HUNDRED = Decimal("100")

GUIDED_SOURCE_ACCOUNT_TYPES = frozenset(
    {
        Account.AccountType.CHECKING,
        Account.AccountType.SAVINGS,
        Account.AccountType.CASH,
    }
)
GUIDED_SAVINGS_ACCOUNT_TYPES = frozenset(
    {
        Account.AccountType.SAVINGS,
        Account.AccountType.CASH,
        Account.AccountType.CHECKING,
    }
)
GUIDED_SAVINGS_ACCOUNT_ROLES = frozenset(
    {
        Account.AccountRole.SAVINGS,
        Account.AccountRole.EMERGENCY_FUND,
        Account.AccountRole.CASH_RESERVE,
        Account.AccountRole.SPENDING,
        Account.AccountRole.BILLS,
    }
)


def account_is_eligible_guided_source(account: Account) -> bool:
    """Cash/asset account that can fund a Debt First vs. Save First plan."""
    if account.is_credit_card():
        return False
    if account.account_type not in GUIDED_SOURCE_ACCOUNT_TYPES:
        return False
    return account_supports_available_to_spend(account)


def account_is_eligible_guided_savings(account: Account) -> bool:
    """Savings/cash asset destination for selected transfer rules."""
    if account.is_credit_card():
        return False
    if account.account_type in GUIDED_SAVINGS_ACCOUNT_TYPES:
        return True
    return account.role in GUIDED_SAVINGS_ACCOUNT_ROLES and account_supports_available_to_spend(account)


def account_is_eligible_guided_debt(account: Account) -> bool:
    """Credit-card accounts the Payment Planner debt engine can model."""
    return account.is_credit_card()


def rule_is_eligible_savings_transfer(
    rule: RecurringRule,
    *,
    source_account: Account,
    savings_account: Account,
) -> bool:
    """True when the rule is a real transfer from source to savings."""
    if rule.account_id != source_account.pk:
        return False
    if rule.transfer_to_account_id is None:
        return False
    if rule.transfer_to_account_id != savings_account.pk:
        return False
    return True


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def serialize_guided_account(account: Account) -> dict[str, Any]:
    return {
        "id": account.pk,
        "name": account.name,
        "effective_display_name": account.effective_display_name,
        "account_type": account.account_type,
    }


def serialize_guided_rule(rule: RecurringRule) -> dict[str, Any]:
    return {
        "id": rule.pk,
        "name": rule.name,
        "account_id": rule.account_id,
        "transfer_to_account_id": rule.transfer_to_account_id,
    }


def serialize_guided_strategy(strategy: ScenarioGuidedStrategy) -> dict[str, Any]:
    debt_accounts = list(strategy.included_debt_accounts.all())
    transfer_rules = list(strategy.savings_transfer_rules.all())
    custom_order: list[dict[str, Any]] = []
    if strategy.payoff_strategy == ScenarioGuidedStrategy.PayoffStrategy.CUSTOM:
        for row in strategy.debt_priorities.select_related("account").order_by("priority", "id"):
            payload = serialize_guided_account(row.account)
            payload["priority"] = row.priority
            custom_order.append(payload)
    return {
        "id": strategy.pk,
        "scenario_id": strategy.scenario_id,
        "strategy_type": strategy.strategy_type,
        "source_account": serialize_guided_account(strategy.source_account),
        "savings_account": serialize_guided_account(strategy.savings_account),
        "included_debt_accounts": [serialize_guided_account(a) for a in debt_accounts],
        "savings_transfer_rules": [serialize_guided_rule(r) for r in transfer_rules],
        "start_date": strategy.start_date.isoformat(),
        "minimum_cash_buffer": _money(strategy.minimum_cash_buffer),
        "allocation_percent": _money(strategy.allocation_percent),
        "payoff_strategy": strategy.payoff_strategy,
        "custom_debt_order": custom_order,
        "resume_savings_after_payoff": strategy.resume_savings_after_payoff,
        "created_at": DateTimeField().to_representation(strategy.created_at),
        "updated_at": DateTimeField().to_representation(strategy.updated_at),
    }


def _ids(values: Iterable[Any]) -> list[int]:
    return [int(v.pk if hasattr(v, "pk") else v) for v in values]


def validate_guided_strategy_config(
    *,
    scenario: Scenario,
    strategy_type: str,
    source_account: Account,
    savings_account: Account,
    included_debt_accounts: list[Account],
    savings_transfer_rules: list[RecurringRule],
    start_date,
    minimum_cash_buffer: Decimal,
    allocation_percent: Decimal,
    payoff_strategy: str,
    custom_debt_order: list[Account],
) -> None:
    household_id = scenario.household_id
    errors: dict[str, Any] = {}

    if strategy_type not in ScenarioGuidedStrategy.StrategyType.values:
        errors["strategy_type"] = "Unsupported guided strategy type."

    if source_account.household_id != household_id:
        errors["source_account_id"] = "Source account must belong to the scenario household."
    elif not account_is_eligible_guided_source(source_account):
        errors["source_account_id"] = "Source account must be an eligible cash/asset account."

    if savings_account.household_id != household_id:
        errors["savings_account_id"] = "Savings account must belong to the scenario household."
    elif not account_is_eligible_guided_savings(savings_account):
        errors["savings_account_id"] = (
            "Savings account must be an eligible savings/cash asset account."
        )

    if (
        "source_account_id" not in errors
        and "savings_account_id" not in errors
        and source_account.pk == savings_account.pk
    ):
        errors["savings_account_id"] = "Source and savings accounts must be different."

    if not included_debt_accounts:
        errors["included_debt_account_ids"] = "Select at least one debt account."
    else:
        debt_errors: list[str] = []
        seen_debt: set[int] = set()
        for account in included_debt_accounts:
            if account.pk in seen_debt:
                continue
            seen_debt.add(account.pk)
            if account.household_id != household_id:
                debt_errors.append(
                    f"Account {account.pk} does not belong to the scenario household."
                )
            elif not account_is_eligible_guided_debt(account):
                debt_errors.append(
                    f"Account {account.pk} is not an eligible credit-card debt account."
                )
        if debt_errors:
            errors["included_debt_account_ids"] = debt_errors

    if not savings_transfer_rules:
        errors["savings_transfer_rule_ids"] = "Select at least one savings-transfer rule."
    else:
        rule_errors: list[str] = []
        seen_rules: set[int] = set()
        for rule in savings_transfer_rules:
            if rule.pk in seen_rules:
                continue
            seen_rules.add(rule.pk)
            if rule.household_id != household_id:
                rule_errors.append(
                    f"Rule {rule.pk} does not belong to the scenario household."
                )
            elif not rule_is_eligible_savings_transfer(
                rule, source_account=source_account, savings_account=savings_account
            ):
                rule_errors.append(
                    f"Rule {rule.pk} is not a transfer from the source account to the savings account."
                )
        if rule_errors:
            errors["savings_transfer_rule_ids"] = rule_errors

    if start_date is None:
        errors["start_date"] = "This field is required."

    if minimum_cash_buffer < _ZERO:
        errors["minimum_cash_buffer"] = "minimum_cash_buffer cannot be negative."

    if allocation_percent <= _ZERO or allocation_percent > _HUNDRED:
        errors["allocation_percent"] = "allocation_percent must be greater than 0 and no more than 100."

    if payoff_strategy not in DEBT_STRATEGIES:
        errors["payoff_strategy"] = (
            f"payoff_strategy must be one of: {', '.join(sorted(DEBT_STRATEGIES))}."
        )

    is_custom = payoff_strategy == ScenarioGuidedStrategy.PayoffStrategy.CUSTOM
    debt_ids = _ids(included_debt_accounts)
    order_ids = _ids(custom_debt_order)
    if is_custom:
        if sorted(order_ids) != sorted(set(debt_ids)) or len(order_ids) != len(set(order_ids)):
            errors["custom_debt_order_ids"] = (
                "custom payoff strategy requires each selected debt account exactly once."
            )
    elif order_ids:
        errors["custom_debt_order_ids"] = (
            "custom_debt_order_ids is only valid when payoff_strategy is custom."
        )

    if errors:
        raise serializers.ValidationError(errors)


def load_guided_strategy(scenario: Scenario) -> ScenarioGuidedStrategy | None:
    return (
        ScenarioGuidedStrategy.objects.filter(scenario=scenario)
        .select_related("source_account", "savings_account", "scenario")
        .prefetch_related(
            "included_debt_accounts",
            "savings_transfer_rules",
            "debt_priorities__account",
        )
        .first()
    )


@transaction.atomic
def replace_guided_strategy(
    scenario: Scenario,
    *,
    strategy_type: str,
    source_account: Account,
    savings_account: Account,
    included_debt_accounts: list[Account],
    savings_transfer_rules: list[RecurringRule],
    start_date,
    minimum_cash_buffer: Decimal,
    allocation_percent: Decimal,
    payoff_strategy: str,
    custom_debt_order: list[Account],
    resume_savings_after_payoff: bool,
) -> ScenarioGuidedStrategy:
    validate_guided_strategy_config(
        scenario=scenario,
        strategy_type=strategy_type,
        source_account=source_account,
        savings_account=savings_account,
        included_debt_accounts=included_debt_accounts,
        savings_transfer_rules=savings_transfer_rules,
        start_date=start_date,
        minimum_cash_buffer=minimum_cash_buffer,
        allocation_percent=allocation_percent,
        payoff_strategy=payoff_strategy,
        custom_debt_order=custom_debt_order,
    )
    strategy, _created = ScenarioGuidedStrategy.objects.update_or_create(
        scenario=scenario,
        defaults={
            "strategy_type": strategy_type,
            "source_account": source_account,
            "savings_account": savings_account,
            "start_date": start_date,
            "minimum_cash_buffer": minimum_cash_buffer,
            "allocation_percent": allocation_percent,
            "payoff_strategy": payoff_strategy,
            "resume_savings_after_payoff": resume_savings_after_payoff,
        },
    )
    strategy.included_debt_accounts.set(included_debt_accounts)
    strategy.savings_transfer_rules.set(savings_transfer_rules)
    strategy.debt_priorities.all().delete()
    if payoff_strategy == ScenarioGuidedStrategy.PayoffStrategy.CUSTOM:
        ScenarioGuidedDebtPriority.objects.bulk_create(
            [
                ScenarioGuidedDebtPriority(
                    guided_strategy=strategy,
                    account=account,
                    priority=index,
                )
                for index, account in enumerate(custom_debt_order, start=1)
            ]
        )
    return load_guided_strategy(scenario)


@transaction.atomic
def delete_guided_strategy(strategy: ScenarioGuidedStrategy) -> None:
    strategy.delete()


def copy_guided_strategy(source: Scenario, dest: Scenario) -> None:
    original = load_guided_strategy(source)
    if original is None:
        return
    copy = ScenarioGuidedStrategy.objects.create(
        scenario=dest,
        strategy_type=original.strategy_type,
        source_account=original.source_account,
        savings_account=original.savings_account,
        start_date=original.start_date,
        minimum_cash_buffer=original.minimum_cash_buffer,
        allocation_percent=original.allocation_percent,
        payoff_strategy=original.payoff_strategy,
        resume_savings_after_payoff=original.resume_savings_after_payoff,
    )
    copy.included_debt_accounts.set(original.included_debt_accounts.all())
    copy.savings_transfer_rules.set(original.savings_transfer_rules.all())
    ScenarioGuidedDebtPriority.objects.bulk_create(
        [
            ScenarioGuidedDebtPriority(
                guided_strategy=copy,
                account=row.account,
                priority=row.priority,
            )
            for row in original.debt_priorities.all()
        ]
    )
