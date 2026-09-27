"""Apple App Site Association for Plaid iOS OAuth Universal Links."""
from django.conf import settings
from django.http import JsonResponse


IOS_BUNDLE_IDENTIFIER = "com.jduclos.flowsight"
DEFAULT_APPLE_TEAM_ID = "8T4R887TAQ"


def apple_app_site_association(_request):
    """
    Hosted at https://flowsight360.com/.well-known/apple-app-site-association
    so iOS can return Plaid OAuth to the native app (web uses the same path in a browser).
    """
    team = (getattr(settings, "APPLE_TEAM_ID", "") or DEFAULT_APPLE_TEAM_ID).strip() or DEFAULT_APPLE_TEAM_ID
    payload = {
        "applinks": {
            "apps": [],
            "details": [
                {
                    "appID": f"{team}.{IOS_BUNDLE_IDENTIFIER}",
                    "paths": ["/plaid/oauth-return", "/plaid/oauth-return/*"],
                }
            ],
        }
    }
    response = JsonResponse(payload)
    response["Content-Type"] = "application/json"
    response["Cache-Control"] = "public, max-age=300"
    return response
