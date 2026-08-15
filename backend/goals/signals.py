from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from common.services.cache import invalidate_financial_cache_for_household
from goals.linked_account_sync import sync_linked_goal_contribution_for_transaction
from goals.models import GoalBucket, GoalContribution
from transactions.models import Transaction


@receiver(post_save, sender=Transaction)
def sync_goal_on_transaction_save(sender, instance: Transaction, **kwargs):
    sync_linked_goal_contribution_for_transaction(instance)


@receiver(post_delete, sender=Transaction)
def sync_goal_on_transaction_delete(sender, instance: Transaction, **kwargs):
    from goals.linked_account_sync import clear_goal_contribution_for_transaction

    clear_goal_contribution_for_transaction(instance)


@receiver(post_delete, sender=GoalContribution)
def sync_allocated_on_contribution_delete(sender, instance: GoalContribution, **kwargs):
    if not instance.bucket_id:
        return
    from goals.bucket_services import sync_bucket_allocated_amount

    bucket = GoalBucket.objects.filter(pk=instance.bucket_id).first()
    if bucket:
        sync_bucket_allocated_amount(bucket)


@receiver(post_save, sender=GoalBucket)
@receiver(post_delete, sender=GoalBucket)
def invalidate_financial_cache_on_goal_bucket_change(sender, instance: GoalBucket, **kwargs):
    invalidate_financial_cache_for_household(instance.household_id)
