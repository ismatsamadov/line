"""
Resend email notifier for the bus scraper — run summary + error alerts,
mirroring scraper_job/ scraper_cand/ events/ email_notifier.py.

Stdlib only (urllib) — no extra dependency. Reuses the same RESEND_API_KEY /
RESEND_FROM_EMAIL / ADMIN_ALERT_EMAIL the rest of the app uses. Best-effort:
a missing key or a send failure never breaks a scrape (callers wrap in try).
"""
import os
import logging
from html import escape as _esc
from resend_transport import send_resend_email

logger = logging.getLogger(__name__)


def _send(subject: str, body_html: str, max_attempts: int = 3) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set — skipping bus email notification")
        return False
    from_email = os.environ.get("RESEND_FROM_EMAIL") or "jobs@birjob.com"
    to_email = os.environ.get("ADMIN_ALERT_EMAIL") or from_email
    html = ('<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;'
            'color:#1e293b;line-height:1.5">' + body_html + "</div>")
    return send_resend_email(
        api_key, from_email, to_email, subject, html,
        user_agent="BirJob-BusScraper/1.0 (+https://birjob.com)",
        max_attempts=max_attempts,
    )


def notify_success(source_label: str, rows) -> bool:
    """rows: iterable of (label, value) pairs rendered as a summary table."""
    body = (f"<p style='font-size:16px;font-weight:700;margin:0 0 8px;color:#0f172a'>"
            f"🚌 {_esc(source_label)} — avtobus scraper hesabatı</p>"
            f"<table style='border-collapse:collapse;font-size:14px'>")
    for label, val in rows:
        body += (f"<tr><td style='padding:3px 16px 3px 0;color:#475569'>{_esc(str(label))}</td>"
                 f"<td style='padding:3px 0;font-weight:600'>{_esc(str(val))}</td></tr>")
    body += "</table>"
    return _send(f"🚌 {source_label}: avtobus scraper", body)


def notify_error(source_label: str, error_message) -> bool:
    body = (f"<p style='font-size:16px;font-weight:700;color:#b91c1c;margin:0 0 8px'>"
            f"🚨 {_esc(source_label)} avtobus scraper xətası</p>"
            f"<pre style='background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;"
            f"padding:10px;white-space:pre-wrap;font-size:12px'>{_esc(str(error_message)[:2000])}</pre>")
    return _send(f"🚨 {source_label} avtobus scraper xətası", body)
