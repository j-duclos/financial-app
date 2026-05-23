from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from accounts.models import Account
from accounts.services.autopay import sync_autopay_for_account
from accounts.services.credit_card import (
    apply_transaction_to_credit_card_balance,
    initialize_credit_card_from_starting_balance,
    refresh_statement_schedule,
)
from transactions.models import Transaction


@receiver(post_save, sender=Account)
def account_post_save(sender, instance, created, **kwargs):
    if kwargs.get("raw"):
        return
    if not instance.is_credit_card():
        return
    if created:
        initialize_credit_card_from_starting_balance(instance)
    else:
        closing = instance.get_statement_closing_day()
        if closing is not None and instance.billing_cycle_end_day != closing:
            Account.objects.filter(pk=instance.pk).update(
                billing_cycle_end_day=closing
            )
        refresh_statement_schedule(instance)
    uf = kwargs.get("update_fields")
    if uf is not None and set(uf) <= {"current_balance", "updated_at"}:
        return
    sync_autopay_for_account(instance)


@receiver(post_save, sender=Transaction)
def transaction_post_save(sender, instance, created, **kwargs):
    if created:
        apply_transaction_to_credit_card_balance(instance)


@receiver(post_delete, sender=Transaction)
def transaction_post_delete(sender, instance, **kwargs):
    apply_transaction_to_credit_card_balance(instance, reverse=True)
