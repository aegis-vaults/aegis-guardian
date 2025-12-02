#!/bin/bash
# ==================================
# Aegis Guardian - Environment Variable Management Script
# ==================================
# This script helps manage environment variables for Railway deployments.
#
# Usage:
#   ./scripts/manage-env.sh [command]
#
# Commands:
#   list          - List all environment variables
#   export        - Export variables to .env file
#   import        - Import variables from .env file to Railway
#   validate      - Validate required variables are set
#   generate      - Generate new secrets
#   compare       - Compare local .env with Railway
#   backup        - Backup current Railway variables

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

COMMAND="${1:-help}"

# Check Railway CLI
check_railway() {
    if ! command -v railway &> /dev/null; then
        echo -e "${RED}Error: Railway CLI is not installed${NC}"
        echo "Install it with: npm install -g @railway/cli"
        exit 1
    fi

    if ! railway whoami &> /dev/null; then
        echo -e "${RED}Error: Not logged in to Railway${NC}"
        echo "Run: railway login"
        exit 1
    fi

    if ! railway status &> /dev/null 2>&1; then
        echo -e "${RED}Error: No Railway project linked${NC}"
        echo "Run: railway link"
        exit 1
    fi
}

# Required variables
REQUIRED_VARS=(
    "NODE_ENV"
    "PORT"
    "BASE_URL"
    "DATABASE_URL"
    "REDIS_URL"
    "PROGRAM_ID"
    "SOLANA_CLUSTER"
    "SOLANA_RPC_URL"
    "JWT_SECRET"
    "WEBHOOK_HMAC_SECRET"
)

# Optional but recommended variables
RECOMMENDED_VARS=(
    "ACTIONS_BASE_URL"
    "CORS_ORIGINS"
    "EVENT_LISTENER_ENABLED"
    "JOBS_ENABLED"
    "WEBHOOKS_ENABLED"
    "ANALYTICS_ENABLED"
    "BLINK_GENERATION_ENABLED"
)

cmd_list() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Railway Environment Variables${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    check_railway

    echo -e "${YELLOW}Fetching variables...${NC}"
    railway variables

    echo ""
    echo -e "${GREEN}Total variables listed above${NC}"
}

cmd_export() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Export Variables to .env${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    check_railway

    ENV_FILE=".env.railway-export"

    echo -e "${YELLOW}Exporting to $ENV_FILE...${NC}"

    # Create header
    cat > "$ENV_FILE" <<EOF
# Aegis Guardian Environment Variables
# Exported from Railway on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# DO NOT COMMIT THIS FILE

EOF

    # Export each variable
    for var in "${REQUIRED_VARS[@]}" "${RECOMMENDED_VARS[@]}"; do
        value=$(railway variables get "$var" 2>/dev/null || echo "")
        if [ -n "$value" ]; then
            echo "$var=$value" >> "$ENV_FILE"
        fi
    done

    # Export additional variables that might exist
    ADDITIONAL_VARS=(
        "TELEGRAM_BOT_TOKEN"
        "SENDGRID_API_KEY"
        "SENDGRID_FROM_EMAIL"
        "STRIPE_SECRET_KEY"
        "STRIPE_WEBHOOK_SECRET"
        "STRIPE_PERSONAL_PRICE_ID"
        "STRIPE_TEAM_PRICE_ID"
        "STRIPE_ENTERPRISE_PRICE_ID"
        "SENTRY_DSN"
        "SENTRY_TRACES_SAMPLE_RATE"
    )

    for var in "${ADDITIONAL_VARS[@]}"; do
        value=$(railway variables get "$var" 2>/dev/null || echo "")
        if [ -n "$value" ]; then
            echo "$var=$value" >> "$ENV_FILE"
        fi
    done

    echo -e "${GREEN}✓ Variables exported to $ENV_FILE${NC}"
    echo ""
    echo -e "${RED}WARNING: This file contains secrets. Keep it secure!${NC}"
    echo -e "Add to .gitignore: ${BLUE}echo '$ENV_FILE' >> .gitignore${NC}"
}

cmd_import() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Import Variables from .env${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    check_railway

    ENV_FILE="${2:-.env}"

    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${RED}Error: $ENV_FILE not found${NC}"
        exit 1
    fi

    echo -e "${YELLOW}Importing from $ENV_FILE...${NC}"
    echo ""

    # Read .env file and set variables
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        if [[ "$key" =~ ^#.*$ ]] || [ -z "$key" ]; then
            continue
        fi

        # Remove quotes from value
        value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")

        echo -e "Setting ${BLUE}$key${NC}..."
        railway variables --set "$key=$value"
    done < "$ENV_FILE"

    echo ""
    echo -e "${GREEN}✓ Variables imported${NC}"
    echo ""
    echo -e "${YELLOW}Restart service to apply changes:${NC}"
    echo -e "  ${BLUE}railway restart${NC}"
}

cmd_validate() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Validate Environment Variables${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    check_railway

    MISSING_VARS=()
    MISSING_RECOMMENDED=()

    echo -e "${YELLOW}Checking required variables...${NC}"
    echo ""

    for var in "${REQUIRED_VARS[@]}"; do
        value=$(railway variables get "$var" 2>/dev/null || echo "")
        if [ -z "$value" ]; then
            echo -e "${RED}✗${NC} $var - MISSING (required)"
            MISSING_VARS+=("$var")
        else
            echo -e "${GREEN}✓${NC} $var - Set"
        fi
    done

    echo ""
    echo -e "${YELLOW}Checking recommended variables...${NC}"
    echo ""

    for var in "${RECOMMENDED_VARS[@]}"; do
        value=$(railway variables get "$var" 2>/dev/null || echo "")
        if [ -z "$value" ]; then
            echo -e "${YELLOW}⚠${NC} $var - Not set (recommended)"
            MISSING_RECOMMENDED+=("$var")
        else
            echo -e "${GREEN}✓${NC} $var - Set"
        fi
    done

    echo ""
    echo -e "${BLUE}========================================${NC}"

    if [ ${#MISSING_VARS[@]} -eq 0 ]; then
        echo -e "${GREEN}✓ All required variables are set${NC}"
    else
        echo -e "${RED}✗ Missing ${#MISSING_VARS[@]} required variable(s)${NC}"
        echo ""
        echo "Missing required variables:"
        for var in "${MISSING_VARS[@]}"; do
            echo "  - $var"
        done
    fi

    if [ ${#MISSING_RECOMMENDED[@]} -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}⚠ Missing ${#MISSING_RECOMMENDED[@]} recommended variable(s)${NC}"
        echo ""
        echo "Missing recommended variables:"
        for var in "${MISSING_RECOMMENDED[@]}"; do
            echo "  - $var"
        done
    fi

    echo ""

    if [ ${#MISSING_VARS[@]} -gt 0 ]; then
        exit 1
    fi
}

cmd_generate() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Generate New Secrets${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    check_railway

    echo -e "${YELLOW}This will generate new secrets for:${NC}"
    echo "  - JWT_SECRET"
    echo "  - WEBHOOK_HMAC_SECRET"
    echo ""
    echo -e "${RED}WARNING: Generating new secrets will invalidate existing:${NC}"
    echo "  - All JWT tokens (users will need to re-authenticate)"
    echo "  - Webhook signatures (webhooks will need updating)"
    echo ""

    read -p "Continue? (yes/no): " -r CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        echo -e "${GREEN}Operation cancelled${NC}"
        exit 0
    fi

    echo ""
    echo -e "${YELLOW}Generating secrets...${NC}"

    # Generate JWT secret
    JWT_SECRET=$(openssl rand -base64 32)
    echo -e "${GREEN}✓${NC} Generated JWT_SECRET: ${JWT_SECRET:0:20}..."

    # Generate webhook HMAC secret
    WEBHOOK_HMAC_SECRET=$(openssl rand -base64 32)
    echo -e "${GREEN}✓${NC} Generated WEBHOOK_HMAC_SECRET: ${WEBHOOK_HMAC_SECRET:0:20}..."

    echo ""
    echo -e "${YELLOW}Setting variables in Railway...${NC}"

    railway variables --set JWT_SECRET="$JWT_SECRET"
    railway variables --set WEBHOOK_HMAC_SECRET="$WEBHOOK_HMAC_SECRET"

    echo -e "${GREEN}✓ Secrets set in Railway${NC}"

    # Save to file for backup
    SECRETS_FILE=".railway-secrets-$(date +%Y%m%d-%H%M%S).txt"
    cat > "$SECRETS_FILE" <<EOF
Generated Secrets - $(date -u +"%Y-%m-%dT%H:%M:%SZ")
DO NOT COMMIT THIS FILE

JWT_SECRET=$JWT_SECRET
WEBHOOK_HMAC_SECRET=$WEBHOOK_HMAC_SECRET
EOF

    echo -e "${GREEN}✓ Secrets saved to $SECRETS_FILE${NC}"
    echo ""
    echo -e "${RED}IMPORTANT:${NC}"
    echo "1. Keep $SECRETS_FILE secure and do not commit it"
    echo "2. Restart service: railway restart"
    echo "3. Users will need to re-authenticate"
    echo "4. Update webhook subscribers with new HMAC secret"
}

cmd_compare() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Compare Local .env with Railway${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    check_railway

    ENV_FILE="${2:-.env}"

    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${RED}Error: $ENV_FILE not found${NC}"
        exit 1
    fi

    echo -e "${YELLOW}Comparing $ENV_FILE with Railway...${NC}"
    echo ""

    DIFFERENCES=0

    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        if [[ "$key" =~ ^#.*$ ]] || [ -z "$key" ]; then
            continue
        fi

        # Remove quotes from value
        local_value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
        railway_value=$(railway variables get "$key" 2>/dev/null || echo "")

        if [ -z "$railway_value" ]; then
            echo -e "${YELLOW}⚠${NC} $key - Only in local .env"
            DIFFERENCES=$((DIFFERENCES + 1))
        elif [ "$local_value" != "$railway_value" ]; then
            echo -e "${RED}✗${NC} $key - Different values"
            echo -e "  Local:   ${local_value:0:50}..."
            echo -e "  Railway: ${railway_value:0:50}..."
            DIFFERENCES=$((DIFFERENCES + 1))
        else
            echo -e "${GREEN}✓${NC} $key - Match"
        fi
    done < "$ENV_FILE"

    echo ""

    if [ $DIFFERENCES -eq 0 ]; then
        echo -e "${GREEN}✓ No differences found${NC}"
    else
        echo -e "${YELLOW}⚠ Found $DIFFERENCES difference(s)${NC}"
    fi
}

cmd_backup() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Backup Railway Variables${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    check_railway

    BACKUP_DIR="backups"
    mkdir -p "$BACKUP_DIR"

    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/railway-env-$TIMESTAMP.env"

    echo -e "${YELLOW}Creating backup...${NC}"

    # Create header
    cat > "$BACKUP_FILE" <<EOF
# Aegis Guardian Environment Variables Backup
# Created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Railway Project: $(railway status 2>&1 | grep -i "project" || echo "unknown")
# DO NOT COMMIT THIS FILE

EOF

    # Export all variables
    for var in "${REQUIRED_VARS[@]}" "${RECOMMENDED_VARS[@]}"; do
        value=$(railway variables get "$var" 2>/dev/null || echo "")
        if [ -n "$value" ]; then
            echo "$var=$value" >> "$BACKUP_FILE"
        fi
    done

    # Export additional variables
    ADDITIONAL_VARS=(
        "APP_VERSION"
        "LOG_LEVEL"
        "RATE_LIMIT_MAX"
        "RATE_LIMIT_WINDOW_MS"
        "TELEGRAM_BOT_TOKEN"
        "SENDGRID_API_KEY"
        "SENDGRID_FROM_EMAIL"
        "STRIPE_SECRET_KEY"
        "STRIPE_WEBHOOK_SECRET"
        "STRIPE_PERSONAL_PRICE_ID"
        "STRIPE_TEAM_PRICE_ID"
        "STRIPE_ENTERPRISE_PRICE_ID"
        "SENTRY_DSN"
        "SENTRY_TRACES_SAMPLE_RATE"
    )

    for var in "${ADDITIONAL_VARS[@]}"; do
        value=$(railway variables get "$var" 2>/dev/null || echo "")
        if [ -n "$value" ]; then
            echo "$var=$value" >> "$BACKUP_FILE"
        fi
    done

    echo -e "${GREEN}✓ Backup created: $BACKUP_FILE${NC}"
    echo ""
    echo -e "${RED}WARNING: This file contains secrets. Keep it secure!${NC}"
    echo ""
    echo "To restore from this backup:"
    echo -e "  ${BLUE}./scripts/manage-env.sh import $BACKUP_FILE${NC}"
}

cmd_help() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Environment Variable Management${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo ""
    echo -e "  ${GREEN}list${NC}"
    echo "    List all environment variables in Railway"
    echo ""
    echo -e "  ${GREEN}export${NC}"
    echo "    Export Railway variables to .env.railway-export file"
    echo ""
    echo -e "  ${GREEN}import [file]${NC}"
    echo "    Import variables from .env file to Railway"
    echo "    Default file: .env"
    echo ""
    echo -e "  ${GREEN}validate${NC}"
    echo "    Validate that all required variables are set"
    echo ""
    echo -e "  ${GREEN}generate${NC}"
    echo "    Generate new secrets (JWT_SECRET, WEBHOOK_HMAC_SECRET)"
    echo ""
    echo -e "  ${GREEN}compare [file]${NC}"
    echo "    Compare local .env with Railway variables"
    echo "    Default file: .env"
    echo ""
    echo -e "  ${GREEN}backup${NC}"
    echo "    Backup current Railway variables to backups/ directory"
    echo ""
    echo "Examples:"
    echo ""
    echo "  $0 list"
    echo "  $0 export"
    echo "  $0 import .env.production"
    echo "  $0 validate"
    echo "  $0 generate"
    echo "  $0 compare .env"
    echo "  $0 backup"
    echo ""
}

# Main command dispatcher
case "$COMMAND" in
    list)
        cmd_list
        ;;
    export)
        cmd_export
        ;;
    import)
        cmd_import
        ;;
    validate)
        cmd_validate
        ;;
    generate)
        cmd_generate
        ;;
    compare)
        cmd_compare
        ;;
    backup)
        cmd_backup
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        echo ""
        cmd_help
        exit 1
        ;;
esac
