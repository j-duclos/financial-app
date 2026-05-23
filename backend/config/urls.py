"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from core.views import DatabaseInfoView, health
from timeline.views import TimelineView

urlpatterns = [
    path("health/", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/db-info/", DatabaseInfoView.as_view(), name="db_info"),
    path("api/timeline/", TimelineView.as_view(), name="timeline"),
    path("api/", include("timeline.urls")),
    path("api/", include("core.urls")),
    path("api/accounts/", include("accounts.urls")),
    path("api/categories/", include("categories.urls")),
    path("api/transactions/", include("transactions.urls")),
    path("api/budgets/", include("budgets.urls")),
    path("api/insights/", include("insights.urls")),
    path("api/", include("plaid_link.urls")),
    path("", include("web.urls")),
]
