from django.urls import path

from . import views

app_name = "web"

urlpatterns = [
    path("login/", views.WebLoginView.as_view(), name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("", views.dashboard, name="dashboard"),
    path("accounts/", views.accounts_list, name="accounts"),
    path("accounts/<int:pk>/", views.account_detail, name="account_detail"),
    path("categories/", views.categories_list, name="categories"),
    path("transactions/", views.transactions_list, name="transactions"),
    path("transactions/<int:pk>/edit/", views.transaction_edit, name="transaction_edit"),
    path("timeline/", views.timeline_view, name="timeline"),
    path("budgets/", views.budgets_list, name="budgets"),
    path("insights/", views.insights_view, name="insights"),
    path("reconcile/", views.reconcile_view, name="reconcile"),
    path("plaid/", views.plaid_page, name="plaid"),
    path("plaid/oauth-return/", views.plaid_oauth_return, name="plaid_oauth_return"),
    path("plaid/link-token/", views.plaid_link_token, name="plaid_link_token"),
    path("plaid/exchange/", views.plaid_exchange, name="plaid_exchange"),
    path("plaid/items/<int:pk>/sync/", views.plaid_sync, name="plaid_sync"),
    path("plaid/items/<int:pk>/disconnect/", views.plaid_disconnect, name="plaid_disconnect"),
]
