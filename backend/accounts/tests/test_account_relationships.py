"""Account relationship model, API, scheduling, and Plaid matching."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from accounts.models import Account
from accounts.relationship_models import AccountRelationship
from accounts.services.autopay import sync_autopay_for_account
from accounts.services.relationships import (
    create_relationship,
    deactivate_relationship,
    generate_scheduled_transfers_for_relationship,
    sync_credit_card_payment_relationship,
    sync_relationship_forecast_transactions,
    update_relationship,
)
from transactions.models import Transaction, TransferGroup
from transactions.services.matching import score_candidate, score_manual_cross_account
from transactions.services.posting import create_transfer, post_transaction


@pytest.fixture
def checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase Checking",
        starting_balance=Decimal("5000"),
    )


@pytest.fixture
def savings(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Emergency Savings",
    )


@pytest.fixture
def credit_card(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Capital One Savor",
        credit_limit=Decimal("5000"),
        payment_due_day=15,
        next_payment_due_date=date.today() + timedelta(days=20),
        current_balance=Decimal("500"),
        minimum_payment_amount=Decimal("25"),
    )


@pytest.fixture
def other_household_checking(db):
    from core.models import Household

    hh = Household.objects.create(name="Other")
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        name="Other Checking",
    )


@pytest.mark.django_db
class TestAccountRelationshipModel:
    def test_create_valid_relationship(self, checking, savings):
        rel = create_relationship(
            household_id=checking.household_id,
            source_account_id=checking.pk,
            destination_account_id=savings.pk,
            relationship_type=AccountRelationship.RelationshipType.SAVINGS_FUNDING,
            default_amount=Decimal("200"),
            default_day=1,
            frequency=AccountRelationship.Frequency.MONTHLY,
        )
        assert rel.pk
        assert rel.source_account_id == checking.pk
        assert rel.is_active

    def test_cannot_relate_account_to_itself(self, checking):
        with pytest.raises(Exception):
            create_relationship(
                household_id=checking.household_id,
                source_account_id=checking.pk,
                destination_account_id=checking.pk,
                relationship_type=AccountRelationship.RelationshipType.TRANSFER,
            )

    def test_cannot_relate_different_households(self, checking, other_household_checking):
        with pytest.raises(Exception):
            create_relationship(
                household_id=checking.household_id,
                source_account_id=checking.pk,
                destination_account_id=other_household_checking.pk,
                relationship_type=AccountRelationship.RelationshipType.TRANSFER,
            )

    def test_credit_card_payment_validation(self, checking, savings):
        with pytest.raises(Exception):
            create_relationship(
                household_id=checking.household_id,
                source_account_id=checking.pk,
                destination_account_id=savings.pk,
                relationship_type=AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
            )


@pytest.mark.django_db
class TestRelationshipScheduling:
    def test_scheduled_transfers_generated(self, user, checking, savings):
        rel = create_relationship(
            household_id=checking.household_id,
            source_account_id=checking.pk,
            destination_account_id=savings.pk,
            relationship_type=AccountRelationship.RelationshipType.SAVINGS_FUNDING,
            default_amount=Decimal("100"),
            default_day=(timezone.localdate() + timedelta(days=10)).day,
            frequency=AccountRelationship.Frequency.MONTHLY,
            user=user,
        )
        groups = TransferGroup.objects.filter(relationship=rel)
        assert groups.count() >= 1
        assert groups.first().relationship_id == rel.pk

    def test_duplicate_scheduled_transfers_not_generated(self, user, checking, savings):
        rel = create_relationship(
            household_id=checking.household_id,
            source_account_id=checking.pk,
            destination_account_id=savings.pk,
            relationship_type=AccountRelationship.RelationshipType.SAVINGS_FUNDING,
            default_amount=Decimal("100"),
            default_day=(timezone.localdate() + timedelta(days=12)).day,
            frequency=AccountRelationship.Frequency.MONTHLY,
            user=user,
        )
        start = timezone.localdate() + timedelta(days=1)
        end = start + timedelta(days=90)
        count_before = TransferGroup.objects.filter(relationship=rel).count()
        assert count_before >= 1
        second = generate_scheduled_transfers_for_relationship(rel, start, end, user=user)
        assert len(second) == 0
        assert TransferGroup.objects.filter(relationship=rel).count() == count_before

    def test_update_relationship_updates_future_planned(self, user, checking, savings):
        rel = create_relationship(
            household_id=checking.household_id,
            source_account_id=checking.pk,
            destination_account_id=savings.pk,
            relationship_type=AccountRelationship.RelationshipType.SAVINGS_FUNDING,
            default_amount=Decimal("50"),
            default_day=(timezone.localdate() + timedelta(days=14)).day,
            frequency=AccountRelationship.Frequency.MONTHLY,
        )
        sync_relationship_forecast_transactions(rel, user=user)
        update_relationship(rel, user=user, default_amount=Decimal("75"))
        sync_relationship_forecast_transactions(rel, user=user)
        amounts = list(
            TransferGroup.objects.filter(relationship=rel).values_list("amount", flat=True)
        )
        assert amounts
        assert all(a == Decimal("75") for a in amounts)

    def test_deactivating_stops_future_generation(self, user, checking, savings):
        rel = create_relationship(
            household_id=checking.household_id,
            source_account_id=checking.pk,
            destination_account_id=savings.pk,
            relationship_type=AccountRelationship.RelationshipType.SAVINGS_FUNDING,
            default_amount=Decimal("80"),
            default_day=(timezone.localdate() + timedelta(days=18)).day,
            frequency=AccountRelationship.Frequency.MONTHLY,
        )
        sync_relationship_forecast_transactions(rel, user=user)
        deactivate_relationship(rel)
        before = TransferGroup.objects.filter(relationship=rel).count()
        sync_relationship_forecast_transactions(rel, user=user)
        assert TransferGroup.objects.filter(relationship=rel, status=TransferGroup.Status.PLANNED).count() <= before


@pytest.mark.django_db
class TestRelationshipAPI:
    def test_list_and_create(self, authenticated_client, household, checking, savings):
        r = authenticated_client.post(
            "/api/accounts/relationships/",
            {
                "source_account": checking.id,
                "destination_account": savings.id,
                "relationship_type": "savings_funding",
                "default_amount": "150.00",
                "default_day": 5,
                "frequency": "monthly",
            },
            format="json",
        )
        assert r.status_code == 201, r.content
        r2 = authenticated_client.get("/api/accounts/relationships/")
        assert r2.status_code == 200
        assert len(r2.json()) >= 1

    def test_account_detail_includes_relationships(
        self, authenticated_client, checking, savings,
    ):
        create_relationship(
            household_id=checking.household_id,
            source_account_id=checking.pk,
            destination_account_id=savings.pk,
            relationship_type=AccountRelationship.RelationshipType.SAVINGS_FUNDING,
            default_amount=Decimal("25"),
            default_day=1,
        )
        r = authenticated_client.get(f"/api/accounts/{checking.id}/")
        assert r.status_code == 200
        data = r.json()
        assert len(data.get("outgoing_relationships", [])) >= 1
        assert data["outgoing_relationships"][0]["destination_account_name"] == savings.name


@pytest.mark.django_db
class TestAutopayRelationshipSync:
    def test_credit_card_autopay_creates_relationship(self, credit_card, checking, user):
        credit_card.autopay_enabled = True
        credit_card.autopay_account = checking
        credit_card.autopay_type = Account.AutopayType.MINIMUM_PAYMENT
        credit_card.save()
        rel = sync_credit_card_payment_relationship(credit_card)
        assert rel is not None
        assert rel.relationship_type == AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT
        assert rel.source_account_id == checking.pk

    def test_sync_autopay_links_transfer_group(self, credit_card, checking, user):
        credit_card.autopay_enabled = True
        credit_card.autopay_account = checking
        credit_card.autopay_type = Account.AutopayType.FIXED_AMOUNT
        credit_card.autopay_fixed_amount = Decimal("100")
        credit_card.save()
        tg = sync_autopay_for_account(credit_card, user=user)
        assert tg is not None
        assert tg.relationship_id is not None


@pytest.mark.django_db
class TestPlaidMatchingBoost:
    def test_score_boost_from_active_relationship(self, user, checking, credit_card):
        rel = create_relationship(
            household_id=checking.household_id,
            source_account_id=checking.pk,
            destination_account_id=credit_card.pk,
            relationship_type=AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
        )
        pay_date = timezone.localdate() + timedelta(days=5)
        xfer = create_transfer(
            user,
            from_account_id=checking.pk,
            to_account_id=credit_card.pk,
            amount=Decimal("100"),
            transfer_date=pay_date,
            relationship_id=rel.pk,
        )
        planned = xfer.from_transaction
        imported = Transaction.objects.create(
            account=checking,
            date=pay_date,
            payee="ACH PAYMENT",
            amount=Decimal("-100"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid_test_1",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        score, parts = score_candidate(imported, planned)
        assert score >= 85
        assert parts.get("relationship_single") == 20 or parts.get("relationship_both_legs") == 30

    def test_cross_account_manual_boost(self, checking, credit_card):
        create_relationship(
            household_id=checking.household_id,
            source_account_id=checking.pk,
            destination_account_id=credit_card.pk,
            relationship_type=AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
        )
        d = timezone.localdate()
        imported = Transaction.objects.create(
            account=checking,
            date=d,
            payee="Payment",
            amount=Decimal("-50"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid_x",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        planned = Transaction.objects.create(
            account=credit_card,
            date=d,
            payee="Payment",
            amount=Decimal("50"),
            source=Transaction.Source.ONE_TIME,
        )
        assert score_manual_cross_account(imported, planned) >= 65
