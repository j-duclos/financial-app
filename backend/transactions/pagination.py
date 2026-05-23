"""Allow large page_size for transaction lists (ledger view)."""
from rest_framework.pagination import PageNumberPagination


class TransactionPagination(PageNumberPagination):
    page_size = 500
    page_size_query_param = "page_size"
    max_page_size = 10000
