from django.test import override_settings
from rest_framework.test import APIClient


def test_apple_app_site_association_maps_plaid_oauth_return():
    client = APIClient()
    response = client.get("/.well-known/apple-app-site-association")
    assert response.status_code == 200
    assert "application/json" in response["Content-Type"]
    body = response.json()
    details = body["applinks"]["details"]
    assert details[0]["appID"].endswith("com.jduclos.flowsight")
    assert "/plaid/oauth-return" in details[0]["paths"]


@override_settings(APPLE_TEAM_ID="AB12CD34EF")
def test_apple_app_site_association_uses_configured_team_id():
    client = APIClient()
    body = client.get("/apple-app-site-association").json()
    assert body["applinks"]["details"][0]["appID"] == "AB12CD34EF.com.jduclos.flowsight"
