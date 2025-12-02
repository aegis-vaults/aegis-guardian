#!/bin/bash
# ==================================
# Aegis Guardian - Complete Deployment Automation
# ==================================
# This script automates the complete deployment process after service creation
#
# Prerequisites:
# - Railway service already created via dashboard
# - PostgreSQL and Redis services added
# - Service linked: railway service link <service-name>
#
# Usage:
#   ./scripts/complete-deployment.sh [service-name]
#
# Example:
#   ./scripts/complete-deployment.sh aegis-guardian

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SERVICE_NAME="${1:-aegis-guardian}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Aegis Guardian - Complete Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Service: ${GREEN}${SERVICE_NAME}${NC}"
echo ""

# Check Railway CLI
if ! command -v railway &> /dev/null; then
    echo -e "${RED}Error: Railway CLI not installed${NC}"
    exit 1
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo -e "${RED}Error: Not logged in to Railway${NC}"
    exit 1
fi

# Step 1: Link service
echo -e "${YELLOW}Step 1: Linking service...${NC}"
if railway service link "$SERVICE_NAME" 2>&1 | grep -q "linked"; then
    echo -e "${GREEN}✓ Service linked${NC}"
else
    echo -e "${YELLOW}⚠ Service may already be linked or not found${NC}"
    echo "Continuing..."
fi
echo ""

# Step 2: Set environment variables
echo -e "${YELLOW}Step 2: Setting environment variables...${NC}"
./scripts/set-env-vars.sh "$SERVICE_NAME"
echo ""

# Step 3: Get service URL (if available)
echo -e "${YELLOW}Step 3: Getting service information...${NC}"
SERVICE_URL=$(railway status --json 2>/dev/null | jq -r '.url' 2>/dev/null || echo "")
if [ -z "$SERVICE_URL" ]; then
    SERVICE_URL=$(railway status 2>&1 | grep -o 'https://[^ ]*' | head -1 || echo "")
fi

if [ -n "$SERVICE_URL" ]; then
    echo -e "${GREEN}✓ Service URL: ${SERVICE_URL}${NC}"
    
    # Set URL-based variables
    echo -e "${YELLOW}Setting URL-based environment variables...${NC}"
    railway variables --service "$SERVICE_NAME" --set BASE_URL="$SERVICE_URL"
    railway variables --service "$SERVICE_NAME" --set ACTIONS_BASE_URL="$SERVICE_URL/api/actions"
    railway variables --service "$SERVICE_NAME" --set NEXT_PUBLIC_API_URL="$SERVICE_URL"
    echo -e "${GREEN}✓ URL variables set${NC}"
else
    echo -e "${YELLOW}⚠ Service URL not available yet. Set manually after deployment:${NC}"
    echo "  railway variables --service $SERVICE_NAME --set BASE_URL=https://your-url.railway.app"
fi
echo ""

# Step 4: Deploy
echo -e "${YELLOW}Step 4: Deploying application...${NC}"
echo "This may take a few minutes..."
railway up --service "$SERVICE_NAME" --detach

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Deployment initiated${NC}"
else
    echo -e "${RED}✗ Deployment failed${NC}"
    exit 1
fi
echo ""

# Step 5: Wait for deployment
echo -e "${YELLOW}Step 5: Waiting for deployment to complete...${NC}"
echo "Waiting 30 seconds for service to start..."
sleep 30
echo ""

# Step 6: Get final URL
echo -e "${YELLOW}Step 6: Getting final service URL...${NC}"
FINAL_URL=$(railway status --json 2>/dev/null | jq -r '.url' 2>/dev/null || railway status 2>&1 | grep -o 'https://[^ ]*' | head -1 || echo "")

if [ -z "$FINAL_URL" ]; then
    echo -e "${YELLOW}⚠ URL not available. Check Railway dashboard${NC}"
    FINAL_URL="https://your-service.railway.app"
else
    echo -e "${GREEN}✓ Service URL: ${FINAL_URL}${NC}"
    
    # Update URL variables if they changed
    railway variables --service "$SERVICE_NAME" --set BASE_URL="$FINAL_URL"
    railway variables --service "$SERVICE_NAME" --set ACTIONS_BASE_URL="$FINAL_URL/api/actions"
    railway variables --service "$SERVICE_NAME" --set NEXT_PUBLIC_API_URL="$FINAL_URL"
fi
echo ""

# Step 7: Run migrations
echo -e "${YELLOW}Step 7: Running database migrations...${NC}"
echo "Running migrations..."
if railway run --service "$SERVICE_NAME" npx prisma migrate deploy; then
    echo -e "${GREEN}✓ Migrations completed${NC}"
else
    echo -e "${YELLOW}⚠ Migration failed or already applied${NC}"
fi
echo ""

# Step 8: Health check
echo -e "${YELLOW}Step 8: Checking service health...${NC}"
if [ -n "$FINAL_URL" ] && [ "$FINAL_URL" != "https://your-service.railway.app" ]; then
    echo "Waiting 20 seconds for service to be ready..."
    sleep 20
    
    HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FINAL_URL/api/health" 2>/dev/null || echo "000")
    
    if [ "$HEALTH_STATUS" = "200" ]; then
        echo -e "${GREEN}✓ Service is healthy (HTTP 200)${NC}"
    else
        echo -e "${YELLOW}⚠ Health check returned HTTP ${HEALTH_STATUS}${NC}"
        echo "Check logs: railway logs --service $SERVICE_NAME"
    fi
else
    echo -e "${YELLOW}⚠ Skipping health check (URL not available)${NC}"
fi
echo ""

# Summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Service: ${BLUE}${SERVICE_NAME}${NC}"
if [ -n "$FINAL_URL" ] && [ "$FINAL_URL" != "https://your-service.railway.app" ]; then
    echo -e "URL: ${BLUE}${FINAL_URL}${NC}"
fi
echo ""
echo -e "Next steps:"
echo ""
echo -e "1. View logs:"
echo -e "   ${BLUE}railway logs --service ${SERVICE_NAME} --follow${NC}"
echo ""
if [ -n "$FINAL_URL" ] && [ "$FINAL_URL" != "https://your-service.railway.app" ]; then
    echo -e "2. Run verification:"
    echo -e "   ${BLUE}./scripts/verify-deployment.sh ${FINAL_URL}${NC}"
    echo ""
    echo -e "3. Run smoke tests:"
    echo -e "   ${BLUE}./scripts/smoke-test.sh ${FINAL_URL}${NC}"
    echo ""
fi
echo -e "4. Set CORS origins (if needed):"
echo -e "   ${BLUE}railway variables --service ${SERVICE_NAME} --set CORS_ORIGINS=https://your-frontend.com${NC}"
echo ""

