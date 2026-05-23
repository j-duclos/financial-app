"""Shared seed data for default categories (flat for MVP, parent field ready)."""
from categories.models import Category


# (name, type, sort_order) - flat list per user spec
DEFAULT_CATEGORIES = [
    # INCOME
    ("Paycheck / Salary", "INCOME", 0),
    ("Bonus", "INCOME", 1),
    ("Commission", "INCOME", 2),
    ("Tips", "INCOME", 3),
    ("Side Hustle", "INCOME", 4),
    ("Business Income", "INCOME", 5),
    ("Interest Income", "INCOME", 6),
    ("Dividends", "INCOME", 7),
    ("Rental Income", "INCOME", 8),
    ("Refunds / Reimbursements", "INCOME", 9),
    ("Gifts", "INCOME", 10),
    ("Other Income", "INCOME", 11),
    # EXPENSE - Housing
    ("Rent / Mortgage", "EXPENSE", 100),
    ("Property Tax", "EXPENSE", 101),
    ("HOA", "EXPENSE", 102),
    ("Home Insurance", "EXPENSE", 103),
    ("Maintenance / Repairs", "EXPENSE", 104),
    # Utilities
    ("Electricity", "EXPENSE", 110),
    ("Water / Sewer", "EXPENSE", 111),
    ("Gas", "EXPENSE", 112),
    ("Trash", "EXPENSE", 113),
    ("Internet", "EXPENSE", 114),
    ("Mobile Phone", "EXPENSE", 115),
    # Transportation
    ("Gas / Fuel", "EXPENSE", 120),
    ("Car Payment", "EXPENSE", 121),
    ("Auto Insurance", "EXPENSE", 122),
    ("Maintenance", "EXPENSE", 123),
    ("Parking / Tolls", "EXPENSE", 124),
    # Food
    ("Groceries", "EXPENSE", 130),
    ("Dining Out", "EXPENSE", 131),
    ("Coffee / Snacks", "EXPENSE", 132),
    # Health
    ("Health Insurance", "EXPENSE", 140),
    ("Doctor / Dentist", "EXPENSE", 141),
    ("Pharmacy", "EXPENSE", 142),
    ("Gym / Fitness", "EXPENSE", 143),
    # Personal
    ("Clothing", "EXPENSE", 150),
    ("Hair / Beauty", "EXPENSE", 151),
    ("Personal Care", "EXPENSE", 152),
    # Family
    ("Childcare", "EXPENSE", 160),
    ("School / Activities", "EXPENSE", 161),
    # Debt / Transfers
    ("Transfer", "EXPENSE", 168),
    ("Bank Transfer", "EXPENSE", 169),
    ("Credit Card Payment", "EXPENSE", 170),
    ("Student Loan", "EXPENSE", 171),
    ("Personal Loan", "EXPENSE", 172),
    # Subscriptions
    ("Streaming", "EXPENSE", 180),
    ("Software / Apps", "EXPENSE", 181),
    ("Memberships", "EXPENSE", 182),
    # Savings & Investing
    ("Emergency Fund", "EXPENSE", 190),
    ("Retirement Contributions", "EXPENSE", 191),
    ("Brokerage Contributions", "EXPENSE", 192),
    # Entertainment
    ("Movies / Games", "EXPENSE", 200),
    ("Hobbies", "EXPENSE", 201),
    # Travel
    ("Flights", "EXPENSE", 210),
    ("Lodging", "EXPENSE", 211),
    ("Transportation (Travel)", "EXPENSE", 212),
    ("Food (Travel)", "EXPENSE", 213),
    # Giving
    ("Donations / Charity", "EXPENSE", 220),
    ("Gifts Given", "EXPENSE", 221),
    # Taxes
    ("Federal Tax", "EXPENSE", 230),
    ("State Tax", "EXPENSE", 231),
    ("Other Tax", "EXPENSE", 232),
    # Pets
    ("Pet Food", "EXPENSE", 240),
    ("Vet", "EXPENSE", 241),
    ("Supplies", "EXPENSE", 242),
    # Misc
    ("Bank Fees", "EXPENSE", 250),
    ("ATM / Cash Fees", "EXPENSE", 251),
    ("Interest", "EXPENSE", 252),
    ("Other Expenses", "EXPENSE", 253),
]


def seed_household_categories(household, *, is_system=False):
    for name, cat_type, sort_order in DEFAULT_CATEGORIES:
        obj, created = Category.objects.get_or_create(
            household=household,
            name=name,
            category_type=cat_type,
            parent=None,
            defaults={"is_system": is_system, "sort_order": sort_order},
        )
        if not created and obj.is_archived:
            obj.is_archived = False
            obj.is_system = is_system
            obj.sort_order = sort_order
            obj.save(update_fields=["is_archived", "is_system", "sort_order", "updated_at"])
