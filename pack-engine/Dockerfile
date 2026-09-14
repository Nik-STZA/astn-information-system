# Pack engine, run as a Cloud Run Job (python -m pack_engine.job).
#
# No credentials are baked in: Xero is read through stza-finance-api
# (FINANCE_API_KEY from Secret Manager) and Drive is written as the job's own
# service account through Application Default Credentials.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY pack_engine ./pack_engine
COPY profiles ./profiles

RUN useradd --create-home --uid 10001 engine
USER engine
CMD ["python", "-m", "pack_engine.job"]
