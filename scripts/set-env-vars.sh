#!/bin/bash
# ==================================
# Aegis Guardian - Set Environment Variables
# ==================================
# This script sets all required environment variables for Railway deployment
#
# Usage:
#   ./scripts/set-env-vars.sh [service-name]
#
# Example:
#   ./scripts/set-env-vars.sh aegis-guardian

set -e

SERVICE_NAME="${1:-aegis-guardian}"

echo "Setting environment variables for service: $SERVICE_NAME"
echo ""

# Critical variables from user
railway variables --service "$SERVICE_NAME" --set JWT_SECRET="j0G9hNeUFPTN2vNLpqJZenXKnEM6xaYajuDoEQWqkDE="
railway variables --service "$SERVICE_NAME" --set WEBHOOK_HMAC_SECRET="++3Mi+OF73GI664VIx23/g0iwpEGjLIKgbd+91Lb6t8="
railway variables --service "$SERVICE_NAME" --set SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=e85ab87c-6105-407d-9a02-3b87b56636d1"
railway variables --service "$SERVICE_NAME" --set SOLANA_WS_URL="wss://mainnet.helius-rpc.com/?api-key=e85ab87c-6105-407d-9a02-3b87b56636d1"

# Application Configuration
railway variables --service "$SERVICE_NAME" --set NODE_ENV=production
railway variables --service "$SERVICE_NAME" --set PORT=3000
railway variables --service "$SERVICE_NAME" --set APP_VERSION=1.0.0
railway variables --service "$SERVICE_NAME" --set LOG_LEVEL=info

# Solana Configuration (mainnet)
railway variables --service "$SERVICE_NAME" --set PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
railway variables --service "$SERVICE_NAME" --set AEGIS_PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
railway variables --service "$SERVICE_NAME" --set SOLANA_CLUSTER=mainnet

# Event Listener Configuration
railway variables --service "$SERVICE_NAME" --set EVENT_LISTENER_ENABLED=true
railway variables --service "$SERVICE_NAME" --set EVENT_LISTENER_RESTART_DELAY=5000
railway variables --service "$SERVICE_NAME" --set EVENT_LISTENER_MAX_RECONNECT_ATTEMPTS=10

# Background Jobs Configuration
railway variables --service "$SERVICE_NAME" --set JOBS_ENABLED=true
railway variables --service "$SERVICE_NAME" --set JOBS_CONCURRENCY=5
railway variables --service "$SERVICE_NAME" --set METRICS_CRON_SCHEDULE="0 0 * * *"

# API Configuration
railway variables --service "$SERVICE_NAME" --set RATE_LIMIT_MAX=100
railway variables --service "$SERVICE_NAME" --set RATE_LIMIT_WINDOW_MS=60000

# Webhook Configuration
railway variables --service "$SERVICE_NAME" --set WEBHOOKS_ENABLED=true
railway variables --service "$SERVICE_NAME" --set WEBHOOK_MAX_RETRIES=3
railway variables --service "$SERVICE_NAME" --set WEBHOOK_RETRY_DELAY=1000
railway variables --service "$SERVICE_NAME" --set WEBHOOK_TIMEOUT=5000

# Security Configuration
railway variables --service "$SERVICE_NAME" --set SESSION_TIMEOUT=3600

# Feature Flags
railway variables --service "$SERVICE_NAME" --set EXPERIMENTAL_FEATURES_ENABLED=false
railway variables --service "$SERVICE_NAME" --set ANALYTICS_ENABLED=true
railway variables --service "$SERVICE_NAME" --set BLINK_GENERATION_ENABLED=true
railway variables --service "$SERVICE_NAME" --set REQUEST_TRACING_ENABLED=false

# Database Pooling
railway variables --service "$SERVICE_NAME" --set DATABASE_POOL_MIN=2
railway variables --service "$SERVICE_NAME" --set DATABASE_POOL_MAX=10

echo ""
echo "✓ All environment variables set!"
echo ""
echo "Note: BASE_URL, ACTIONS_BASE_URL, and CORS_ORIGINS will be set after deployment"
echo "when you have the Railway URL. Run:"
echo "  railway variables --service $SERVICE_NAME --set BASE_URL=https://your-url.railway.app"
echo "  railway variables --service $SERVICE_NAME --set ACTIONS_BASE_URL=https://your-url.railway.app/api/actions"
echo "  railway variables --service $SERVICE_NAME --set NEXT_PUBLIC_API_URL=https://your-url.railway.app"


