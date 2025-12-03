#!/bin/bash
# ==================================
# Aegis Guardian - Set Railway Devnet Variables
# ==================================
# This script ensures all Railway environment variables are set to devnet
#
# Usage:
#   ./scripts/set-railway-devnet.sh [service-name]
#
# Example:
#   ./scripts/set-railway-devnet.sh aegis-guardian

set -e

SERVICE_NAME="${1:-aegis-guardian}"

echo "═══════════════════════════════════════════════════════════════"
echo "Setting Railway Environment Variables for DEVNET"
echo "Service: $SERVICE_NAME"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it with: npm i -g @railway/cli"
    exit 1
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo "❌ Not logged in to Railway. Run: railway login"
    exit 1
fi

echo "📋 Setting Solana Configuration (DEVNET)..."
echo ""

# Solana RPC Configuration (DEVNET with Helius)
railway variables --service "$SERVICE_NAME" --set SOLANA_RPC_URL="https://devnet.helius-rpc.com/?api-key=d0bb1f98-b8e3-4f52-9108-778ff3d7dcf1"
railway variables --service "$SERVICE_NAME" --set SOLANA_WS_URL="wss://devnet.helius-rpc.com/?api-key=d0bb1f98-b8e3-4f52-9108-778ff3d7dcf1"
railway variables --service "$SERVICE_NAME" --set SOLANA_CLUSTER="devnet"

# Program Configuration
railway variables --service "$SERVICE_NAME" --set PROGRAM_ID="ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ"
railway variables --service "$SERVICE_NAME" --set AEGIS_PROGRAM_ID="ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ"

echo "✅ Solana configuration set to DEVNET"
echo ""

echo "📋 Setting Application URLs..."
echo ""

# Get the Railway URL
RAILWAY_URL=$(railway domain --service "$SERVICE_NAME" 2>/dev/null | head -n 1 || echo "")

if [ -z "$RAILWAY_URL" ]; then
    echo "⚠️  Could not auto-detect Railway URL. Please set manually:"
    echo "   railway variables --service $SERVICE_NAME --set BASE_URL=https://your-service.railway.app"
    echo "   railway variables --service $SERVICE_NAME --set ACTIONS_BASE_URL=https://your-service.railway.app/api/actions"
    echo "   railway variables --service $SERVICE_NAME --set NEXT_PUBLIC_API_URL=https://your-service.railway.app"
    echo ""
else
    echo "   Detected Railway URL: $RAILWAY_URL"
    railway variables --service "$SERVICE_NAME" --set BASE_URL="https://$RAILWAY_URL"
    railway variables --service "$SERVICE_NAME" --set ACTIONS_BASE_URL="https://$RAILWAY_URL/api/actions"
    railway variables --service "$SERVICE_NAME" --set NEXT_PUBLIC_API_URL="https://$RAILWAY_URL"
    railway variables --service "$SERVICE_NAME" --set NEXT_PUBLIC_GUARDIAN_URL="https://$RAILWAY_URL"
    echo "✅ Application URLs set"
    echo ""
fi

echo "📋 Setting Event Listener Configuration..."
echo ""

# Event Listener Configuration
railway variables --service "$SERVICE_NAME" --set EVENT_LISTENER_ENABLED="true"
railway variables --service "$SERVICE_NAME" --set EVENT_LISTENER_RESTART_DELAY="5000"
railway variables --service "$SERVICE_NAME" --set EVENT_LISTENER_MAX_RECONNECT_ATTEMPTS="10"

echo "✅ Event listener configured"
echo ""

echo "📋 Setting Feature Flags..."
echo ""

# Feature Flags
railway variables --service "$SERVICE_NAME" --set BLINK_GENERATION_ENABLED="true"
railway variables --service "$SERVICE_NAME" --set ANALYTICS_ENABLED="true"
railway variables --service "$SERVICE_NAME" --set WEBHOOKS_ENABLED="true"

echo "✅ Feature flags set"
echo ""

echo "📋 Verifying Configuration..."
echo ""

# Verify critical variables
echo "Checking critical variables..."
railway variables --service "$SERVICE_NAME" | grep -E "SOLANA_RPC_URL|SOLANA_CLUSTER|PROGRAM_ID" || echo "⚠️  Some variables may not be set"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Configuration Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "📝 Summary:"
echo "   • Solana RPC: DEVNET (Helius)"
echo "   • Program ID: ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ"
echo "   • Event Listener: Enabled"
echo "   • Blink Generation: Enabled"
echo ""
echo "🔄 Next Steps:"
echo "   1. Railway will automatically redeploy with new variables"
echo "   2. Check logs: railway logs --service $SERVICE_NAME"
echo "   3. Verify event listener is running: railway logs --service $SERVICE_NAME | grep 'Event listener'"
echo ""

