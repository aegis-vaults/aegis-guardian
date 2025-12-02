#!/bin/bash
# ==================================
# Aegis Guardian - Railway Deployment Script
# ==================================
# This script automates the deployment of Aegis Guardian to Railway.
# It performs pre-deployment checks, copies necessary files, and deploys.
#
# Prerequisites:
# - Railway project already created (run railway-setup.sh first)
# - Railway CLI installed and logged in
# - aegis-protocol IDL file available
#
# Usage:
#   ./scripts/deploy-railway.sh [environment]
#
# Example:
#   ./scripts/deploy-railway.sh production

set -e  # Exit on error
set -u  # Exit on undefined variable

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT="${1:-production}"
PROTOCOL_PATH="${PROTOCOL_PATH:-../aegis-protocol}"
IDL_SOURCE="$PROTOCOL_PATH/target/idl/aegis_core.json"
IDL_DEST="./src/lib/idl/aegis_core.json"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Aegis Guardian - Railway Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Environment: ${GREEN}${ENVIRONMENT}${NC}"
echo ""

# Function to print step header
print_step() {
    echo -e "${YELLOW}=== $1 ===${NC}"
}

# Function to print success
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print error
print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Function to print warning
print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Step 1: Pre-deployment checks
print_step "Step 1: Running pre-deployment checks"

# Check Railway CLI
if ! command -v railway &> /dev/null; then
    print_error "Railway CLI is not installed"
    echo "Install it with: npm install -g @railway/cli"
    exit 1
fi
print_success "Railway CLI found"

# Check if logged in
if ! railway whoami &> /dev/null; then
    print_error "Not logged in to Railway"
    echo "Run: railway login"
    exit 1
fi
print_success "Logged in to Railway"

# Check if project is linked
if ! railway status &> /dev/null; then
    print_error "No Railway project linked"
    echo "Run: railway link"
    exit 1
fi
print_success "Railway project linked"

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    print_warning "Node.js version is $NODE_VERSION. Version 20+ is recommended."
else
    print_success "Node.js version: $(node --version)"
fi

echo ""

# Step 2: Copy IDL file
print_step "Step 2: Copying IDL file from protocol"

if [ -f "$IDL_SOURCE" ]; then
    mkdir -p "$(dirname "$IDL_DEST")"
    cp "$IDL_SOURCE" "$IDL_DEST"
    print_success "IDL file copied from $IDL_SOURCE"
else
    print_warning "IDL file not found at $IDL_SOURCE"
    print_warning "Make sure aegis-protocol is built: cd $PROTOCOL_PATH && anchor build"

    # Check if IDL already exists in destination
    if [ -f "$IDL_DEST" ]; then
        print_warning "Using existing IDL file at $IDL_DEST"
    else
        print_error "No IDL file available. Cannot proceed."
        exit 1
    fi
fi

echo ""

# Step 3: Install dependencies
print_step "Step 3: Installing dependencies"

npm ci
print_success "Dependencies installed"

echo ""

# Step 4: Generate Prisma Client
print_step "Step 4: Generating Prisma Client"

npx prisma generate
print_success "Prisma Client generated"

echo ""

# Step 5: Run type checking
print_step "Step 5: Running type checking"

npm run type-check
print_success "Type checking passed"

echo ""

# Step 6: Build locally (optional, for verification)
print_step "Step 6: Building application locally (verification)"

echo "Building Next.js application..."
npm run build

if [ $? -eq 0 ]; then
    print_success "Local build successful"
else
    print_error "Local build failed"
    echo "Fix build errors before deploying"
    exit 1
fi

echo ""

# Step 7: Run database migrations
print_step "Step 7: Running database migrations"

echo -e "${YELLOW}Do you want to run database migrations? (y/n)${NC}"
read -r RUN_MIGRATIONS

if [ "$RUN_MIGRATIONS" = "y" ] || [ "$RUN_MIGRATIONS" = "Y" ]; then
    echo "Running migrations..."
    railway run npx prisma migrate deploy
    print_success "Migrations completed"
else
    print_warning "Skipping migrations"
fi

echo ""

# Step 8: Deploy to Railway
print_step "Step 8: Deploying to Railway"

echo "Starting deployment..."
railway up --detach

if [ $? -eq 0 ]; then
    print_success "Deployment initiated"
else
    print_error "Deployment failed"
    exit 1
fi

echo ""

# Step 9: Wait for deployment
print_step "Step 9: Monitoring deployment"

echo "Waiting for deployment to complete..."
sleep 10

# Get deployment status
DEPLOYMENT_STATUS=$(railway status 2>&1)
echo "$DEPLOYMENT_STATUS"

echo ""

# Step 10: Post-deployment verification
print_step "Step 10: Post-deployment verification"

# Get the service URL
SERVICE_URL=$(railway variables get BASE_URL 2>/dev/null || echo "")

if [ -z "$SERVICE_URL" ]; then
    print_warning "BASE_URL not set. Skipping health check."
    print_warning "Set it with: railway variables --set BASE_URL=https://your-domain.railway.app"
else
    echo "Checking health endpoint: $SERVICE_URL/api/health"

    # Wait a bit for service to start
    sleep 20

    # Check health endpoint
    HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/api/health" || echo "000")

    if [ "$HEALTH_RESPONSE" = "200" ]; then
        print_success "Service is healthy (HTTP $HEALTH_RESPONSE)"
    else
        print_warning "Service returned HTTP $HEALTH_RESPONSE"
        print_warning "Check logs with: railway logs"
    fi
fi

echo ""

# Step 11: Display useful information
print_step "Deployment Summary"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Next steps:"
echo ""
echo -e "1. View deployment logs:"
echo -e "   ${BLUE}railway logs --follow${NC}"
echo ""
echo -e "2. Check service status:"
echo -e "   ${BLUE}railway status${NC}"
echo ""
echo -e "3. Open service in browser:"
echo -e "   ${BLUE}railway open${NC}"
echo ""
echo -e "4. Run post-deployment verification:"
echo -e "   ${BLUE}./scripts/verify-deployment.sh${NC}"
echo ""
echo -e "5. Set up monitoring:"
echo -e "   - Configure Railway metrics"
echo -e "   - Set up external uptime monitoring"
echo -e "   - Configure error tracking (Sentry)"
echo ""
echo -e "6. If issues occur, rollback with:"
echo -e "   ${BLUE}railway rollback${NC}"
echo ""

# Save deployment info
DEPLOYMENT_INFO_FILE=".deployment-info.json"
cat > "$DEPLOYMENT_INFO_FILE" <<EOF
{
  "environment": "$ENVIRONMENT",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "gitCommit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "gitBranch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')",
  "nodeVersion": "$(node --version)",
  "serviceUrl": "$SERVICE_URL"
}
EOF

print_success "Deployment info saved to $DEPLOYMENT_INFO_FILE"
echo ""
