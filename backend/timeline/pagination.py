"""Allow larger page_size for rules list so all rules can load in one request."""
from rest_framework.pagination import PageNumberPagination


class RecurringRulePagination(PageNumberPagination):
    page_size = 200
    page_size_query_param = "page_size"
    max_page_size = 500
