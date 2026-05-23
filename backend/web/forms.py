"""Forms for the server-rendered web UI."""
from decimal import Decimal

from django import forms

from accounts.models import Account
from budgets.models import Budget
from categories.models import Category
from core.utils import get_households_for_user


class HouseholdScopedForm(forms.ModelForm):
    def __init__(self, user, *args, **kwargs):
        self.user = user
        super().__init__(*args, **kwargs)
        households = get_households_for_user(user)
        if "household" in self.fields:
            self.fields["household"].queryset = households


class AccountForm(HouseholdScopedForm):
    class Meta:
        model = Account
        fields = [
            "household",
            "name",
            "display_name",
            "account_type",
            "role",
            "starting_balance",
            "include_in_forecast",
            "institution",
            "last_four",
            "minimum_buffer",
        ]
        widgets = {
            "name": forms.TextInput(attrs={"class": "input"}),
            "display_name": forms.TextInput(attrs={"class": "input"}),
            "account_type": forms.Select(attrs={"class": "select"}),
            "role": forms.Select(attrs={"class": "select"}),
            "starting_balance": forms.NumberInput(attrs={"class": "input", "step": "0.01"}),
            "include_in_forecast": forms.CheckboxInput(attrs={"class": "checkbox"}),
            "institution": forms.TextInput(attrs={"class": "input"}),
            "last_four": forms.TextInput(attrs={"class": "input", "maxlength": "4"}),
            "minimum_buffer": forms.NumberInput(attrs={"class": "input", "step": "0.01"}),
            "household": forms.Select(attrs={"class": "select"}),
        }


class CategoryForm(HouseholdScopedForm):
    class Meta:
        model = Category
        fields = ["household", "name", "category_type", "parent", "sort_order"]
        widgets = {
            "household": forms.Select(attrs={"class": "select"}),
            "name": forms.TextInput(attrs={"class": "input"}),
            "category_type": forms.Select(attrs={"class": "select"}),
            "parent": forms.Select(attrs={"class": "select"}),
            "sort_order": forms.NumberInput(attrs={"class": "input"}),
        }

    def __init__(self, user, *args, **kwargs):
        super().__init__(user, *args, **kwargs)
        households = get_households_for_user(user)
        self.fields["parent"].queryset = Category.objects.filter(household__in=households, is_archived=False)
        self.fields["parent"].required = False


class TransactionForm(forms.Form):
    account = forms.ModelChoiceField(queryset=Account.objects.none(), widget=forms.Select(attrs={"class": "select"}))
    date = forms.DateField(widget=forms.DateInput(attrs={"class": "input", "type": "date"}))
    payee = forms.CharField(max_length=255, required=False, widget=forms.TextInput(attrs={"class": "input"}))
    amount = forms.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Positive = inflow, negative = outflow.",
        widget=forms.NumberInput(attrs={"class": "input", "step": "0.01"}),
    )
    category = forms.ModelChoiceField(
        queryset=Category.objects.none(),
        required=False,
        widget=forms.Select(attrs={"class": "select"}),
    )
    memo = forms.CharField(required=False, widget=forms.Textarea(attrs={"class": "input", "rows": 2}))
    cleared = forms.BooleanField(required=False, widget=forms.CheckboxInput(attrs={"class": "checkbox"}))

    def __init__(self, user, *args, **kwargs):
        self.user = user
        super().__init__(*args, **kwargs)
        from web.utils import user_accounts

        self.fields["account"].queryset = user_accounts(user)
        households = get_households_for_user(user)
        self.fields["category"].queryset = Category.objects.filter(household__in=households, is_archived=False)

    def clean_amount(self):
        val = Decimal(str(self.cleaned_data["amount"]))
        if val == 0:
            raise forms.ValidationError("Amount cannot be zero.")
        return val


class BudgetForm(HouseholdScopedForm):
    class Meta:
        model = Budget
        fields = ["household", "category", "year", "month", "planned_amount"]
        widgets = {
            "household": forms.Select(attrs={"class": "select"}),
            "category": forms.Select(attrs={"class": "select"}),
            "year": forms.NumberInput(attrs={"class": "input"}),
            "month": forms.NumberInput(attrs={"class": "input", "min": 1, "max": 12}),
            "planned_amount": forms.NumberInput(attrs={"class": "input", "step": "0.01"}),
        }

    def __init__(self, user, *args, **kwargs):
        super().__init__(user, *args, **kwargs)
        households = get_households_for_user(user)
        self.fields["category"].queryset = Category.objects.filter(
            household__in=households, is_archived=False, category_type=Category.CategoryType.EXPENSE
        )


class ReconcileAccountForm(forms.Form):
    account = forms.ModelChoiceField(queryset=Account.objects.none(), widget=forms.Select(attrs={"class": "select"}))

    def __init__(self, user, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from web.utils import user_accounts

        self.fields["account"].queryset = user_accounts(user)


class ReconcileBalanceForm(forms.Form):
    bank_current_balance = forms.DecimalField(
        max_digits=15,
        decimal_places=2,
        widget=forms.NumberInput(attrs={"class": "input", "step": "0.01"}),
    )


class TransactionFilterForm(forms.Form):
    account = forms.ModelChoiceField(
        queryset=Account.objects.none(),
        required=False,
        widget=forms.Select(attrs={"class": "select"}),
    )
    category = forms.ModelChoiceField(
        queryset=Category.objects.none(),
        required=False,
        widget=forms.Select(attrs={"class": "select"}),
    )
    date_after = forms.DateField(required=False, widget=forms.DateInput(attrs={"class": "input", "type": "date"}))
    date_before = forms.DateField(required=False, widget=forms.DateInput(attrs={"class": "input", "type": "date"}))
    timing = forms.ChoiceField(
        choices=[("", "All dates"), ("past", "Past only"), ("future", "Future only")],
        required=False,
        widget=forms.Select(attrs={"class": "select"}),
    )
    reconciled = forms.ChoiceField(
        choices=[("", "All"), ("yes", "Reconciled"), ("no", "Unreconciled")],
        required=False,
        widget=forms.Select(attrs={"class": "select"}),
    )

    def __init__(self, user, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from web.utils import user_accounts

        self.fields["account"].queryset = user_accounts(user)
        households = get_households_for_user(user)
        self.fields["category"].queryset = Category.objects.filter(household__in=households, is_archived=False)
