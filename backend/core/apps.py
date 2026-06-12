import logging

from django.apps import AppConfig
from django.conf import settings

_perf_logger = logging.getLogger("common.services.profiler")


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"

    def ready(self) -> None:
        if getattr(settings, "ENABLE_PERF_LOGS", False):
            _perf_logger.info("[PERF] Performance logging enabled ENABLE_PERF_LOGS=true")
