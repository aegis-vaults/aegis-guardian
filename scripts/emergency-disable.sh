#!/bin/bash
# ==================================
# Aegis Guardian - Emergency Disable Script
# ==================================
# This script quickly disables specific features without doing a full rollback.
# Use this for quick mitigation of issues.
#
# Usage:
#   ./scripts/emergency-disable.sh <feature>
#
# Features:
#   event-listener    - Disable Solana event listener
#   webhooks          - Disable webhook notifications
#   jobs              - Disable background jobs
#   analytics         - Disable analytics processing
#   blinks            - Disable Blink generation
#   all               - Disable all features

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

FEATURE="${1:-}"

echo -e "${RED}========================================${NC}"
echo -e "${RED}Aegis Guardian - Emergency Disable${NC}"
echo -e "${RED}========================================${NC}"
echo ""

# Check Railway CLI
if ! command -v railway &> /dev/null; then
    echo -e "${RED}Error: Railway CLI is not installed${NC}"
    exit 1
fi

if [ -z "$FEATURE" ]; then
    echo -e "${RED}Error: No feature specified${NC}"
    echo ""
    echo "Usage: $0 <feature>"
    echo ""
    echo "Available features:"
    echo "  event-listener    - Disable Solana event listener"
    echo "  webhooks          - Disable webhook notifications"
    echo "  jobs              - Disable background jobs"
    echo "  analytics         - Disable analytics processing"
    echo "  blinks            - Disable Blink generation"
    echo "  all               - Disable all features"
    echo ""
    exit 1
fi

echo -e "${RED}WARNING: This will disable ${FEATURE} immediately${NC}"
echo -e "${YELLOW}The service will restart automatically${NC}"
echo ""

read -p "Continue? (yes/no): " -r CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${GREEN}Operation cancelled${NC}"
    exit 0
fi

echo ""

disable_event_listener() {
    echo -e "${YELLOW}Disabling event listener...${NC}"
    railway variables --set EVENT_LISTENER_ENABLED=false
    echo -e "${GREEN}✓ Event listener disabled${NC}"
}

disable_webhooks() {
    echo -e "${YELLOW}Disabling webhooks...${NC}"
    railway variables --set WEBHOOKS_ENABLED=false
    echo -e "${GREEN}✓ Webhooks disabled${NC}"
}

disable_jobs() {
    echo -e "${YELLOW}Disabling background jobs...${NC}"
    railway variables --set JOBS_ENABLED=false
    echo -e "${GREEN}✓ Background jobs disabled${NC}"
}

disable_analytics() {
    echo -e "${YELLOW}Disabling analytics...${NC}"
    railway variables --set ANALYTICS_ENABLED=false
    echo -e "${GREEN}✓ Analytics disabled${NC}"
}

disable_blinks() {
    echo -e "${YELLOW}Disabling Blink generation...${NC}"
    railway variables --set BLINK_GENERATION_ENABLED=false
    echo -e "${GREEN}✓ Blink generation disabled${NC}"
}

case "$FEATURE" in
    event-listener)
        disable_event_listener
        ;;
    webhooks)
        disable_webhooks
        ;;
    jobs)
        disable_jobs
        ;;
    analytics)
        disable_analytics
        ;;
    blinks)
        disable_blinks
        ;;
    all)
        disable_event_listener
        disable_webhooks
        disable_jobs
        disable_analytics
        disable_blinks
        ;;
    *)
        echo -e "${RED}Unknown feature: $FEATURE${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${YELLOW}Restarting service...${NC}"
railway restart

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Emergency Disable Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Monitor the service:"
echo "  railway logs --follow"
echo ""
echo "To re-enable features, set the variables back to true:"
echo "  railway variables --set EVENT_LISTENER_ENABLED=true"
echo "  railway variables --set WEBHOOKS_ENABLED=true"
echo "  railway variables --set JOBS_ENABLED=true"
echo "  railway variables --set ANALYTICS_ENABLED=true"
echo "  railway variables --set BLINK_GENERATION_ENABLED=true"
echo ""

# Log the emergency disable
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "$TIMESTAMP - Emergency disabled: $FEATURE" >> .emergency-disables.log
echo -e "${YELLOW}Action logged to .emergency-disables.log${NC}"
echo ""
