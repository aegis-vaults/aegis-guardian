# Aegis Guardian Authentication

This document describes the authentication system implemented for the Aegis Guardian backend API.

## Overview

The Aegis Guardian API supports two authentication methods:

1. **API Key Authentication** (recommended for SDK and programmatic access)
2. **Header-based Authentication** (for development and internal services)

## API Key Authentication

### How It Works

API keys are long-lived tokens that authenticate requests to the Guardian API. Each key:
- Is associated with a specific user
- Can optionally be scoped to a specific vault
- Has configurable permissions
- Can have an expiration date
- Has rate limiting (default: 100 requests/minute)

### API Key Format

```
ak_live_<32-character-random-string>    # Production keys
ak_test_<32-character-random-string>    # Test keys
```

### Using API Keys

Include the API key in the `Authorization` header:

```http
GET /api/vaults?myVaults=true
Authorization: Bearer ak_live_abc123def456...
```

### API Key Lifecycle

#### 1. Create an API Key

```http
POST /api/api-keys
Authorization: Bearer <existing-key> OR x-user-id: <user-id>
Content-Type: application/json

{
  "name": "Production SDK Key",
  "environment": "live",
  "permissions": ["vault:read", "vault:write", "transaction:read"],
  "vaultId": "optional-vault-id-for-scoping",
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "apiKey": {
      "id": "clx1234567890",
      "name": "Production SDK Key",
      "prefix": "ak_live_abc1",
      "vaultId": null,
      "permissions": ["vault:read", "vault:write", "transaction:read"],
      "isActive": true,
      "rateLimit": 100,
      "expiresAt": "2026-12-31T23:59:59.000Z",
      "createdAt": "2025-12-02T10:00:00.000Z"
    },
    "key": "ak_live_abc123def456..."
  }
}
```

**⚠️ Important:** The full API key is only returned once during creation. Store it securely!

#### 2. List Your API Keys

```http
GET /api/api-keys?page=1&pageSize=20&isActive=true
Authorization: Bearer ak_live_abc123def456...
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "clx1234567890",
        "name": "Production SDK Key",
        "prefix": "ak_live_abc1",
        "vaultId": null,
        "permissions": ["vault:read", "vault:write"],
        "isActive": true,
        "lastUsedAt": "2025-12-02T10:30:00.000Z",
        "rateLimit": 100,
        "expiresAt": null,
        "createdAt": "2025-12-02T10:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "pageSize": 20,
      "hasNext": false
    }
  }
}
```

#### 3. Revoke an API Key

```http
DELETE /api/api-keys/clx1234567890
Authorization: Bearer ak_live_abc123def456...
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "API key revoked successfully"
  }
}
```

## Permissions System

API keys can have the following permissions:

- `*` - Full access (admin)
- `vault:read` - Read vault information
- `vault:write` - Create and update vaults
- `transaction:read` - Read transaction history
- `transaction:write` - Submit transactions

### Permission Enforcement

When using an API key:
- Header-based auth (x-user-id) has full permissions
- API keys without explicit permissions default to read-only access
- Permission checks are performed on sensitive operations

## Vault-Scoped API Keys

API keys can be scoped to a specific vault for enhanced security:

```http
POST /api/api-keys
Content-Type: application/json

{
  "name": "Vault-Specific Key",
  "vaultId": "clx_vault_12345",
  "permissions": ["vault:read", "transaction:read"]
}
```

**Behavior:**
- Key can only access data for the specified vault
- Attempts to access other vaults return `403 Forbidden`
- Useful for giving third-party integrations limited access

## Using with the Aegis SDK

### Installation

```bash
npm install @aegis/sdk
```

### Basic Usage

```typescript
import { GuardianClient } from '@aegis/sdk';

// Initialize with API key
const guardian = new GuardianClient({
  baseUrl: 'https://aegis-guardian-production.up.railway.app',
  apiKey: 'ak_live_abc123def456...'
});

// Fetch user's vaults
const vaults = await guardian.getVaults({ myVaults: true });

// Get transaction history
const transactions = await guardian.getTransactions({
  vaultId: 'clx_vault_12345',
  status: 'EXECUTED',
  page: 1,
  pageSize: 50
});

// Get vault analytics
const analytics = await guardian.getAnalytics('clx_vault_12345', {
  period: 'week'
});
```

### Error Handling

The SDK throws descriptive errors:

```typescript
try {
  const vault = await guardian.getVault('clx_vault_12345');
} catch (error) {
  if (error.response?.status === 401) {
    console.error('Authentication failed - check API key');
  } else if (error.response?.status === 403) {
    console.error('Access denied - insufficient permissions');
  } else if (error.response?.status === 429) {
    console.error('Rate limit exceeded - slow down requests');
  } else {
    console.error('Request failed:', error.message);
  }
}
```

## Header-Based Authentication (Development)

For development and internal services, you can use the `x-user-id` header:

```http
GET /api/vaults?myVaults=true
x-user-id: clx_user_12345
```

**⚠️ Warning:** This method should only be used in development or behind a gateway that verifies the user identity.

## Rate Limiting

Each API key has a configurable rate limit (default: 100 requests/minute).

**Response Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1701518400
```

**Rate Limit Exceeded:**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again in 30 seconds.",
    "retryAfter": 30
  }
}
```

## Security Best Practices

### For API Keys

1. **Store Securely**: Never commit API keys to version control
2. **Use Environment Variables**: Store keys in `.env` files or secret management systems
3. **Rotate Regularly**: Create new keys and revoke old ones periodically
4. **Scope Appropriately**: Use vault-scoped keys when possible
5. **Minimal Permissions**: Only grant permissions that are needed
6. **Monitor Usage**: Check `lastUsedAt` for suspicious activity

### For Production Deployments

```bash
# .env file
AEGIS_GUARDIAN_URL=https://aegis-guardian-production.up.railway.app
AEGIS_API_KEY=ak_live_abc123def456...
```

```typescript
// Production usage
const guardian = new GuardianClient({
  baseUrl: process.env.AEGIS_GUARDIAN_URL!,
  apiKey: process.env.AEGIS_API_KEY!
});
```

## API Endpoints Reference

### Protected Endpoints

These endpoints require authentication:

| Endpoint | Method | Auth Required | Description |
|----------|--------|---------------|-------------|
| `/api/api-keys` | GET | Yes | List user's API keys |
| `/api/api-keys` | POST | Yes | Create new API key |
| `/api/api-keys/:id` | GET | Yes | Get API key details |
| `/api/api-keys/:id` | DELETE | Yes | Revoke API key |
| `/api/vaults?myVaults=true` | GET | Yes | List user's vaults |
| `/api/vaults/:id` | PATCH | Yes | Update vault config |
| `/api/vaults/:id` | DELETE | Yes | Deactivate vault |
| `/api/transactions?myTransactions=true` | GET | Yes | List user's transactions |

### Public Endpoints

These endpoints work without authentication (but support optional auth for filtering):

| Endpoint | Method | Auth Optional | Description |
|----------|--------|---------------|-------------|
| `/api/vaults` | GET | Yes | List all vaults (or filter with auth) |
| `/api/vaults/:id` | GET | No | Get vault by ID |
| `/api/transactions` | GET | Yes | List transactions (or filter with auth) |
| `/api/health` | GET | No | Health check |

## Troubleshooting

### 401 Unauthorized

**Cause:** Missing or invalid API key

**Solution:**
- Verify API key is included in `Authorization: Bearer <key>` header
- Check that key hasn't been revoked
- Ensure key hasn't expired

### 403 Forbidden

**Cause:** Insufficient permissions or vault access denied

**Solution:**
- Verify API key has required permissions
- If vault-scoped, ensure accessing the correct vault
- Check that you own the resource you're trying to modify

### 429 Rate Limit Exceeded

**Cause:** Too many requests in a short time

**Solution:**
- Implement exponential backoff
- Check your rate limit: `GET /api/api-keys/:id`
- Consider requesting a higher rate limit

## Implementation Details

### API Key Storage

- API keys are hashed using SHA-256 before storage
- Only the hash is stored in the database
- Original key is only shown during creation

### Authentication Flow

```
1. Client sends request with Authorization header
2. Guardian extracts Bearer token
3. Validates token format (ak_live_* or ak_test_*)
4. Hashes token and looks up in database
5. Checks if key is active and not expired
6. Updates lastUsedAt timestamp
7. Attaches user and vault scope to request context
8. Proceeds with request handling
```

### Fallback Strategy

The authentication system tries API key first, then falls back to header-based auth:

```typescript
// In auth.ts
export async function getAuthUser(req: NextRequest): Promise<User | null> {
  // Try API key authentication first
  const apiKeyAuth = await validateApiKey(req)
  if (apiKeyAuth) {
    return apiKeyAuth.user
  }

  // Fall back to header-based authentication
  const userId = req.headers.get('x-user-id')
  if (!userId) {
    return null
  }

  // Fetch user from database...
}
```

## Migration Guide

If you're currently using header-based auth, here's how to migrate:

### Before (Header-based)

```typescript
fetch('https://aegis-guardian-production.up.railway.app/api/vaults', {
  headers: {
    'x-user-id': 'clx_user_12345'
  }
});
```

### After (API Key)

```typescript
// 1. Create an API key first (using existing auth)
const keyResponse = await fetch('https://aegis-guardian-production.up.railway.app/api/api-keys', {
  method: 'POST',
  headers: {
    'x-user-id': 'clx_user_12345',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Migration Key',
    permissions: ['*']
  })
});

const { data } = await keyResponse.json();
const apiKey = data.key; // Save this!

// 2. Use the API key going forward
fetch('https://aegis-guardian-production.up.railway.app/api/vaults?myVaults=true', {
  headers: {
    'Authorization': `Bearer ${apiKey}`
  }
});
```

## Support

For issues or questions:
- Check the Guardian API logs
- Verify authentication in the browser DevTools Network tab
- Review this documentation
- Open an issue in the aegis-guardian repository
