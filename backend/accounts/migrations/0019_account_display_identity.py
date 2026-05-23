# Display name, purpose, notes; backfill from nickname

from django.db import migrations, models

DISPLAY_NAME_MAX = 100
PURPOSE_MAX = 255


def _split_nickname_for_backfill(nickname: str) -> tuple[str, str]:
    """Copy nickname into display_name; optionally move overflow/descriptive text to purpose."""
    nick = nickname.strip()
    if not nick:
        return "", ""
    if len(nick) <= DISPLAY_NAME_MAX:
        return nick, ""
    for sep in (" — ", " - ", " – ", ": "):
        if sep in nick:
            left, right = nick.split(sep, 1)
            left = left.strip()[:DISPLAY_NAME_MAX]
            right = right.strip()[:PURPOSE_MAX]
            if left and right:
                return left, right
    return nick[:DISPLAY_NAME_MAX], nick[DISPLAY_NAME_MAX:].strip()[:PURPOSE_MAX]


def backfill_from_nickname(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")
    for acct in Account.objects.all().iterator():
        nick = (acct.nickname or "").strip()
        if not nick:
            continue
        display, purpose_extra = _split_nickname_for_backfill(nick)
        acct.display_name = display
        if purpose_extra and not (acct.purpose or "").strip():
            acct.purpose = purpose_extra
        acct.save(update_fields=["display_name", "purpose"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0018_account_relationships"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="display_name",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Short custom label shown throughout the app.",
                max_length=100,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="purpose",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Concise description of how this account is used.",
                max_length=255,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="notes",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Optional freeform notes about this account.",
            ),
        ),
        migrations.AlterField(
            model_name="account",
            name="nickname",
            field=models.CharField(
                blank=True,
                help_text="Deprecated: use display_name. Kept for backward compatibility.",
                max_length=255,
            ),
        ),
        migrations.RunPython(backfill_from_nickname, migrations.RunPython.noop),
    ]
