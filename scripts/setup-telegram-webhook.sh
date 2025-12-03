#!/bin/bash
# Setup Telegram Bot Webhook
# This script configures the Telegram bot to send updates to your webhook endpoint

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Telegram Bot Webhook Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if TELEGRAM_BOT_TOKEN is set
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo -e "${YELLOW}TELEGRAM_BOT_TOKEN not found in environment.${NC}"
    echo -e "Enter your Telegram Bot Token (from @BotFather):"
    read -r TELEGRAM_BOT_TOKEN
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo -e "${RED}Error: TELEGRAM_BOT_TOKEN is required${NC}"
    exit 1
fi

# Default webhook URL for production
DEFAULT_WEBHOOK_URL="https://aegis-guardian-production.up.railway.app/api/webhooks/telegram"

echo -e "Enter your webhook URL (default: $DEFAULT_WEBHOOK_URL):"
read -r WEBHOOK_URL
WEBHOOK_URL=${WEBHOOK_URL:-$DEFAULT_WEBHOOK_URL}

echo ""
echo -e "${BLUE}Step 1: Getting current webhook info...${NC}"
echo ""

# Get current webhook info
CURRENT_WEBHOOK=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo")
echo "Current webhook configuration:"
echo "$CURRENT_WEBHOOK" | jq .

echo ""
echo -e "${BLUE}Step 2: Setting up new webhook...${NC}"
echo ""

# Set webhook
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"${WEBHOOK_URL}\", \"allowed_updates\": [\"message\"]}")

echo "Response from Telegram:"
echo "$RESPONSE" | jq .

# Check if successful
SUCCESS=$(echo "$RESPONSE" | jq -r '.ok')

if [ "$SUCCESS" = "true" ]; then
    echo ""
    echo -e "${GREEN}✅ Webhook set successfully!${NC}"
    echo ""
    echo -e "${BLUE}Step 3: Getting bot info...${NC}"
    
    # Get bot info
    BOT_INFO=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe")
    BOT_USERNAME=$(echo "$BOT_INFO" | jq -r '.result.username')
    
    echo "Bot Info:"
    echo "$BOT_INFO" | jq .result
    
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Setup Complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "Your webhook URL: ${BLUE}${WEBHOOK_URL}${NC}"
    echo -e "Your bot username: ${BLUE}@${BOT_USERNAME}${NC}"
    echo ""
    echo -e "${YELLOW}Required Environment Variables:${NC}"
    echo -e "  TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}"
    echo -e "  TELEGRAM_BOT_USERNAME=${BOT_USERNAME}"
    echo ""
    echo -e "${YELLOW}Make sure these are set in Railway:${NC}"
    echo -e "  railway variables --set TELEGRAM_BOT_TOKEN=\"${TELEGRAM_BOT_TOKEN}\""
    echo -e "  railway variables --set TELEGRAM_BOT_USERNAME=\"${BOT_USERNAME}\""
else
    echo ""
    echo -e "${RED}❌ Failed to set webhook${NC}"
    echo -e "Error: $(echo "$RESPONSE" | jq -r '.description')"
    exit 1
fi

echo ""
echo -e "${BLUE}Step 4: Test your webhook${NC}"
echo ""
echo "To test if the webhook is working:"
echo "1. Open Telegram and find your bot: @${BOT_USERNAME}"
echo "2. Send /start"
echo "3. You should receive a welcome message"
echo ""
echo "If it doesn't work, check:"
echo "- Railway logs for any errors"
echo "- That the webhook endpoint is accessible"
echo "- That TELEGRAM_BOT_TOKEN is set correctly in Railway"

