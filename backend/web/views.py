"""Server-rendered web UI views — reuse existing services, do not duplicate API logic."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.contrib import messages
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST
from plaid import ApiException

from accounts.models import Account
from accounts.services.account_health import calculate_account_health, serialize_account_health
from accounts.services.available_to_spend import (
    DEFAULT_FORECAST_DAYS,
    calculate_account_forecast_summary,
    serialize_forecast_summary,
)
from budgets.models import Budget
from categories.models import Category
from core.utils import get_households_for_user, get_user_profile
from insights.views import AccountBalancesView, CategoryBreakdownView, MonthlySummaryView
from plaid_link.models import PlaidItem
from plaid_link.plaid_api_client import plaid_api_env, plaid_configured
from plaid_link.plaid_errors import format_plaid_api_exception
from plaid_link.services import (
    create_link_token,
    exchange_public_token,
    remove_plaid_item_from_plaid,
    resolve_plaid_link_redirect_uri,
    sync_transactions_for_item,
)
from timeline.services.ledger import build_timeline
from transactions.models import Transaction
from transactions.services import delete_transaction_respecting_partner_ledger, post_transaction
from transactions.services.reconciliation import (
    BALANCE_TOLERANCE,
    complete_reconciliation,
    get_setup_data,
    sum_checked_amounts,
)

from .forms import (
    AccountForm,
    BudgetForm,
    CategoryForm,
    ReconcileAccountForm,
    ReconcileBalanceForm,
    TransactionFilterForm,
    TransactionForm,
)
from .utils import (
    account_current_balance,
    budget_spent_for_category,
    dashboard_summary,
    format_money,
    get_default_household,
    insights_warnings,
    money_class,
    user_accounts,
)


class WebLoginView(LoginView):
    template_name = "login.html"
    redirect_authenticated_user = True


def logout_view(request):
    logout(request)
    return redirect("web:login")


@login_required
def dashboard(request):
    summary = dashboard_summary(request.user)
    return render(
        request,
        "dashboard.html",
        {
            "summary": summary,
            "api_status": {
                "status": "ok",
                "service": "financial-app-api",
                "docs": "/api/docs/",
                "admin": "/admin/",
                "health": "/health/",
            },
        },
    )


@login_required
def accounts_list(request):
    accounts = list(user_accounts(request.user))
    today = timezone.localdate()
    health_by_id = {}
    forecast_by_id = {}
    if accounts:
        from accounts.services.account_health import calculate_account_health_for_accounts
        from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts

        health_by_id = calculate_account_health_for_accounts(request.user, accounts, days=30)
        forecast_by_id = calculate_forecast_summaries_for_accounts(request.user, accounts, days=30)

    rows = []
    for acc in accounts:
        bal = account_current_balance(acc, today)
        fs = forecast_by_id.get(acc.id) or {}
        health = health_by_id.get(acc.id) or {}
        rows.append({
            "account": acc,
            "balance": bal,
            "available": fs.get("available_to_spend"),
            "health_status": health.get("status"),
            "health_reason": health.get("reason"),
        })

    form = AccountForm(request.user)
    if request.method == "POST" and request.POST.get("action") == "create":
        form = AccountForm(request.user, request.POST)
        if form.is_valid():
            acc = form.save()
            messages.success(request, f"Created account “{acc.effective_display_name}”.")
            return redirect("web:account_detail", pk=acc.pk)

    return render(request, "accounts.html", {"rows": rows, "form": form})


@login_required
def account_detail(request, pk):
    acc = get_object_or_404(user_accounts(request.user), pk=pk)
    today = timezone.localdate()
    balance = account_current_balance(acc, today)
    forecast = calculate_account_forecast_summary(request.user, acc, days=DEFAULT_FORECAST_DAYS)
    health = calculate_account_health(request.user, acc, days=DEFAULT_FORECAST_DAYS)
    end = today + timedelta(days=DEFAULT_FORECAST_DAYS)
    upcoming = build_timeline(
        request.user,
        start_date=today + timedelta(days=1),
        end_date=end,
        account_id=acc.pk,
    )[:30]

    unreconciled = Transaction.objects.filter(account=acc, reconciled=False, date__lte=today).count()

    form = AccountForm(request.user, instance=acc)
    if request.method == "POST":
        form = AccountForm(request.user, request.POST, instance=acc)
        if form.is_valid():
            form.save()
            messages.success(request, "Account updated.")
            return redirect("web:account_detail", pk=acc.pk)

    return render(
        request,
        "account_detail.html",
        {
            "account": acc,
            "balance": balance,
            "forecast": serialize_forecast_summary(forecast),
            "health": serialize_account_health(health),
            "upcoming": upcoming,
            "unreconciled_count": unreconciled,
            "form": form,
        },
    )


@login_required
def categories_list(request):
    households = get_households_for_user(request.user)
    categories = Category.objects.filter(household__in=households, is_archived=False).select_related(
        "household", "parent"
    )
    edit_id = request.GET.get("edit")
    instance = Category.objects.filter(pk=edit_id, household__in=households).first() if edit_id else None
    form = CategoryForm(request.user, instance=instance)

    if request.method == "POST":
        edit_pk = request.POST.get("edit_id")
        if edit_pk:
            instance = get_object_or_404(Category, pk=edit_pk, household__in=households)
        form = CategoryForm(request.user, request.POST, instance=instance)
        if form.is_valid():
            cat = form.save()
            messages.success(request, f"Saved category “{cat.name}”.")
            return redirect("web:categories")

    return render(request, "categories.html", {"categories": categories, "form": form, "edit_id": edit_id})


@login_required
def transactions_list(request):
    households = get_households_for_user(request.user)
    filter_form = TransactionFilterForm(request.user, request.GET or None)
    qs = Transaction.objects.filter(account__household__in=households).select_related(
        "account", "category"
    ).order_by("-date", "-id")

    if filter_form.is_valid():
        if filter_form.cleaned_data.get("account"):
            qs = qs.filter(account=filter_form.cleaned_data["account"])
        if filter_form.cleaned_data.get("category"):
            qs = qs.filter(category=filter_form.cleaned_data["category"])
        if filter_form.cleaned_data.get("date_after"):
            qs = qs.filter(date__gte=filter_form.cleaned_data["date_after"])
        if filter_form.cleaned_data.get("date_before"):
            qs = qs.filter(date__lte=filter_form.cleaned_data["date_before"])
        timing = filter_form.cleaned_data.get("timing")
        today = timezone.localdate()
        if timing == "past":
            qs = qs.filter(date__lte=today)
        elif timing == "future":
            qs = qs.filter(date__gt=today)
        rec = filter_form.cleaned_data.get("reconciled")
        if rec == "yes":
            qs = qs.filter(reconciled=True)
        elif rec == "no":
            qs = qs.filter(reconciled=False)

    transactions = qs[:200]
    form = TransactionForm(request.user)
    if request.method == "POST" and request.POST.get("action") == "create":
        form = TransactionForm(request.user, request.POST)
        if form.is_valid():
            try:
                post_transaction(
                    user=request.user,
                    account_id=form.cleaned_data["account"].pk,
                    date=form.cleaned_data["date"],
                    payee=form.cleaned_data.get("payee") or "",
                    amount=form.cleaned_data["amount"],
                    category_id=form.cleaned_data["category"].pk if form.cleaned_data.get("category") else None,
                    memo=form.cleaned_data.get("memo") or "",
                    cleared=form.cleaned_data.get("cleared") or False,
                )
                messages.success(request, "Transaction created.")
                return redirect("web:transactions")
            except ValueError as exc:
                messages.error(request, str(exc))

    return render(
        request,
        "transactions.html",
        {"transactions": transactions, "filter_form": filter_form, "form": form},
    )


@login_required
def transaction_edit(request, pk):
    txn = get_object_or_404(
        Transaction.objects.filter(account__household__in=get_households_for_user(request.user)),
        pk=pk,
    )
    categories = Category.objects.filter(
        household=txn.account.household, is_archived=False
    ).order_by("name")
    if request.method == "POST":
        if request.POST.get("action") == "delete":
            delete_transaction_respecting_partner_ledger(txn)
            messages.success(request, "Transaction deleted.")
            return redirect("web:transactions")
        txn.payee = request.POST.get("payee", txn.payee)
        txn.memo = request.POST.get("memo", txn.memo)
        txn.cleared = request.POST.get("cleared") == "on"
        try:
            txn.amount = Decimal(request.POST.get("amount", txn.amount))
            txn.date = date.fromisoformat(request.POST.get("date", txn.date.isoformat()))
        except (InvalidOperation, ValueError):
            messages.error(request, "Invalid amount or date.")
            return redirect("web:transaction_edit", pk=pk)
        cat_id = request.POST.get("category")
        txn.category_id = int(cat_id) if cat_id else None
        txn.save()
        messages.success(request, "Transaction updated.")
        return redirect("web:transactions")

    return render(request, "transaction_edit.html", {"transaction": txn, "categories": categories})


@login_required
def timeline_view(request):
    today = timezone.localdate()
    start = today - timedelta(days=60)
    end = today + timedelta(days=90)
    account_id = request.GET.get("account")
    rows = build_timeline(
        request.user,
        start_date=start,
        end_date=end,
        account_id=int(account_id) if account_id else None,
    )
    lowest = None
    lowest_row = None
    for r in rows:
        bal = Decimal(str(r["running_balance"]))
        if lowest is None or bal < lowest:
            lowest = bal
            lowest_row = r

    past = [r for r in rows if r["date"] <= today]
    future = [r for r in rows if r["date"] > today]

    return render(
        request,
        "timeline.html",
        {
            "past_rows": past,
            "future_rows": future,
            "today": today,
            "lowest_balance": lowest,
            "lowest_row": lowest_row,
            "accounts": user_accounts(request.user),
            "selected_account": account_id,
        },
    )


@login_required
def budgets_list(request):
    households = get_households_for_user(request.user)
    today = timezone.localdate()
    year = int(request.GET.get("year", today.year))
    month = int(request.GET.get("month", today.month))
    budgets = Budget.objects.filter(household__in=households, year=year, month=month).select_related(
        "category", "household"
    )

    rows = []
    for b in budgets:
        spent = budget_spent_for_category(b.household_id, b.category_id, b.year, b.month)
        remaining = Decimal(str(b.planned_amount)) - spent
        forecast_eom = remaining  # simplified: remaining at current spend rate
        rows.append({
            "budget": b,
            "spent": spent,
            "remaining": remaining,
            "forecast_eom": forecast_eom,
        })

    edit_id = request.GET.get("edit")
    instance = Budget.objects.filter(pk=edit_id, household__in=households).first() if edit_id else None
    form = BudgetForm(request.user, instance=instance)
    if not instance:
        form.initial.setdefault("year", year)
        form.initial.setdefault("month", month)

    if request.method == "POST":
        edit_pk = request.POST.get("edit_id")
        if edit_pk:
            instance = get_object_or_404(Budget, pk=edit_pk, household__in=households)
        form = BudgetForm(request.user, request.POST, instance=instance)
        if form.is_valid():
            form.save()
            messages.success(request, "Budget saved.")
            return redirect(f"{reverse('web:budgets')}?year={year}&month={month}")

    return render(
        request,
        "budgets.html",
        {"rows": rows, "form": form, "year": year, "month": month, "edit_id": edit_id},
    )


@login_required
def insights_view(request):
    today = timezone.localdate()
    month = request.GET.get("month") or today.strftime("%Y-%m")
    api_req = type("Req", (), {"user": request.user, "query_params": {"month": month}})()
    monthly = MonthlySummaryView().get(api_req).data
    breakdown = CategoryBreakdownView().get(api_req).data
    balances = AccountBalancesView().get(api_req).data
    warnings = insights_warnings(request.user)
    return render(
        request,
        "insights.html",
        {
            "month": month,
            "monthly": monthly,
            "breakdown": breakdown.get("breakdown", []),
            "balances": balances.get("balances", []),
            "warnings": warnings,
        },
    )


@login_required
def reconcile_view(request):
    step = int(request.GET.get("step", "1"))
    account = None
    setup = None
    bank_balance = None
    checked_ids: list[int] = []

    account_form = ReconcileAccountForm(request.user)
    balance_form = ReconcileBalanceForm()

    if request.method == "POST":
        action = request.POST.get("action")
        if action == "choose_account":
            account_form = ReconcileAccountForm(request.user, request.POST)
            if account_form.is_valid():
                acc = account_form.cleaned_data["account"]
                return redirect(f"{reverse('web:reconcile')}?step=2&account_id={acc.pk}")
        elif action == "enter_balance":
            account_id = request.POST.get("account_id")
            account = get_object_or_404(user_accounts(request.user), pk=account_id)
            balance_form = ReconcileBalanceForm(request.POST)
            if balance_form.is_valid():
                bal = balance_form.cleaned_data["bank_current_balance"]
                return redirect(f"{reverse('web:reconcile')}?step=3&account_id={account.pk}&bank_balance={bal}")
        elif action == "complete":
            account_id = request.POST.get("account_id")
            account = get_object_or_404(user_accounts(request.user), pk=account_id)
            try:
                bank_balance = Decimal(request.POST.get("bank_current_balance", "0"))
                checked_ids = [int(x) for x in request.POST.getlist("checked")]
                setup = get_setup_data(account)
                complete_reconciliation(
                    account=account,
                    user=request.user,
                    bank_current_balance=bank_balance,
                    checked_transaction_ids=checked_ids,
                    period_start=setup["period_start_date"],
                    period_end=setup["period_end_date"],
                )
                messages.success(request, "Reconciliation completed successfully.")
                return redirect("web:reconcile")
            except ValueError as exc:
                messages.error(request, str(exc))
                setup = get_setup_data(account)
                step = 4

    account_id = request.GET.get("account_id")
    if account_id:
        account = get_object_or_404(user_accounts(request.user), pk=account_id)

    bank_raw = request.GET.get("bank_balance")
    if bank_raw:
        try:
            bank_balance = Decimal(bank_raw)
        except InvalidOperation:
            bank_balance = None

    if account and step >= 3:
        try:
            setup = get_setup_data(account)
        except ValueError as exc:
            messages.error(request, str(exc))
            setup = None

    if step >= 4 and setup and bank_balance is not None:
        checked_ids = [int(x) for x in request.GET.getlist("checked")] if request.method != "POST" else checked_ids
        opening = setup["period_opening_balance"]
        checked_qs = Transaction.objects.filter(pk__in=checked_ids, account=account)
        calc_balance = opening + sum_checked_amounts(checked_qs)
        diff = bank_balance - calc_balance
    else:
        calc_balance = diff = None

    reconcile_txns = []
    if setup:
        running = setup.get("running_balances") or {}
        for txn in setup.get("unreconciled_transactions") or []:
            rb = running.get(txn.pk)
            reconcile_txns.append({"txn": txn, "running": rb})

    return render(
        request,
        "reconcile.html",
        {
            "step": step,
            "account": account,
            "account_form": account_form,
            "balance_form": balance_form,
            "setup": setup,
            "reconcile_txns": reconcile_txns,
            "bank_balance": bank_balance,
            "calc_balance": calc_balance,
            "difference": diff,
            "tolerance": BALANCE_TOLERANCE,
            "checked_ids": checked_ids,
        },
    )


@login_required
def plaid_page(request):
    household = get_default_household(request.user)
    items = []
    if household:
        items = PlaidItem.objects.filter(household=household).prefetch_related(
            "linked_accounts__account"
        )
    redirect_uri = _plaid_redirect_uri(request)
    return render(
        request,
        "plaid.html",
        {
            "household": household,
            "items": items,
            "plaid_configured": plaid_configured(),
            "plaid_env": plaid_api_env(),
            "redirect_uri": redirect_uri,
        },
    )


@login_required
def plaid_oauth_return(request):
    household = get_default_household(request.user)
    redirect_uri = _plaid_redirect_uri(request)
    return render(
        request,
        "plaid_oauth_return.html",
        {
            "household": household,
            "redirect_uri": redirect_uri,
            "plaid_configured": plaid_configured(),
        },
    )


@login_required
@require_POST
def plaid_link_token(request):
    household = get_default_household(request.user)
    if not household:
        return JsonResponse({"detail": "Set a default household in admin/profile first."}, status=400)
    if not plaid_configured():
        return JsonResponse({"detail": "Plaid is not configured.", "plaid_env": plaid_api_env()}, status=503)
    profile = get_user_profile(request.user)
    phone = (getattr(profile, "phone_e164", None) or "").strip() or None
    email = (request.user.email or "").strip() or None
    rid = (request.POST.get("redirect_uri") or "").strip() or None
    try:
        token = create_link_token(
            client_user_id=f"user-{request.user.pk}-hh-{household.pk}",
            phone_number=phone,
            email_address=email,
            link_redirect_uri=rid,
        )
    except ApiException as e:
        attempted = resolve_plaid_link_redirect_uri(rid)
        payload = format_plaid_api_exception(e, plaid_env=plaid_api_env(), redirect_uri_attempted=attempted)
        return JsonResponse(payload, status=400)
    except RuntimeError as e:
        return JsonResponse({"detail": str(e)}, status=503)
    return JsonResponse({"link_token": token, "household_id": household.pk})


@login_required
@require_POST
def plaid_exchange(request):
    household = get_default_household(request.user)
    public_token = request.POST.get("public_token", "").strip()
    if not household or not public_token:
        return JsonResponse({"detail": "public_token and household required."}, status=400)
    if not plaid_configured():
        return JsonResponse({"detail": "Plaid is not configured."}, status=503)
    try:
        item = exchange_public_token(public_token=public_token, household_id=household.pk)
    except ApiException as e:
        return JsonResponse(format_plaid_api_exception(e, plaid_env=plaid_api_env()), status=400)
    except RuntimeError as e:
        return JsonResponse({"detail": str(e)}, status=503)
    return JsonResponse({"id": item.pk, "institution_name": item.institution_name})


@login_required
@require_POST
def plaid_sync(request, pk):
    item = get_object_or_404(
        PlaidItem.objects.filter(household__in=get_households_for_user(request.user)),
        pk=pk,
    )
    try:
        counts = sync_transactions_for_item(item)
    except ApiException as e:
        payload = format_plaid_api_exception(e, plaid_env=plaid_api_env())
        messages.error(request, payload.get("detail") or str(payload))
        return redirect("web:plaid")
    parts = [f"{k}: {v}" for k, v in counts.items() if v]
    messages.success(request, f"Import complete. {', '.join(parts) if parts else 'No changes.'}")
    return redirect("web:plaid")


@login_required
@require_POST
def plaid_disconnect(request, pk):
    item = get_object_or_404(
        PlaidItem.objects.filter(household__in=get_households_for_user(request.user)),
        pk=pk,
    )
    remove_plaid_item_from_plaid(item)
    item.delete()
    messages.success(request, "Bank disconnected.")
    return redirect("web:plaid")


def _plaid_redirect_uri(request) -> str:
    configured = resolve_plaid_link_redirect_uri(None)
    if configured:
        return configured
    return request.build_absolute_uri(reverse("web:plaid_oauth_return")).rstrip("/")
