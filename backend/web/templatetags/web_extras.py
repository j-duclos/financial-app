from django.template import Library

from web.utils import format_money, money_class

register = Library()


@register.filter
def money(value):
    return format_money(value)


@register.filter
def money_css(value):
    return money_class(value)
