# Railway Environment Variables Configuration

## Critical Issue Fixed

The Guardian backend was returning **502 Bad Gateway** and **CORS errors** due to:

1. Missing or incorrect `CORS_ORIGINS` environment variable
2. Database/Redis connection failures not handled gracefully
3. Lazy connection initialization causing cold start issues

## Required Environment Variables for Production

### Step 1: Set CORS_ORIGINS in Railway

The most critical fix - add the frontend domain to allowed CORS origins:

```bash
railway variables --set CORS_ORIGINS="https://aegis-vaults.xyz,https://www.aegis-vaults.xyz"
```

Or via Railway Dashboard:
1. Go to aegis-guardian project in Railway
2. Navigate to Variables tab
3. Add variable:
   - **Name:** `CORS_ORIGINS`
   - **Value:** `https://aegis-vaults.xyz,https://www.aegis-vaults.xyz`

### Step 2: Verify Database URL

Ensure `DATABASE_URL` is set (usually auto-configured by Railway PostgreSQL):

```bash
railway variables
```

Should show:
- `DATABASE_URL=postgresql://...`

If missing, add PostgreSQL plugin in Railway dashboard.

### Step 3: Verify Redis URL

Ensure `REDIS_URL` is set (usually auto-configured by Railway Redis):

```bash
railway variables
```

Should show:
- `REDIS_URL=redis://...`

If missing, add Redis plugin in Railway dashboard.

**NOTE:** Redis failures are now non-blocking - the API will work without Redis, just without caching.

### Step 4: Verify Other Critical Variables

```bash
# Application
NODE_ENV=production
PORT=3000
BASE_URL=https://aegis-guardian-production.up.railway.app

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_CLUSTER=devnet
PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

# Logging
LOG_LEVEL=info
```

## Code Changes Made

### 1. Enhanced CORS Middleware (`src/middleware.ts`)

**Changes:**
- Added `.trim()` to CORS_ORIGINS parsing to handle whitespace
- Added debug logging for blocked origins in development
- Improved origin validation logic

**Before:**
```typescript
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : [...]
```

**After:**
```typescript
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
  : [...]

// Added debug logging
if (origin && !isAllowedOrigin && process.env.NODE_ENV === 'development') {
  console.log('[CORS] Blocked origin:', origin, 'Allowed:', allowedOrigins)
}
```

### 2. Graceful Redis Error Handling (`src/lib/redis.ts`)

**Changes:**
- Cache failures no longer throw errors
- Changed from `throw error` to `logger.warn()` for all cache operations
- API continues to work even if Redis is unavailable

**Methods updated:**
- `CacheService.set()` - Non-blocking cache writes
- `CacheService.delete()` - Non-blocking cache deletes
- `CacheService.deletePattern()` - Non-blocking pattern deletes

**Impact:** Application degrades gracefully without Redis - just loses caching benefit.

### 3. Database Error Handling (`src/app/api/vaults/route.ts`)

**Changes:**
- Added specific handling for Prisma connection errors
- Returns proper 503 status with helpful error message
- Distinguishes between connection errors and other failures

**Error types handled:**
- `PrismaClientKnownRequestError` - Known Prisma errors
- `PrismaClientInitializationError` - Connection/initialization failures
- `PrismaClientRustPanicError` - Critical Prisma runtime errors

**Response on database error:**
```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is temporarily unavailable. Please try again in a moment."
  }
}
```
Status: `503 Service Unavailable`

### 4. Added ServiceUnavailableError Type (`src/types/index.ts`)

**New error class:**
```typescript
export class ServiceUnavailableError extends ApiError {
  constructor(service: string, details?: unknown) {
    super(
      'SERVICE_UNAVAILABLE',
      `${service} is temporarily unavailable. Please try again later.`,
      503,
      details
    )
    this.name = 'ServiceUnavailableError'
  }
}
```

## Deployment Steps

### Option 1: Using Railway CLI (Recommended)

```bash
# 1. Navigate to guardian directory
cd /Users/ryankaelle/dev/aegis/aegis-guardian

# 2. Set CORS_ORIGINS
railway variables --set CORS_ORIGINS="https://aegis-vaults.xyz,https://www.aegis-vaults.xyz"

# 3. Verify all variables are set
railway variables

# 4. Deploy the fixed code
git add .
git commit -m "Fix: CORS configuration and graceful error handling for 502 errors"
git push origin main

# 5. Trigger Railway deployment
railway up --detach

# 6. Monitor deployment
railway logs --follow
```

### Option 2: Using Railway Dashboard

1. **Push code to git:**
   ```bash
   cd /Users/ryankaelle/dev/aegis/aegis-guardian
   git add .
   git commit -m "Fix: CORS configuration and graceful error handling for 502 errors"
   git push origin main
   ```

2. **Set environment variables in Railway Dashboard:**
   - Open Railway dashboard
   - Select aegis-guardian project
   - Go to Variables tab
   - Add/update `CORS_ORIGINS=https://aegis-vaults.xyz,https://www.aegis-vaults.xyz`

3. **Trigger deployment:**
   - Railway will auto-deploy on git push (if enabled)
   - Or manually trigger deployment in Railway dashboard

4. **Monitor logs:**
   - Check deployment logs in Railway dashboard
   - Or use: `railway logs --follow`

## Testing After Deployment

### 1. Health Check

```bash
curl https://aegis-guardian-production.up.railway.app/api/health
```

**Expected response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2025-12-02T...",
  "uptime": 123.45,
  "responseTime": 45,
  "services": {
    "database": { "status": "healthy" },
    "redis": { "status": "healthy" }
  },
  "version": "1.0.0"
}
```

**If database is unavailable (503):**
```json
{
  "status": "degraded",
  "services": {
    "database": { "status": "unhealthy" },
    "redis": { "status": "healthy" }
  }
}
```

### 2. Vaults API (CORS Test)

**From browser console on https://aegis-vaults.xyz:**
```javascript
fetch('https://aegis-guardian-production.up.railway.app/api/vaults')
  .then(r => r.json())
  .then(console.log)
  .catch(console.error)
```

**Expected response (200 OK):**
```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "total": 0,
      "page": 1,
      "pageSize": 20,
      "hasNext": false
    }
  }
}
```

**Should NOT see:**
- ❌ CORS error: "No 'Access-Control-Allow-Origin' header"
- ❌ 502 Bad Gateway

### 3. Direct API Test

```bash
# Test from command line
curl -H "Origin: https://aegis-vaults.xyz" \
  -H "Access-Control-Request-Method: GET" \
  -X OPTIONS \
  https://aegis-guardian-production.up.railway.app/api/vaults -v
```

**Check response headers should include:**
```
Access-Control-Allow-Origin: https://aegis-vaults.xyz
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Credentials: true
```

## Troubleshooting

### Still Getting CORS Errors?

1. **Verify CORS_ORIGINS is set correctly:**
   ```bash
   railway variables | grep CORS
   ```

2. **Check the exact origin being sent:**
   - Open browser DevTools → Network tab
   - Find the failed request
   - Check the `Origin` header value
   - Ensure it matches exactly what's in `CORS_ORIGINS`

3. **Common issues:**
   - Trailing slashes: `https://aegis-vaults.xyz/` ≠ `https://aegis-vaults.xyz`
   - www vs non-www: Add both variants
   - http vs https: Use https in production

### Still Getting 502 Errors?

1. **Check database connection:**
   ```bash
   railway run npx prisma db pull
   ```

2. **Check logs for startup errors:**
   ```bash
   railway logs --follow
   ```

3. **Common issues:**
   - Database not provisioned: Add PostgreSQL plugin in Railway
   - Database migrations not run: `railway run npx prisma migrate deploy`
   - Out of memory: Upgrade Railway plan

### Redis Issues (Non-Critical)

Redis failures no longer cause 502 errors. Check logs:
```bash
railway logs | grep -i redis
```

**If you see Redis errors:**
- API will continue to work (just slower without cache)
- Add Redis plugin in Railway dashboard if missing
- Check `REDIS_URL` is set correctly

## Monitoring

### Key Metrics to Watch

1. **Response Time:**
   - Without Redis: 100-300ms (database queries)
   - With Redis: 20-50ms (cached responses)

2. **Error Rates:**
   - 503 errors: Database connection issues
   - 500 errors: Application bugs
   - 429 errors: Rate limiting (working as intended)

3. **Health Check Status:**
   - Monitor `/api/health` endpoint
   - Set up uptime monitoring (UptimeRobot, etc.)

### Railway Logs

**Watch for these log patterns:**

**Good:**
```
INFO: Vaults listed (page=1, pageSize=20, total=5)
INFO: Redis client connected
INFO: Prisma client connected
```

**Concerning:**
```
WARN: Failed to set cache - continuing without cache
WARN: Redis client connection closed
```

**Critical:**
```
ERROR: Database connection error (code=P1001)
ERROR: Prisma client initialization failed
```

## Summary of Fixes

| Issue | Root Cause | Fix | Impact |
|-------|------------|-----|--------|
| CORS errors | Missing/incorrect CORS_ORIGINS env var | Set CORS_ORIGINS with frontend domain | Frontend can now call API |
| 502 Bad Gateway | Database connection failures during cold start | Graceful error handling with 503 responses | Better error messages, proper status codes |
| Cache errors causing 500s | Redis failures throwing errors | Non-blocking cache operations | API works without Redis |
| Poor error messages | Generic 500 errors | Specific error codes and messages | Easier debugging |

## Next Steps

1. **Monitor the deployment** for 24 hours
2. **Set up alerting** for 503 errors (indicates database issues)
3. **Configure uptime monitoring** for the health endpoint
4. **Review logs** for any remaining issues
5. **Consider adding Sentry** for error tracking in production

## Files Modified

1. `/Users/ryankaelle/dev/aegis/aegis-guardian/src/middleware.ts`
2. `/Users/ryankaelle/dev/aegis/aegis-guardian/src/lib/redis.ts`
3. `/Users/ryankaelle/dev/aegis/aegis-guardian/src/app/api/vaults/route.ts`
4. `/Users/ryankaelle/dev/aegis/aegis-guardian/src/types/index.ts`

All changes maintain backward compatibility and improve reliability.
