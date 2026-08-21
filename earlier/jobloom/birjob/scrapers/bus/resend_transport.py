"""Shared Resend email transport for the birjob scrapers.

VENDORED FILE — byte-identical copies live in scrapers/candidates/,
scrapers/bus/ and monitoring/. Each builds its OWN Docker image from its OWN directory
(independent build contexts — see each Dockerfile / workflow), so none can import a
single repo-root module; this one canonical transport is copied verbatim into each
instead. If you change the transport, change it once and re-copy to all three — never
edit a single copy alone.

NOTHING CHECKS THAT ANY MORE. The byte-identity test lived in scrapers/jobs/tests/ and
went with the jobs fleet when that moved to softon. Re-homing it is issue-tracked; until
then the only guard is this paragraph.

Scope: this owns ONLY the part that was duplicated three ways — the
POST-to-Resend-with-backoff loop. Each scraper keeps its own report formatting,
subject lines, HTML wrapping, credential resolution, and (async vs sync) call
style, and passes the finished pieces in here. Stdlib only (urllib), matching
the scrapers' no-extra-dependency ethos.
"""
from __future__ import annotations
import json
import time
import logging
import urllib.request
import urllib.error

RESEND_ENDPOINT = "https://api.resend.com/emails"

logger = logging.getLogger(__name__)


def send_resend_email(
    api_key,
    from_email: str,
    to_email: str,
    subject: str,
    html: str,
    *,
    user_agent: str,
    max_attempts: int = 3,
    timeout: int = 20,
) -> bool:
    """POST one fully-formed HTML email to Resend, retrying transient failures
    with linear backoff (2s, 4s, ...). Returns True once delivered, False if the
    api_key is missing or every attempt fails.

    A 4xx response (bad key / unverified domain / bad payload) is treated as
    non-retryable and returns False immediately. Best-effort: this never raises,
    so a notification failure can't break a scrape. The caller resolves the
    credentials and pre-wraps `html`; `user_agent` identifies the calling scraper.
    """
    if not api_key:
        logger.warning("RESEND_API_KEY not configured — skipping email notification")
        return False
    payload = json.dumps({
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html,
    }).encode()
    for attempt in range(1, max_attempts + 1):
        req = urllib.request.Request(
            RESEND_ENDPOINT, data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": user_agent,
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if 200 <= resp.status < 300:
                    return True
                logger.error(f"Resend send failed: HTTP {resp.status}")
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:200]
            except Exception:
                pass
            if 400 <= e.code < 500:  # bad key / unverified domain — won't fix on retry
                logger.error(f"Resend send failed (non-retryable): HTTP {e.code} {detail}")
                return False
            logger.error(f"Resend send failed: HTTP {e.code} {detail}")
        except Exception as e:
            logger.warning(f"Resend attempt {attempt}/{max_attempts} errored: {e}")
        if attempt < max_attempts:
            time.sleep(2 ** attempt)
    logger.error(f"Resend send failed after {max_attempts} attempts")
    return False
