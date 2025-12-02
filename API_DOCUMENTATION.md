# Aegis Guardian - API Documentation

**Base URL:** `https://aegis-guardian-production.up.railway.app`
**API Version:** v1
**Authentication:** Wallet signature-based (where required)

---

## Table of Contents

1. [Authentication](#authentication)
2. [Response Format](#response-format)
3. [Error Codes](#error-codes)
4. [Rate Limiting](#rate-limiting)
5. [Endpoints](#endpoints)
   - [Health Check](#health-check)
   - [Vaults](#vaults)
   - [Transactions](#transactions)
   - [Overrides](#overrides)
   - [Analytics](#analytics)
   - [Webhooks](#webhooks)
   - [Actions (Blinks)](#actions-blinks)

---

## Authentication

Most read endpoints are public. Write endpoints require wallet signature verification.

### Wallet Signature Authentication

For authenticated endpoints:

```typescript
// 1. Get message to sign from API
GET /api/auth/message?wallet=<wallet-address>

Response:
{
  "message": "Sign this message to authenticate: <nonce>",
  "nonce": "abc123..."
}

// 2. Sign message with wallet
const signature = await wallet.signMessage(message)

// 3. Include signature in subsequent requests
Authorization: Bearer <signature>
```

---

## Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    // Response data
  }
}
```

### Paginated Response

```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "total": 100,
      "page": 1,
      "pageSize": 20,
      "hasNext": true
    }
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": [] // Optional validation errors
  }
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `UNAUTHORIZED` | 401 | Authentication required or failed |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limiting

- **Default:** 100 requests per minute per IP
- **Headers:**
  - `X-RateLimit-Limit`: Maximum requests
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Reset timestamp

**Rate limit exceeded response:**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 60
  }
}
```

---

## Endpoints

### Health Check

#### GET `/api/health`

Check service health status.

**Authentication:** None

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-12-02T10:30:00.000Z",
  "uptime": 86400.5,
  "responseTime": 23,
  "services": {
    "database": {
      "status": "healthy"
    },
    "redis": {
      "status": "healthy"
    }
  },
  "version": "1.0.0"
}
```

**Status Codes:**
- `200`: All services healthy
- `503`: One or more services degraded

---

### Vaults

#### GET `/api/vaults`

List all vaults with pagination and filtering.

**Authentication:** None

**Query Parameters:**
- `page` (number, default: 1): Page number
- `pageSize` (number, default: 20, max: 100): Items per page
- `owner` (string, optional): Filter by owner address
- `guardian` (string, optional): Filter by guardian address
- `isActive` (boolean, optional): Filter by active status

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/vaults?page=1&pageSize=10&isActive=true"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "clxyz123",
        "publicKey": "VaultPDA1111111111111111111111111111111",
        "owner": "Owner111111111111111111111111111111111",
        "guardian": "Guardian1111111111111111111111111111",
        "dailyLimit": "1000000000",
        "dailySpent": "250000000",
        "lastResetTime": "1733140800",
        "whitelistEnabled": true,
        "whitelist": ["Address1...", "Address2..."],
        "overrideDelay": 3600,
        "pendingOverride": false,
        "isActive": true,
        "createdAt": "2025-12-01T10:00:00.000Z",
        "updatedAt": "2025-12-02T10:00:00.000Z",
        "_count": {
          "transactions": 42,
          "overrides": 3
        }
      }
    ],
    "pagination": {
      "total": 100,
      "page": 1,
      "pageSize": 10,
      "hasNext": true
    }
  }
}
```

---

#### GET `/api/vaults/{id}`

Get a specific vault by ID or public key.

**Authentication:** None

**Path Parameters:**
- `id`: Vault ID (cuid) or public key

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/vaults/clxyz123"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "id": "clxyz123",
    "publicKey": "VaultPDA1111111111111111111111111111111",
    "owner": "Owner111111111111111111111111111111111",
    "guardian": "Guardian1111111111111111111111111111",
    "name": "My Vault",
    "dailyLimit": "1000000000",
    "dailySpent": "250000000",
    "lastResetTime": "1733140800",
    "whitelistEnabled": true,
    "whitelist": ["Address1...", "Address2..."],
    "overrideDelay": 3600,
    "pendingOverride": false,
    "isActive": true,
    "createdAt": "2025-12-01T10:00:00.000Z",
    "updatedAt": "2025-12-02T10:00:00.000Z"
  }
}
```

**Error Responses:**
- `404`: Vault not found

---

#### POST `/api/vaults`

Create a new vault record. Typically called by the event listener, but can be used manually.

**Authentication:** None (in current implementation)

**Request Body:**
```json
{
  "publicKey": "VaultPDA1111111111111111111111111111111",
  "owner": "Owner111111111111111111111111111111111",
  "guardian": "Guardian1111111111111111111111111111",
  "dailyLimit": "1000000000",
  "overrideDelay": 3600
}
```

**Example Request:**
```bash
curl -X POST "https://aegis-guardian-production.up.railway.app/api/vaults" \
  -H "Content-Type: application/json" \
  -d '{
    "publicKey": "VaultPDA1111111111111111111111111111111",
    "owner": "Owner111111111111111111111111111111111",
    "guardian": "Guardian1111111111111111111111111111",
    "dailyLimit": "1000000000",
    "overrideDelay": 3600
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "clxyz123",
    "publicKey": "VaultPDA1111111111111111111111111111111",
    "owner": "Owner111111111111111111111111111111111",
    "guardian": "Guardian1111111111111111111111111111",
    "dailyLimit": "1000000000",
    "dailySpent": "0",
    "isActive": true,
    "createdAt": "2025-12-02T10:00:00.000Z"
  }
}
```

**Error Responses:**
- `400`: Invalid request body
- `409`: Vault already exists

---

### Transactions

#### GET `/api/transactions`

List all transactions with pagination and filtering.

**Authentication:** None

**Query Parameters:**
- `page` (number, default: 1): Page number
- `pageSize` (number, default: 20, max: 100): Items per page
- `vaultId` (string, optional): Filter by vault ID
- `status` (enum, optional): Filter by status (`PENDING`, `EXECUTED`, `BLOCKED`, `FAILED`)
- `from` (string, optional): Filter by sender address
- `to` (string, optional): Filter by recipient address

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/transactions?status=BLOCKED&page=1&pageSize=10"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "cltxn123",
        "signature": "5J7Kx...",
        "vaultId": "clxyz123",
        "from": "Sender11111111111111111111111111111111",
        "to": "Recipient111111111111111111111111111",
        "amount": "500000000",
        "status": "BLOCKED",
        "blockReason": "Daily limit exceeded",
        "blockedAt": "2025-12-02T10:00:00.000Z",
        "createdAt": "2025-12-02T10:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 50,
      "page": 1,
      "pageSize": 10,
      "hasNext": true
    }
  }
}
```

---

#### GET `/api/transactions/{id}`

Get a specific transaction by ID or signature.

**Authentication:** None

**Path Parameters:**
- `id`: Transaction ID (cuid) or signature

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/transactions/cltxn123"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "id": "cltxn123",
    "signature": "5J7Kx...",
    "vaultId": "clxyz123",
    "from": "Sender11111111111111111111111111111111",
    "to": "Recipient111111111111111111111111111",
    "amount": "500000000",
    "instruction": "...",
    "status": "BLOCKED",
    "blockReason": "Daily limit exceeded",
    "blockedAt": "2025-12-02T10:00:00.000Z",
    "slot": "123456789",
    "blockTime": "1733140800",
    "createdAt": "2025-12-02T10:00:00.000Z",
    "vault": {
      "publicKey": "VaultPDA1111111111111111111111111111111",
      "owner": "Owner111111111111111111111111111111111"
    }
  }
}
```

---

### Overrides

#### GET `/api/overrides`

List all override requests with pagination and filtering.

**Authentication:** None

**Query Parameters:**
- `page` (number, default: 1): Page number
- `pageSize` (number, default: 20, max: 100): Items per page
- `vaultId` (string, optional): Filter by vault ID
- `status` (enum, optional): Filter by status (`PENDING`, `APPROVED`, `EXECUTED`, `CANCELLED`, `EXPIRED`)

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/overrides?status=PENDING"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "clovr123",
        "vaultId": "clxyz123",
        "transactionId": "5J7Kx...",
        "nonce": "1",
        "requestedBy": "Owner111111111111111111111111111111111",
        "requestedAmount": "500000000",
        "destination": "Recipient111111111111111111111111111",
        "canExecuteAfter": "1733144400",
        "expiresAt": "1733148000",
        "status": "PENDING",
        "blinkUrl": "https://aegis-guardian-production.up.railway.app/api/actions/VaultPDA.../1",
        "createdAt": "2025-12-02T10:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 10,
      "page": 1,
      "pageSize": 20,
      "hasNext": false
    }
  }
}
```

---

#### GET `/api/overrides/{id}`

Get a specific override request.

**Authentication:** None

**Path Parameters:**
- `id`: Override ID (cuid)

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/overrides/clovr123"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "id": "clovr123",
    "vaultId": "clxyz123",
    "transactionId": "5J7Kx...",
    "nonce": "1",
    "requestedBy": "Owner111111111111111111111111111111111",
    "requestedAmount": "500000000",
    "destination": "Recipient111111111111111111111111111",
    "canExecuteAfter": "1733144400",
    "expiresAt": "1733148000",
    "status": "PENDING",
    "blinkUrl": "https://aegis-guardian-production.up.railway.app/api/actions/VaultPDA.../1",
    "createdAt": "2025-12-02T10:00:00.000Z",
    "vault": {
      "publicKey": "VaultPDA1111111111111111111111111111111",
      "owner": "Owner111111111111111111111111111111111",
      "guardian": "Guardian1111111111111111111111111111"
    }
  }
}
```

---

### Analytics

#### GET `/api/analytics/global`

Get global analytics across all vaults.

**Authentication:** None

**Query Parameters:**
- `startDate` (ISO date, optional): Start date for metrics
- `endDate` (ISO date, optional): End date for metrics

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/analytics/global"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "totalVaults": 150,
    "activeVaults": 120,
    "totalTransactions": 5000,
    "executedTransactions": 4200,
    "blockedTransactions": 800,
    "volumeTotal": "50000000000",
    "volumeExecuted": "42000000000",
    "volumeBlocked": "8000000000",
    "overridesRequested": 50,
    "overridesApproved": 40,
    "overridesExecuted": 35
  }
}
```

---

#### GET `/api/analytics/{vault}`

Get analytics for a specific vault.

**Authentication:** None

**Path Parameters:**
- `vault`: Vault ID or public key

**Query Parameters:**
- `startDate` (ISO date, optional): Start date for metrics
- `endDate` (ISO date, optional): End date for metrics

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/analytics/VaultPDA1111111111111111111111111111111"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "vaultId": "clxyz123",
    "publicKey": "VaultPDA1111111111111111111111111111111",
    "totalTransactions": 100,
    "executedTransactions": 85,
    "blockedTransactions": 15,
    "volumeTotal": "10000000000",
    "volumeExecuted": "8500000000",
    "volumeBlocked": "1500000000",
    "overridesRequested": 5,
    "overridesApproved": 4,
    "dailyLimit": "1000000000",
    "dailySpent": "250000000",
    "dailyRemaining": "750000000",
    "utilizationRate": 0.25
  }
}
```

---

#### GET `/api/analytics/{vault}/spending-trend`

Get spending trend over time for a vault.

**Authentication:** None

**Path Parameters:**
- `vault`: Vault ID or public key

**Query Parameters:**
- `days` (number, default: 30): Number of days to include

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/analytics/VaultPDA.../spending-trend?days=7"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "vaultId": "clxyz123",
    "trend": [
      {
        "date": "2025-12-01",
        "executed": "500000000",
        "blocked": "100000000",
        "transactionCount": 12
      },
      {
        "date": "2025-12-02",
        "executed": "750000000",
        "blocked": "50000000",
        "transactionCount": 18
      }
    ]
  }
}
```

---

#### GET `/api/analytics/fees`

Get fee collection analytics.

**Authentication:** None

**Query Parameters:**
- `startDate` (ISO date, optional): Start date
- `endDate` (ISO date, optional): End date

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/analytics/fees"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "totalFeesCollected": "50000000",
    "feeCount": 1000,
    "averageFee": "50000",
    "byVault": [
      {
        "vaultId": "clxyz123",
        "totalFees": "10000000",
        "count": 200
      }
    ]
  }
}
```

---

### Webhooks

#### GET `/api/webhooks`

List all webhook subscriptions.

**Authentication:** Required (wallet signature)

**Query Parameters:**
- `vaultId` (string, optional): Filter by vault ID

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/webhooks" \
  -H "Authorization: Bearer <signature>"
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "clwhk123",
      "url": "https://your-app.com/webhook",
      "vaultId": "clxyz123",
      "events": [
        "TRANSACTION_BLOCKED",
        "OVERRIDE_REQUESTED"
      ],
      "isActive": true,
      "lastSuccess": "2025-12-02T10:00:00.000Z",
      "failureCount": 0,
      "createdAt": "2025-12-01T10:00:00.000Z"
    }
  ]
}
```

---

#### POST `/api/webhooks`

Create a new webhook subscription.

**Authentication:** Required (wallet signature)

**Request Body:**
```json
{
  "url": "https://your-app.com/webhook",
  "vaultId": "clxyz123",
  "events": [
    "TRANSACTION_BLOCKED",
    "OVERRIDE_REQUESTED"
  ],
  "secret": "your-webhook-secret"
}
```

**Example Request:**
```bash
curl -X POST "https://aegis-guardian-production.up.railway.app/api/webhooks" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <signature>" \
  -d '{
    "url": "https://your-app.com/webhook",
    "events": ["TRANSACTION_BLOCKED"]
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "clwhk123",
    "url": "https://your-app.com/webhook",
    "secret": "generated-hmac-secret",
    "events": ["TRANSACTION_BLOCKED"],
    "isActive": true
  }
}
```

---

#### DELETE `/api/webhooks/{id}`

Delete a webhook subscription.

**Authentication:** Required (wallet signature)

**Path Parameters:**
- `id`: Webhook ID

**Example Request:**
```bash
curl -X DELETE "https://aegis-guardian-production.up.railway.app/api/webhooks/clwhk123" \
  -H "Authorization: Bearer <signature>"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Webhook deleted successfully"
  }
}
```

---

### Actions (Blinks)

Actions API for Solana Blinks integration.

#### GET `/api/actions/{vault}/{nonce}`

Get Blink metadata for an override approval.

**Authentication:** None

**Path Parameters:**
- `vault`: Vault public key
- `nonce`: Override nonce

**Example Request:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/actions/VaultPDA.../1"
```

**Example Response:**
```json
{
  "type": "action",
  "icon": "https://aegis-guardian-production.up.railway.app/icons/aegis-shield.png",
  "title": "Approve Aegis Override",
  "description": "Approve override request #1 for vault VaultPDA...",
  "label": "Approve",
  "links": {
    "actions": [
      {
        "label": "Approve",
        "href": "https://aegis-guardian-production.up.railway.app/api/actions/VaultPDA.../1"
      }
    ]
  }
}
```

---

#### POST `/api/actions/{vault}/{nonce}`

Generate unsigned transaction for override approval.

**Authentication:** None (transaction must be signed by vault owner)

**Path Parameters:**
- `vault`: Vault public key
- `nonce`: Override nonce

**Request Body:**
```json
{
  "account": "OwnerWalletAddress111111111111111111111"
}
```

**Example Request:**
```bash
curl -X POST "https://aegis-guardian-production.up.railway.app/api/actions/VaultPDA.../1" \
  -H "Content-Type: application/json" \
  -d '{"account": "OwnerWalletAddress111111111111111111111"}'
```

**Example Response:**
```json
{
  "transaction": "base64-encoded-transaction",
  "message": "Approve override #1"
}
```

**Error Responses:**
- `400`: Override expired or not pending
- `401`: Unauthorized (not vault owner)
- `404`: Vault or override not found

---

## Webhook Payloads

When events occur, Guardian sends POST requests to registered webhook URLs.

### Webhook Headers

```
Content-Type: application/json
X-Aegis-Signature: sha256=<hmac-signature>
X-Aegis-Event: <event-type>
X-Aegis-Delivery: <unique-delivery-id>
```

### Signature Verification

```typescript
import crypto from 'crypto'

function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(payload)
  const expectedSignature = `sha256=${hmac.digest('hex')}`
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )
}
```

### Event Payloads

#### TRANSACTION_BLOCKED

```json
{
  "event": "TRANSACTION_BLOCKED",
  "timestamp": "2025-12-02T10:00:00.000Z",
  "data": {
    "transactionId": "cltxn123",
    "signature": "5J7Kx...",
    "vaultId": "clxyz123",
    "vaultPublicKey": "VaultPDA...",
    "from": "Sender...",
    "to": "Recipient...",
    "amount": "500000000",
    "blockReason": "Daily limit exceeded"
  }
}
```

#### OVERRIDE_REQUESTED

```json
{
  "event": "OVERRIDE_REQUESTED",
  "timestamp": "2025-12-02T10:00:00.000Z",
  "data": {
    "overrideId": "clovr123",
    "vaultId": "clxyz123",
    "vaultPublicKey": "VaultPDA...",
    "nonce": "1",
    "requestedBy": "Owner...",
    "canExecuteAfter": "1733144400",
    "expiresAt": "1733148000",
    "blinkUrl": "https://aegis-guardian-production.up.railway.app/api/actions/VaultPDA.../1"
  }
}
```

---

## CORS Configuration

CORS is configured via `CORS_ORIGINS` environment variable.

**Allowed Origins:**
- Development: `http://localhost:3000`, `http://localhost:3001`
- Production: Specified in `CORS_ORIGINS`

**Preflight Requests:**
All endpoints support OPTIONS requests for CORS preflight.

---

## WebSocket (Real-Time Updates)

*Coming soon: Real-time updates via WebSocket connection*

Planned features:
- Subscribe to vault updates
- Real-time transaction notifications
- Override status changes

---

## SDK Integration

The Aegis SDK queries Guardian API for analytics and vault information.

**Example SDK Usage:**
```typescript
import { AegisSDK } from '@aegis/sdk'

const sdk = new AegisSDK({
  guardianUrl: 'https://aegis-guardian-production.up.railway.app',
  cluster: 'devnet'
})

// Get vault info
const vault = await sdk.getVault('VaultPDA...')

// Get transactions
const transactions = await sdk.getTransactions({
  vaultId: vault.id,
  status: 'BLOCKED'
})
```

---

## Contact & Support

For API issues:
- GitHub Issues: https://github.com/your-org/aegis-guardian/issues
- Documentation: https://docs.aegis.finance
- Discord: https://discord.gg/aegis

---

**End of API Documentation**
