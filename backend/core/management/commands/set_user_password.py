"""
Set a new password for an existing user (e.g. regain access after lockout).

Run from backend directory:
  python manage.py set_user_password cazcapone 'your_new_password'

With Docker:
  docker compose exec backend python manage.py set_user_password cazcapone 'your_new_password'

Uses the same database as the running app (SQLite when running locally without
DATABASE_URL, Postgres when using Docker).
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Set a new password for an existing user by username."

    def add_arguments(self, parser):
        parser.add_argument("username", type=str, help="Username (e.g. cazcapone)")
        parser.add_argument("password", type=str, help="New password to set")

    def handle(self, *args, **options):
        User = get_user_model()
        username = options["username"]
        password = options["password"]

        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            self.stderr.write(self.style.ERROR(f"User with username '{username}' does not exist."))
            return

        user.set_password(password)
        user.save(update_fields=["password"])
        self.stdout.write(self.style.SUCCESS(f"Password updated for user '{username}'."))
