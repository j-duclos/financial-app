from django.contrib import admin

from .models import PlaidItem, PlaidLinkedAccount


class PlaidLinkedAccountInline(admin.TabularInline):
    model = PlaidLinkedAccount
    extra = 0
    raw_id_fields = ("account",)


@admin.register(PlaidItem)
class PlaidItemAdmin(admin.ModelAdmin):
    list_display = ("id", "household", "item_id", "institution_name", "created_at")
    list_filter = ("household",)
    inlines = [PlaidLinkedAccountInline]
    raw_id_fields = ("household",)
