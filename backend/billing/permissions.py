from rest_framework.permissions import BasePermission


class IsStaffUser(BasePermission):
    """Authenticated Django staff only. Ordinary users receive 403."""

    def has_permission(self, request, view) -> bool:
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and user.is_staff)
