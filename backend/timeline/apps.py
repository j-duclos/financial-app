from django.apps import AppConfig


class TimelineConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "timeline"

    def ready(self):
        import timeline.signals  # noqa: F401
