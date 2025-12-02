#!/bin/bash
# ==================================
# Aegis Guardian - Deployment Verification Script
# ==================================
# This script performs comprehensive post-deployment checks to ensure
# the Aegis Guardian backend is functioning correctly.
#
# Usage:
#   ./scripts/verify-deployment.sh [base-url]
#
# Example:
#   ./scripts/verify-deployment.sh https://aegis-guardian.railway.app

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${1:-$(railway variables get BASE_URL 2>/dev/null || echo '')}"
TIMEOUT=10

if [ -z "$BASE_URL" ]; then
    echo -e "${RED}Error: BASE_URL not provided and not found in Railway variables${NC}"
    echo "Usage: $0 <base-url>"
    echo "Example: $0 https://aegis-guardian.railway.app"
    exit 1
fi

# Remove trailing slash
BASE_URL="${BASE_URL%/}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Aegis Guardian - Deployment Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Base URL: ${GREEN}${BASE_URL}${NC}"
echo ""

# Counters for pass/fail
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Function to print test result
print_test() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    if [ "$1" = "pass" ]; then
        echo -e "${GREEN}✓${NC} $2"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
    elif [ "$1" = "fail" ]; then
        echo -e "${RED}✗${NC} $2"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
    elif [ "$1" = "warn" ]; then
        echo -e "${YELLOW}⚠${NC} $2"
    else
        echo -e "${BLUE}→${NC} $2"
    fi
}

# Function to check HTTP endpoint
check_endpoint() {
    local endpoint=$1
    local expected_status=$2
    local description=$3

    local response_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$BASE_URL$endpoint" 2>/dev/null || echo "000")

    if [ "$response_code" = "$expected_status" ]; then
        print_test "pass" "$description (HTTP $response_code)"
        return 0
    else
        print_test "fail" "$description (Expected: $expected_status, Got: $response_code)"
        return 1
    fi
}

# Function to check endpoint and parse JSON
check_json_endpoint() {
    local endpoint=$1
    local description=$2

    local response=$(curl -s --max-time "$TIMEOUT" "$BASE_URL$endpoint" 2>/dev/null || echo "{}")

    if echo "$response" | jq empty 2>/dev/null; then
        print_test "pass" "$description"
        echo "$response"
        return 0
    else
        print_test "fail" "$description (Invalid JSON response)"
        return 1
    fi
}

echo -e "${YELLOW}=== Basic Connectivity ===${NC}"
echo ""

# Check 1: Health endpoint
HEALTH_RESPONSE=$(check_json_endpoint "/api/health" "Health endpoint responds with valid JSON")
if [ $? -eq 0 ]; then
    # Parse health response
    STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
    DB_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.services.database.status' 2>/dev/null || echo "unknown")
    REDIS_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.services.redis.status' 2>/dev/null || echo "unknown")
    VERSION=$(echo "$HEALTH_RESPONSE" | jq -r '.version' 2>/dev/null || echo "unknown")
    RESPONSE_TIME=$(echo "$HEALTH_RESPONSE" | jq -r '.responseTime' 2>/dev/null || echo "0")

    echo -e "  Status: ${GREEN}${STATUS}${NC}"
    echo -e "  Database: ${GREEN}${DB_STATUS}${NC}"
    echo -e "  Redis: ${GREEN}${REDIS_STATUS}${NC}"
    echo -e "  Version: ${GREEN}${VERSION}${NC}"
    echo -e "  Response Time: ${GREEN}${RESPONSE_TIME}ms${NC}"

    if [ "$STATUS" = "healthy" ]; then
        print_test "pass" "Overall system health is good"
    else
        print_test "fail" "System health is degraded or unhealthy"
    fi

    if [ "$DB_STATUS" = "healthy" ]; then
        print_test "pass" "Database connection is healthy"
    else
        print_test "fail" "Database connection is unhealthy"
    fi

    if [ "$REDIS_STATUS" = "healthy" ]; then
        print_test "pass" "Redis connection is healthy"
    else
        print_test "fail" "Redis connection is unhealthy"
    fi

    if [ "$RESPONSE_TIME" -lt 500 ]; then
        print_test "pass" "Response time is good (<500ms)"
    elif [ "$RESPONSE_TIME" -lt 1000 ]; then
        print_test "warn" "Response time is acceptable (500-1000ms)"
    else
        print_test "fail" "Response time is slow (>1000ms)"
    fi
fi

echo ""
echo -e "${YELLOW}=== API Endpoints ===${NC}"
echo ""

# Check API endpoints (these should return 405 Method Not Allowed or similar, not 404)
check_endpoint "/api/vaults" "405" "Vaults API endpoint exists"
check_endpoint "/api/transactions" "405" "Transactions API endpoint exists"
check_endpoint "/api/analytics" "405" "Analytics API endpoint exists"

echo ""
echo -e "${YELLOW}=== SSL/TLS Configuration ===${NC}"
echo ""

# Check SSL certificate (only for HTTPS)
if [[ "$BASE_URL" == https://* ]]; then
    SSL_INFO=$(curl -vI "$BASE_URL" 2>&1 | grep -E "(SSL|TLS)" || echo "")
    if [ -n "$SSL_INFO" ]; then
        print_test "pass" "SSL/TLS is configured"
    else
        print_test "fail" "SSL/TLS configuration issue"
    fi

    # Check certificate validity
    SSL_EXPIRY=$(echo | openssl s_client -servername "$(echo "$BASE_URL" | sed 's|https://||' | cut -d'/' -f1)" -connect "$(echo "$BASE_URL" | sed 's|https://||' | cut -d'/' -f1):443" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null | grep notAfter || echo "")
    if [ -n "$SSL_EXPIRY" ]; then
        print_test "pass" "SSL certificate is valid"
        echo -e "  ${SSL_EXPIRY}"
    else
        print_test "warn" "Could not verify SSL certificate expiry"
    fi
else
    print_test "warn" "Not using HTTPS (recommended for production)"
fi

echo ""
echo -e "${YELLOW}=== Security Headers ===${NC}"
echo ""

# Check security headers
HEADERS=$(curl -sI "$BASE_URL/api/health" --max-time "$TIMEOUT" 2>/dev/null || echo "")

if echo "$HEADERS" | grep -qi "x-powered-by"; then
    print_test "fail" "X-Powered-By header is exposed (should be removed)"
else
    print_test "pass" "X-Powered-By header is not exposed"
fi

if echo "$HEADERS" | grep -qi "strict-transport-security"; then
    print_test "pass" "HSTS header is set"
else
    print_test "warn" "HSTS header is not set (recommended for production)"
fi

if echo "$HEADERS" | grep -qi "x-content-type-options"; then
    print_test "pass" "X-Content-Type-Options header is set"
else
    print_test "warn" "X-Content-Type-Options header is not set"
fi

echo ""
echo -e "${YELLOW}=== Performance ===${NC}"
echo ""

# Check response time for 5 requests
echo "Measuring response times (5 samples)..."
RESPONSE_TIMES=()
for i in {1..5}; do
    START_TIME=$(date +%s%N)
    curl -s -o /dev/null "$BASE_URL/api/health" --max-time "$TIMEOUT" 2>/dev/null
    END_TIME=$(date +%s%N)
    ELAPSED=$((($END_TIME - $START_TIME) / 1000000))
    RESPONSE_TIMES+=($ELAPSED)
    echo -e "  Sample $i: ${ELAPSED}ms"
done

# Calculate average
SUM=0
for time in "${RESPONSE_TIMES[@]}"; do
    SUM=$((SUM + time))
done
AVG=$((SUM / 5))

echo -e "Average response time: ${GREEN}${AVG}ms${NC}"

if [ "$AVG" -lt 300 ]; then
    print_test "pass" "Average response time is excellent (<300ms)"
elif [ "$AVG" -lt 500 ]; then
    print_test "pass" "Average response time is good (<500ms)"
elif [ "$AVG" -lt 1000 ]; then
    print_test "warn" "Average response time is acceptable (<1000ms)"
else
    print_test "fail" "Average response time is slow (>1000ms)"
fi

echo ""
echo -e "${YELLOW}=== Environment Configuration ===${NC}"
echo ""

# Check if event listener is configured
HEALTH_RESPONSE_FULL=$(curl -s "$BASE_URL/api/health" --max-time "$TIMEOUT" 2>/dev/null || echo "{}")
echo "Checking environment configuration via Railway..."

# Check Railway environment variables (requires Railway CLI)
if command -v railway &> /dev/null && railway status &> /dev/null 2>&1; then
    # Check critical variables
    PROGRAM_ID=$(railway variables get PROGRAM_ID 2>/dev/null || echo "")
    SOLANA_RPC_URL=$(railway variables get SOLANA_RPC_URL 2>/dev/null || echo "")
    EVENT_LISTENER_ENABLED=$(railway variables get EVENT_LISTENER_ENABLED 2>/dev/null || echo "")

    if [ -n "$PROGRAM_ID" ]; then
        print_test "pass" "PROGRAM_ID is set: ${PROGRAM_ID}"
    else
        print_test "fail" "PROGRAM_ID is not set"
    fi

    if [ -n "$SOLANA_RPC_URL" ]; then
        print_test "pass" "SOLANA_RPC_URL is set"
    else
        print_test "fail" "SOLANA_RPC_URL is not set"
    fi

    if [ "$EVENT_LISTENER_ENABLED" = "true" ]; then
        print_test "pass" "Event listener is enabled"
    else
        print_test "warn" "Event listener is disabled"
    fi
else
    print_test "warn" "Cannot check Railway environment variables (Railway CLI not available or not linked)"
fi

echo ""
echo -e "${YELLOW}=== Summary ===${NC}"
echo ""

echo -e "Total Checks: ${BLUE}${TOTAL_CHECKS}${NC}"
echo -e "Passed: ${GREEN}${PASSED_CHECKS}${NC}"
echo -e "Failed: ${RED}${FAILED_CHECKS}${NC}"

SUCCESS_RATE=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))
echo -e "Success Rate: ${GREEN}${SUCCESS_RATE}%${NC}"

echo ""

if [ "$FAILED_CHECKS" -eq 0 ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}All Critical Checks Passed!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Your deployment appears to be healthy and ready for use."
    exit 0
else
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}Some Checks Failed${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo "Please review the failed checks and fix any issues."
    echo ""
    echo "Common troubleshooting steps:"
    echo "1. Check Railway logs: railway logs"
    echo "2. Verify environment variables: railway variables"
    echo "3. Check database migrations: railway run npx prisma migrate status"
    echo "4. Restart the service: railway restart"
    echo ""
    exit 1
fi
