#!/bin/bash
# Deploy AfricanSTN API to Cloud Run
#
# Run from the repo root:
#   bash deploy/deploy.sh
#
# Prerequisites:
#   - gcloud CLI authenticated with project africanstn-research
#   - Cloud SQL instance africastn-db in europe-west1

set -euo pipefail

PROJECT_ID="africanstn-research"
REGION="europe-west1"
SERVICE_NAME="africastn-api"
INSTANCE_CONNECTION="africanstn-research:europe-west1:africastn-db"

echo "=== Copying route files into deploy/ ==="
cp server-listing-routes.js deploy/
cp server-pipeline-routes.js deploy/
cp server-client-management-routes.js deploy/
cp server-agent-routes.js deploy/

echo "=== Building and deploying to Cloud Run ==="
cd deploy

gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source . \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "DB_USER=africastn_app,DB_NAME=africastn_os,INSTANCE_CONNECTION_NAME=$INSTANCE_CONNECTION" \
  --set-secrets "DB_PASSWORD=db-password:latest" \
  --add-cloudsql-instances "$INSTANCE_CONNECTION" \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 300

echo ""
echo "=== Deploy complete ==="
echo "Service URL: $(gcloud run services describe $SERVICE_NAME --project $PROJECT_ID --region $REGION --format 'value(status.url)')"
echo ""
echo "Test: curl -H 'X-API-Key: \$API_KEY' \$(gcloud run services describe $SERVICE_NAME --project $PROJECT_ID --region $REGION --format 'value(status.url)')/health"
