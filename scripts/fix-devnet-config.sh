#!/bin/bash
# ==================================
# Fix Devnet Configuration for Railway
# ==================================
# Run this script to fix the RPC configuration for devnet testing

set -e

SERVICE_NAME="${1:-aegis-guardian}"

echo "Updating Railway environment variables for DEVNET..."
echo ""

# Fix Solana RPC to use devnet (using Helius devnet - free tier)
# You can sign up for free at https://helius.dev/ to get your own API key
railway variables --service "$SERVICE_NAME" --set SOLANA_RPC_URL="https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY"
railway variables --service "$SERVICE_NAME" --set SOLANA_WS_URL="wss://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY"
railway variables --service "$SERVICE_NAME" --set SOLANA_CLUSTER="devnet"

echo ""
echo "✓ Updated to DEVNET configuration!"
echo ""
echo "IMPORTANT: Replace YOUR_HELIUS_API_KEY with your actual Helius API key"
echo "Get a free API key at: https://helius.dev/"
echo ""
echo "Alternative free devnet RPC options:"
echo "  - https://api.devnet.solana.com (rate limited)"
echo "  - https://devnet.genesysgo.net/"
echo "  - https://rpc.ankr.com/solana_devnet"

