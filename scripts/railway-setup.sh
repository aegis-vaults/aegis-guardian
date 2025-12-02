#!/bin/bash
# ==================================
# Aegis Guardian - Railway Setup Script
# ==================================
# This script sets up a new Railway project with all required services
# and environment variables for the Aegis Guardian backend.
#
# Prerequisites:
# - Railway CLI installed (npm install -g @railway/cli)
# - Railway account with active subscription
# - Logged in to Railway (railway login)
#
# Usage:
#   ./scripts/railway-setup.sh [project-name]
#
# Example:
#   ./scripts/railway-setup.sh aegis-guardian-prod

set -e  # Exit on error
set -u  # Exit on undefined variable

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project configuration
PROJECT_NAME="${1:-aegis-guardian}"
ENVIRONMENT="${2:-production}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Aegis Guardian - Railway Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Project Name: ${GREEN}${PROJECT_NAME}${NC}"
echo -e "Environment: ${GREEN}${ENVIRONMENT}${NC}"
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo -e "${RED}Error: Railway CLI is not installed${NC}"
    echo "Install it with: npm install -g @railway/cli"
    exit 1
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo -e "${RED}Error: Not logged in to Railway${NC}"
    echo "Run: railway login"
    exit 1
fi

echo -e "${YELLOW}Step 1: Creating Railway project...${NC}"
railway init --name "$PROJECT_NAME"

echo -e "${GREEN}✓ Project created${NC}"
echo ""

# Link to the project
railway link

echo -e "${YELLOW}Step 2: Adding PostgreSQL database...${NC}"
railway add --database postgres
echo -e "${GREEN}✓ PostgreSQL added${NC}"
echo ""

echo -e "${YELLOW}Step 3: Adding Redis...${NC}"
railway add --database redis
echo -e "${GREEN}✓ Redis added${NC}"
echo ""

echo -e "${YELLOW}Step 4: Generating secrets...${NC}"

# Generate JWT secret
JWT_SECRET=$(openssl rand -base64 32)
echo -e "Generated JWT_SECRET: ${GREEN}${JWT_SECRET:0:20}...${NC}"

# Generate webhook HMAC secret
WEBHOOK_HMAC_SECRET=$(openssl rand -base64 32)
echo -e "Generated WEBHOOK_HMAC_SECRET: ${GREEN}${WEBHOOK_HMAC_SECRET:0:20}...${NC}"

echo -e "${GREEN}✓ Secrets generated${NC}"
echo ""

echo -e "${YELLOW}Step 5: Setting environment variables...${NC}"

# Application Configuration
railway variables --set NODE_ENV=production
railway variables --set PORT=3000
railway variables --set APP_VERSION=1.0.0
railway variables --set LOG_LEVEL=info

# Solana Configuration (IMPORTANT: Update these for your deployment)
echo -e "${YELLOW}IMPORTANT: Update Solana configuration variables:${NC}"
railway variables --set PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
railway variables --set SOLANA_CLUSTER=devnet
railway variables --set SOLANA_RPC_URL=https://api.devnet.solana.com

# Event Listener Configuration
railway variables --set EVENT_LISTENER_ENABLED=true
railway variables --set EVENT_LISTENER_RESTART_DELAY=5000

# Background Jobs Configuration
railway variables --set JOBS_ENABLED=true
railway variables --set JOBS_CONCURRENCY=5
railway variables --set METRICS_CRON_SCHEDULE="0 0 * * *"

# API Configuration
railway variables --set RATE_LIMIT_MAX=100
railway variables --set RATE_LIMIT_WINDOW_MS=60000

# Webhook Configuration
railway variables --set WEBHOOKS_ENABLED=true
railway variables --set WEBHOOK_MAX_RETRIES=3
railway variables --set WEBHOOK_RETRY_DELAY=1000
railway variables --set WEBHOOK_TIMEOUT=5000
railway variables --set WEBHOOK_HMAC_SECRET="$WEBHOOK_HMAC_SECRET"

# Security Configuration
railway variables --set JWT_SECRET="$JWT_SECRET"
railway variables --set SESSION_TIMEOUT=3600

# Feature Flags
railway variables --set EXPERIMENTAL_FEATURES_ENABLED=false
railway variables --set ANALYTICS_ENABLED=true
railway variables --set BLINK_GENERATION_ENABLED=true
railway variables --set REQUEST_TRACING_ENABLED=false

echo -e "${GREEN}✓ Environment variables set${NC}"
echo ""

echo -e "${YELLOW}Step 6: Setting up custom domain (optional)...${NC}"
echo -e "To add a custom domain, run:"
echo -e "  ${BLUE}railway domain${NC}"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Next steps:"
echo -e "1. Update BASE_URL and ACTIONS_BASE_URL after deployment:"
echo -e "   ${BLUE}railway variables --set BASE_URL=https://your-domain.railway.app${NC}"
echo -e "   ${BLUE}railway variables --set ACTIONS_BASE_URL=https://your-domain.railway.app/api/actions${NC}"
echo -e "   ${BLUE}railway variables --set CORS_ORIGINS=https://your-frontend-domain.com${NC}"
echo ""
echo -e "2. Add notification service credentials (optional):"
echo -e "   ${BLUE}railway variables --set TELEGRAM_BOT_TOKEN=your-token${NC}"
echo -e "   ${BLUE}railway variables --set SENDGRID_API_KEY=your-key${NC}"
echo -e "   ${BLUE}railway variables --set SENDGRID_FROM_EMAIL=noreply@yourdomain.com${NC}"
echo ""
echo -e "3. Add Stripe configuration (if using subscriptions):"
echo -e "   ${BLUE}railway variables --set STRIPE_SECRET_KEY=sk_live_...${NC}"
echo -e "   ${BLUE}railway variables --set STRIPE_WEBHOOK_SECRET=whsec_...${NC}"
echo -e "   ${BLUE}railway variables --set STRIPE_PERSONAL_PRICE_ID=price_...${NC}"
echo -e "   ${BLUE}railway variables --set STRIPE_TEAM_PRICE_ID=price_...${NC}"
echo -e "   ${BLUE}railway variables --set STRIPE_ENTERPRISE_PRICE_ID=price_...${NC}"
echo ""
echo -e "4. Deploy the application:"
echo -e "   ${BLUE}./scripts/deploy-railway.sh${NC}"
echo ""
echo -e "5. View deployment status:"
echo -e "   ${BLUE}railway status${NC}"
echo ""
echo -e "6. View logs:"
echo -e "   ${BLUE}railway logs${NC}"
echo ""

# Save configuration for reference
CONFIG_FILE=".railway-config.json"
cat > "$CONFIG_FILE" <<EOF
{
  "project": "$PROJECT_NAME",
  "environment": "$ENVIRONMENT",
  "created": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "secrets": {
    "JWT_SECRET": "$JWT_SECRET",
    "WEBHOOK_HMAC_SECRET": "$WEBHOOK_HMAC_SECRET"
  }
}
EOF

echo -e "${GREEN}Configuration saved to: ${CONFIG_FILE}${NC}"
echo -e "${RED}WARNING: Keep this file secure and do not commit it to version control!${NC}"
echo ""
