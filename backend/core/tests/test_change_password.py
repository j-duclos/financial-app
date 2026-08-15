import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()


def test_change_password_success_keeps_jwt_usable(authenticated_client, user):
    refresh = RefreshToken.for_user(user)
    access = str(refresh.access_token)
    token_client = APIClient()
    token_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

    r = authenticated_client.post(
        "/api/profile/change-password/",
        {
            "current_password": "testpass123",
            "new_password": "UniqueHorseStaple9",
            "new_password_confirm": "UniqueHorseStaple9",
        },
        format="json",
    )
    assert r.status_code == 200, r.data
    assert r.json() == {"detail": "Password updated."}
    assert "password" not in r.json()
    assert "new_password" not in r.json()
    assert "current_password" not in r.json()

    user.refresh_from_db()
    assert user.check_password("UniqueHorseStaple9")
    assert not user.check_password("testpass123")

    still = token_client.get("/api/profile/")
    assert still.status_code == 200

    login = APIClient().post(
        "/api/auth/token/",
        {"username": user.username, "password": "UniqueHorseStaple9"},
        format="json",
    )
    assert login.status_code == 200
    old_login = APIClient().post(
        "/api/auth/token/",
        {"username": user.username, "password": "testpass123"},
        format="json",
    )
    assert old_login.status_code == 401


def test_change_password_wrong_current(authenticated_client, user):
    r = authenticated_client.post(
        "/api/profile/change-password/",
        {
            "current_password": "wrong-pass",
            "new_password": "UniqueHorseStaple9",
            "new_password_confirm": "UniqueHorseStaple9",
        },
        format="json",
    )
    assert r.status_code == 400
    assert "current_password" in r.json()
    user.refresh_from_db()
    assert user.check_password("testpass123")


def test_change_password_confirmation_mismatch(authenticated_client, user):
    r = authenticated_client.post(
        "/api/profile/change-password/",
        {
            "current_password": "testpass123",
            "new_password": "UniqueHorseStaple9",
            "new_password_confirm": "UniqueHorseStaple8",
        },
        format="json",
    )
    assert r.status_code == 400
    assert "new_password_confirm" in r.json()
    user.refresh_from_db()
    assert user.check_password("testpass123")


@pytest.mark.parametrize(
    "new_password",
    ["short", "password", "12345678"],
)
def test_change_password_rejects_weak(authenticated_client, user, new_password):
    r = authenticated_client.post(
        "/api/profile/change-password/",
        {
            "current_password": "testpass123",
            "new_password": new_password,
            "new_password_confirm": new_password,
        },
        format="json",
    )
    assert r.status_code == 400
    assert "new_password" in r.json()
    user.refresh_from_db()
    assert user.check_password("testpass123")
