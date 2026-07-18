# Bus scraper image — pulls Baku transit data from the AYNA API and refreshes the
# bus.* tables. Mirrors scraper_job / scraper_cand / events so all four scrapers
# build+run the same way in CI.
FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

# ca-certificates: the scraper fetches https://map-api.ayna.gov.az via urllib,
# which needs the CA bundle. No build tools: the only dependency is
# psycopg2-binary, a prebuilt wheel that bundles libpq.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Requirements first for layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Scripts (scraper.py, email_notifier.py, resend_transport.py) + the schema the
# scraper reads at runtime via SCHEMA_SQL (open(SCHEMA_SQL)).
COPY *.py schema.sql ./

CMD ["python", "scraper.py"]
