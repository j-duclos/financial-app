from django.urls import path

from .views import (
    BillOccurrenceActionView,
    BillOccurrenceDetailView,
    BillsOverviewView,
    MonthlyBillChecklistView,
)

urlpatterns = [
    path("checklist/", MonthlyBillChecklistView.as_view(), name="bill-checklist"),
    path("overview/", BillsOverviewView.as_view(), name="bills-overview"),
    path("occurrences/<int:pk>/detail/", BillOccurrenceDetailView.as_view(), name="bill-occurrence-detail"),
    path(
        "occurrences/<int:pk>/mark-paid/",
        BillOccurrenceActionView.as_view(),
        {"action": "mark-paid"},
        name="bill-mark-paid",
    ),
    path(
        "occurrences/<int:pk>/mark-missed/",
        BillOccurrenceActionView.as_view(),
        {"action": "mark-missed"},
        name="bill-mark-missed",
    ),
    path(
        "occurrences/<int:pk>/skip/",
        BillOccurrenceActionView.as_view(),
        {"action": "skip"},
        name="bill-skip",
    ),
    path(
        "occurrences/<int:pk>/link-transaction/",
        BillOccurrenceActionView.as_view(),
        {"action": "link-transaction"},
        name="bill-link-transaction",
    ),
    path(
        "occurrences/<int:pk>/snooze-warning/",
        BillOccurrenceActionView.as_view(),
        {"action": "snooze-warning"},
        name="bill-snooze-warning",
    ),
    path(
        "occurrences/<int:pk>/set-autopay/",
        BillOccurrenceActionView.as_view(),
        {"action": "set-autopay"},
        name="bill-set-autopay",
    ),
]
