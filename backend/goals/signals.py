from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from goals.linked_account_sync import sync_linked_goal_contribution_for_transaction
from transactions.models import Transaction


@receiver(post_save, sender=Transaction)
def sync_goal_on_transaction_save(sender, instance: Transaction, **kwargs):
    sync_linked_goal_contribution_for_transaction(instance)


@receiver(post_delete, sender=Transaction)
def sync_goal_on_transaction_delete(sender, instance: Transaction, **kwargs):
    from goals.linked_account_sync import clear_goal_contribution_for_transaction

    clear_goal_contribution_for_transaction(instance)
