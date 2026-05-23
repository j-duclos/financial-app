"""Normalize phone inputs to E.164 for Plaid Link ``user.phone_number`` and profile storage."""
from __future__ import annotations

import re

_E164 = re.compile(r"^\+[1-9]\d{9,14}$")


def normalize_to_e164(raw: str | None) -> str | None:
    """
    Best-effort E.164. US-focused: 10 digits → +1… ; 11 digits starting with 1 → +1… ;
    values already starting with + use digits after plus only.
    Returns None if no plausible normalization.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    if s.startswith("+"):
        digits = "".join(c for c in s[1:] if c.isdigit())
        if not digits:
            return None
        cand = "+" + digits
        return cand if _E164.match(cand) else None
    digits = "".join(c for c in s if c.isdigit())
    if not digits:
        return None
    if len(digits) == 10:
        cand = "+1" + digits
        return cand if _E164.match(cand) else None
    if len(digits) == 11 and digits.startswith("1"):
        cand = "+" + digits
        return cand if _E164.match(cand) else None
    return None


def is_valid_e164(s: str | None) -> bool:
    return bool(s and _E164.match(s.strip()))
