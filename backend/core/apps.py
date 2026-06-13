from django.apps import AppConfig

from common.services.profiler import perf_print


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"

    def ready(self) -> None:
        perf_print("[PERF] startup performance logging active")
