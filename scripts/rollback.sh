#!/bin/bash
# ==================================
# Aegis Guardian - Rollback Script
# ==================================
# This script helps rollback to a previous deployment in case of issues.
#
# Usage:
#   ./scripts/rollback.sh [deployment-id]
#
# Example:
#   ./scripts/rollback.sh d7a8b9c0

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

DEPLOYMENT_ID="${1:-}"

echo -e "${RED}========================================${NC}"
echo -e "${RED}Aegis Guardian - Rollback Procedure${NC}"
echo -e "${RED}========================================${NC}"
echo ""

# Check Railway CLI
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

# Check if project is linked
if ! railway status &> /dev/null; then
    echo -e "${RED}Error: No Railway project linked${NC}"
    echo "Run: railway link"
    exit 1
fi

echo -e "${YELLOW}Current Deployment Status:${NC}"
railway status
echo ""

if [ -z "$DEPLOYMENT_ID" ]; then
    echo -e "${YELLOW}Recent Deployments:${NC}"
    echo "Run the following to see recent deployments:"
    echo -e "  ${BLUE}railway logs${NC}"
    echo ""
    echo -e "${RED}No deployment ID provided${NC}"
    echo "Usage: $0 <deployment-id>"
    echo ""
    echo "To rollback to the previous deployment:"
    echo -e "  ${BLUE}railway rollback${NC}"
    echo ""
    exit 1
fi

echo -e "${RED}WARNING: You are about to rollback to deployment: ${DEPLOYMENT_ID}${NC}"
echo -e "${RED}This will replace the current running version.${NC}"
echo ""
echo -e "${YELLOW}Pre-rollback Checklist:${NC}"
echo "1. Database migrations: If new migrations were applied, consider reverting them first"
echo "2. Environment variables: Ensure no new required variables were added"
echo "3. Dependencies: Check for breaking changes in dependencies"
echo "4. User impact: Notify users if necessary"
echo ""

read -p "Are you sure you want to rollback? (yes/no): " -r CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${GREEN}Rollback cancelled${NC}"
    exit 0
fi

echo ""
echo -e "${YELLOW}Step 1: Creating pre-rollback backup info${NC}"

# Get current deployment info
CURRENT_DEPLOYMENT=$(railway status 2>&1 || echo "unknown")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Save rollback info
ROLLBACK_INFO_FILE=".rollback-info-$TIMESTAMP.json"
cat > "$ROLLBACK_INFO_FILE" <<EOF
{
  "timestamp": "$TIMESTAMP",
  "targetDeploymentId": "$DEPLOYMENT_ID",
  "previousDeployment": "$CURRENT_DEPLOYMENT",
  "gitCommit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "gitBranch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
}
EOF

echo -e "${GREEN}✓ Rollback info saved to $ROLLBACK_INFO_FILE${NC}"
echo ""

echo -e "${YELLOW}Step 2: Performing rollback${NC}"

# Railway rollback command
railway rollback "$DEPLOYMENT_ID"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Rollback initiated${NC}"
else
    echo -e "${RED}✗ Rollback failed${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 3: Waiting for rollback to complete${NC}"

sleep 20

echo ""
echo -e "${YELLOW}Step 4: Verifying rollback${NC}"

# Check deployment status
railway status

echo ""
echo -e "${YELLOW}Step 5: Health check${NC}"

SERVICE_URL=$(railway variables get BASE_URL 2>/dev/null || echo "")

if [ -n "$SERVICE_URL" ]; then
    echo "Checking health endpoint: $SERVICE_URL/api/health"
    sleep 10  # Give service time to start

    HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/api/health" || echo "000")

    if [ "$HEALTH_RESPONSE" = "200" ]; then
        echo -e "${GREEN}✓ Service is healthy after rollback (HTTP $HEALTH_RESPONSE)${NC}"
    else
        echo -e "${RED}✗ Service returned HTTP $HEALTH_RESPONSE${NC}"
        echo -e "${YELLOW}Check logs with: railway logs${NC}"
    fi
else
    echo -e "${YELLOW}⚠ BASE_URL not set, skipping health check${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Rollback Procedure Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Post-rollback steps:"
echo "1. Monitor logs: railway logs --follow"
echo "2. Run verification: ./scripts/verify-deployment.sh"
echo "3. Check metrics for any anomalies"
echo "4. Notify team about rollback"
echo "5. Investigate and fix the issue before redeploying"
echo ""
echo "If you need to rollback database migrations:"
echo "  railway run npx prisma migrate resolve --rolled-back <migration-name>"
echo ""
echo "Rollback info saved to: $ROLLBACK_INFO_FILE"
echo ""
