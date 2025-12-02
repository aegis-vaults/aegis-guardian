#!/bin/bash
# Aegis Guardian - Production Smoke Test Script
# Tests critical API endpoints after deployment

set -e

BASE_URL="${1:-https://aegis-guardian-production.up.railway.app}"
VERBOSE="${2:-false}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Aegis Guardian - API Smoke Tests"
echo "=========================================="
echo "Target: $BASE_URL"
echo "Time: $(date)"
echo "=========================================="

TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to run test
run_test() {
  local test_name="$1"
  local endpoint="$2"
  local expected_status="${3:-200}"

  echo -n "Testing: $test_name ... "

  response=$(curl -s -w "\n%{http_code}" "$BASE_URL$endpoint")
  status_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$VERBOSE" = "true" ]; then
    echo ""
    echo "Response Body: $body"
  fi

  if [ "$status_code" -eq "$expected_status" ]; then
    echo -e "${GREEN}✓ PASSED${NC} (HTTP $status_code)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAILED${NC} (Expected HTTP $expected_status, got $status_code)"
    echo "Response: $body"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper function to test JSON response structure
run_json_test() {
  local test_name="$1"
  local endpoint="$2"
  local jq_filter="$3"
  local expected_value="$4"

  echo -n "Testing: $test_name ... "

  response=$(curl -s "$BASE_URL$endpoint")

  if [ "$VERBOSE" = "true" ]; then
    echo ""
    echo "Response: $response"
  fi

  if ! echo "$response" | jq . >/dev/null 2>&1; then
    echo -e "${RED}✗ FAILED${NC} (Invalid JSON)"
    echo "Response: $response"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  actual_value=$(echo "$response" | jq -r "$jq_filter")

  if [ "$actual_value" = "$expected_value" ]; then
    echo -e "${GREEN}✓ PASSED${NC} ($jq_filter = $actual_value)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAILED${NC} (Expected $jq_filter = $expected_value, got $actual_value)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

echo ""
echo "=== Core Endpoints ==="
echo ""

# Test 1: Health Check
run_json_test "Health Check - Status" "/api/health" ".status" "healthy"

# Test 2: Health Check - Database
run_json_test "Health Check - Database" "/api/health" ".services.database.status" "healthy"

# Test 3: Health Check - Redis
run_json_test "Health Check - Redis" "/api/health" ".services.redis.status" "healthy"

echo ""
echo "=== Vault Endpoints ==="
echo ""

# Test 4: List Vaults
run_json_test "List Vaults - Success" "/api/vaults?page=1&pageSize=10" ".success" "true"

# Test 5: List Vaults - Pagination
run_test "List Vaults - Pagination" "/api/vaults?page=1&pageSize=5" 200

# Test 6: List Vaults - Filter by Active
run_test "List Vaults - Filter Active" "/api/vaults?isActive=true" 200

echo ""
echo "=== Transaction Endpoints ==="
echo ""

# Test 7: List Transactions
run_json_test "List Transactions - Success" "/api/transactions?page=1&pageSize=10" ".success" "true"

# Test 8: List Transactions - Filter by Status
run_test "List Transactions - Filter EXECUTED" "/api/transactions?status=EXECUTED" 200

# Test 9: List Transactions - Filter by Status
run_test "List Transactions - Filter BLOCKED" "/api/transactions?status=BLOCKED" 200

echo ""
echo "=== Override Endpoints ==="
echo ""

# Test 10: List Overrides
run_json_test "List Overrides - Success" "/api/overrides?page=1&pageSize=10" ".success" "true"

# Test 11: List Overrides - Filter by Status
run_test "List Overrides - Filter PENDING" "/api/overrides?status=PENDING" 200

echo ""
echo "=== Analytics Endpoints ==="
echo ""

# Test 12: Global Analytics
run_json_test "Global Analytics - Success" "/api/analytics/global" ".success" "true"

# Test 13: Fee Analytics
run_test "Fee Analytics" "/api/analytics/fees" 200

echo ""
echo "=== Webhook Endpoints ==="
echo ""

# Test 14: List Webhooks
run_test "List Webhooks" "/api/webhooks" 200

echo ""
echo "=== Error Handling ==="
echo ""

# Test 15: Invalid Vault ID (404)
run_test "Invalid Vault ID" "/api/vaults/invalid-id-12345" 404

# Test 16: Invalid Transaction ID (404)
run_test "Invalid Transaction ID" "/api/transactions/invalid-id-12345" 404

# Test 17: Invalid Override ID (404)
run_test "Invalid Override ID" "/api/overrides/invalid-id-12345" 404

echo ""
echo "=== CORS Headers ==="
echo ""

# Test 18: CORS Preflight
echo -n "Testing: CORS Preflight ... "
cors_response=$(curl -s -X OPTIONS -H "Origin: https://aegis-vaults.xyz" -H "Access-Control-Request-Method: GET" "$BASE_URL/api/vaults" -w "\n%{http_code}")
cors_status=$(echo "$cors_response" | tail -n1)

if [ "$cors_status" -eq 200 ] || [ "$cors_status" -eq 204 ]; then
  echo -e "${GREEN}✓ PASSED${NC} (HTTP $cors_status)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗ FAILED${NC} (Expected HTTP 200/204, got $cors_status)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""
echo "=========================================="
echo "Test Results Summary"
echo "=========================================="
echo -e "Total Tests: $((TESTS_PASSED + TESTS_FAILED))"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo "=========================================="

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}All tests passed! ✓${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed. Please review the output above.${NC}"
  exit 1
fi
