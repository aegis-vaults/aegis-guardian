# Aegis Guardian - Production Deployment Guide for Railway

**Last Updated:** 2025-12-02
**Target Environment:** Railway (PostgreSQL + Redis)
**Solana Cluster:** Devnet
**Program ID:** ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment Configuration](#environment-configuration)
3. [Database Setup](#database-setup)
4. [Railway Configuration](#railway-configuration)
5. [Deployment Steps](#deployment-steps)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Checklist

### 1. Required Accounts & Services

- [ ] Railway account created (https://railway.app)
- [ ] GitHub repository connected to Railway
- [ ] Solana RPC provider account (Helius/QuickNode recommended)
- [ ] Sentry account for error tracking (optional but recommended)

### 2. Required Secrets Generation

Generate these secrets locally before deployment:

```bash
# JWT Secret
openssl rand -base64 32

# Webhook HMAC Secret
openssl rand -base64 32
```

**IMPORTANT:** Save these secrets securely. You will need them for Railway environment variables.

### 3. IDL File

The IDL file is required for the Actions API to build transactions:

```bash
# Copy IDL from protocol to guardian
cp /Users/ryankaelle/dev/Aegis/aegis-protocol/target/idl/aegis_core.json \
   /Users/ryankaelle/dev/Aegis/aegis-guardian/public/idl/aegis_core.json
```

The IDL is currently hardcoded in `/src/app/api/actions/[vault]/[nonce]/route.ts`. For future improvements, consider loading it dynamically.

### 4. Static Assets

Ensure the following icon files exist in `/public/icons/`:

- `aegis-vault.png`
- `aegis-shield.png`
- `aegis-blocked.png`

These are used by the Blink/Actions API. If missing, provide placeholder images or update the environment variables to point to external URLs.

---

## Environment Configuration

### Step 1: Review the Template

Open `.env.production.template` and review all variables.

### Step 2: Prepare Environment Variables for Railway

Railway will automatically inject `DATABASE_URL` and `REDIS_URL` when you add those services. For other variables, prepare the following list:

#### Critical Variables (MUST SET):

```bash
# Application
NODE_ENV=production
BASE_URL=https://aegis-guardian-production.up.railway.app
APP_VERSION=1.0.0
LOG_LEVEL=info

# Solana - Use your RPC provider credentials
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY
SOLANA_WS_URL=wss://devnet.helius-rpc.com/?api-key=YOUR_API_KEY
SOLANA_CLUSTER=devnet

# Program ID (CONFIRMED)
AEGIS_PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

# Event Listener
EVENT_LISTENER_ENABLED=true

# Security (GENERATE THESE!)
JWT_SECRET=<your-generated-jwt-secret>
WEBHOOK_HMAC_SECRET=<your-generated-hmac-secret>

# Actions/Blink URLs
ACTIONS_BASE_URL=https://aegis-guardian-production.up.railway.app/api/actions
BLINK_ICON_VAULT=https://aegis-guardian-production.up.railway.app/icons/aegis-vault.png
BLINK_ICON_SHIELD=https://aegis-guardian-production.up.railway.app/icons/aegis-shield.png
BLINK_ICON_BLOCKED=https://aegis-guardian-production.up.railway.app/icons/aegis-blocked.png

# CORS
CORS_ORIGINS=https://aegis-vaults.xyz,https://www.aegis-vaults.xyz

# Next.js
NEXT_PUBLIC_API_URL=https://aegis-guardian-production.up.railway.app
```

#### Optional Variables:

```bash
# Monitoring (Highly Recommended)
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1

# Notifications (Optional)
TELEGRAM_BOT_TOKEN=<your-bot-token>
SENDGRID_API_KEY=<your-sendgrid-key>
SENDGRID_FROM_EMAIL=noreply@aegis.finance

# Stripe (Optional)
STRIPE_SECRET_KEY=<your-stripe-key>
STRIPE_WEBHOOK_SECRET=<your-stripe-webhook-secret>
```

---

## Database Setup

### Prisma Schema

The database schema is defined in `/prisma/schema.prisma`.

**Schema includes:**
- User accounts (linked to Solana wallets)
- Vaults (mirroring on-chain VaultConfig)
- Transactions (executed and blocked)
- Overrides (pending approval requests)
- Blinks (Actions API metadata)
- Webhooks (notification subscriptions)
- DailyMetrics (analytics aggregation)
- TeamMembers, FeeCollections, etc.

### Existing Migrations

Two migrations exist:

1. **20251202032036_init** - Initial schema
2. **20251202065256_add_override_fields** - Override fields update

These will be applied automatically during deployment.

### Connection Pooling

The application uses Prisma's connection pooling with the following defaults:

```typescript
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
```

Adjust these based on your Railway plan and expected load. Railway's free tier supports up to 20 connections.

---

## Railway Configuration

### Step 1: Create New Project

1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose `aegis-guardian` repository

### Step 2: Add PostgreSQL Service

1. Click "New Service"
2. Select "Database" → "PostgreSQL"
3. Railway will automatically set `DATABASE_URL` environment variable

### Step 3: Add Redis Service

1. Click "New Service"
2. Select "Database" → "Redis"
3. Railway will automatically set `REDIS_URL` environment variable

### Step 4: Configure Build Settings

Railway should auto-detect Next.js. Verify the following:

**Build Command:**
```bash
npm install && npx prisma generate && npm run build
```

**Start Command:**
```bash
npm run start
```

**Install Command:**
```bash
npm install
```

### Step 5: Add Environment Variables

In the Railway dashboard, go to your service → Variables tab and add all required variables from the [Environment Configuration](#environment-configuration) section.

**Critical:** Do NOT add `DATABASE_URL` or `REDIS_URL` manually - Railway injects these automatically.

### Step 6: Configure Health Checks

Railway automatically uses the health check defined in `railway.json`:

```json
{
  "healthcheckPath": "/api/health",
  "healthcheckTimeout": 10
}
```

The health check endpoint is implemented at `/src/app/api/health/route.ts` and verifies:
- Database connectivity
- Redis connectivity
- Service uptime
- Response time

---

## Deployment Steps

### Step 1: Prepare Local Environment

```bash
cd /Users/ryankaelle/dev/Aegis/aegis-guardian

# Ensure dependencies are installed
npm install

# Generate Prisma client
npx prisma generate

# Run type checks
npm run type-check

# Run linting
npm run lint
```

### Step 2: Copy IDL to Public Directory

```bash
# Create public/idl directory if it doesn't exist
mkdir -p public/idl

# Copy IDL from protocol
cp /Users/ryankaelle/dev/Aegis/aegis-protocol/target/idl/aegis_core.json \
   public/idl/aegis_core.json

# Commit to repository
git add public/idl/aegis_core.json
git commit -m "Add Aegis Protocol IDL for Actions API"
```

### Step 3: Add Placeholder Icons (if missing)

```bash
# Create icons directory
mkdir -p public/icons

# Add placeholder images or download actual icons
# Ensure these files exist:
# - public/icons/aegis-vault.png
# - public/icons/aegis-shield.png
# - public/icons/aegis-blocked.png
```

### Step 4: Commit and Push

```bash
git add .
git commit -m "Prepare for production deployment to Railway"
git push origin main
```

### Step 5: Deploy to Railway

Railway will automatically deploy when you push to the main branch.

Monitor deployment in Railway dashboard:
1. Go to your project
2. Click on the service
3. View "Deployments" tab
4. Watch build logs in real-time

### Step 6: Run Database Migrations

**IMPORTANT:** Migrations must be run after the first deployment.

#### Option A: Using Railway CLI (Recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Link to your project
railway link

# Run migrations
railway run npx prisma migrate deploy
```

#### Option B: Via Railway Dashboard

1. Go to your service in Railway
2. Click "Settings" → "Deploy"
3. Add a one-time command:
   ```bash
   npx prisma migrate deploy
   ```
4. Click "Run Command"

### Step 7: Verify Deployment

Railway will provide a public URL like:
```
https://aegis-guardian-production.up.railway.app
```

Update the following environment variables with this URL:
- `BASE_URL`
- `ACTIONS_BASE_URL`
- `NEXT_PUBLIC_API_URL`
- `BLINK_ICON_*` (if using app-hosted icons)

---

## Post-Deployment Verification

### 1. Health Check

```bash
curl https://aegis-guardian-production.up.railway.app/api/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-12-02T...",
  "uptime": 123.456,
  "responseTime": 45,
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

### 2. Verify Event Listener

Check Railway logs for:
```
INFO: Event listener initialized
INFO: WebSocket event listener started
```

If you don't see these logs, check:
- `EVENT_LISTENER_ENABLED=true` is set
- `PROGRAM_ID` is correct
- `SOLANA_RPC_URL` and `SOLANA_WS_URL` are accessible

### 3. Verify Database Connection

```bash
# Via Railway CLI
railway run npx prisma db pull
```

This should show your schema without errors.

### 4. API Endpoints Smoke Test

Use the provided smoke test script (see below) or manually test:

```bash
# List vaults
curl https://aegis-guardian-production.up.railway.app/api/vaults

# Get analytics
curl https://aegis-guardian-production.up.railway.app/api/analytics/global
```

### 5. Test Blink/Actions Endpoint

```bash
# Replace with actual vault and nonce
curl https://aegis-guardian-production.up.railway.app/api/actions/YOUR_VAULT_ADDRESS/0
```

**Expected Response:** Blink metadata JSON.

---

## Monitoring & Maintenance

### 1. Railway Logs

View logs in Railway dashboard:
1. Go to your service
2. Click "Logs" tab
3. Filter by log level (info, warn, error)

### 2. Prisma Studio (Development)

For debugging database issues:

```bash
railway run npx prisma studio
```

This opens a web UI at `http://localhost:5555` to view and edit database records.

### 3. Redis Monitoring

```bash
# Connect to Redis via Railway CLI
railway connect redis

# Inside Redis CLI:
INFO stats
DBSIZE
KEYS aegis:*
```

### 4. Event Listener Health

Monitor event listener connection:

```bash
# Check logs for:
grep "Event listener" railway.log
```

If event listener disconnects frequently:
- Check RPC provider rate limits
- Verify WebSocket endpoint stability
- Increase `EVENT_LISTENER_RESTART_DELAY`

### 5. Performance Metrics

Key metrics to monitor:
- **API response time:** Target < 200ms for 95th percentile
- **Database query time:** Target < 50ms average
- **Cache hit rate:** Target > 80%
- **Event processing lag:** Target < 5 seconds

Use Sentry Performance Monitoring for detailed insights.

### 6. Database Maintenance

#### Backups

Railway automatically backs up PostgreSQL. Configure retention in Railway dashboard.

#### Vacuum (Cleanup)

Run periodically to reclaim storage:

```bash
railway run npx prisma db execute --stdin < vacuum.sql
```

Create `vacuum.sql`:
```sql
VACUUM ANALYZE;
```

---

## Troubleshooting

### Issue: Health Check Failing

**Symptoms:** Railway shows service as unhealthy.

**Diagnosis:**
```bash
curl https://aegis-guardian-production.up.railway.app/api/health
```

**Common Causes:**
1. Database connection failed
   - Verify `DATABASE_URL` is set correctly
   - Check PostgreSQL service is running
   - Run migrations: `railway run npx prisma migrate deploy`

2. Redis connection failed
   - Verify `REDIS_URL` is set correctly
   - Check Redis service is running

3. Timeout
   - Increase `healthcheckTimeout` in `railway.json`

### Issue: Event Listener Not Receiving Events

**Symptoms:** No transaction/vault events in database.

**Diagnosis:**
Check logs for:
```
ERROR: Failed to start WebSocket listener
WARN: Retrying Redis connection
```

**Common Causes:**
1. Wrong Program ID
   - Verify `PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ`

2. RPC/WebSocket issues
   - Verify `SOLANA_RPC_URL` and `SOLANA_WS_URL` are correct
   - Test WebSocket manually:
     ```javascript
     const ws = new WebSocket('wss://devnet.helius-rpc.com/?api-key=YOUR_KEY');
     ws.onopen = () => console.log('Connected');
     ```

3. Rate limiting
   - Upgrade to paid RPC provider tier
   - Implement connection pooling

### Issue: Migrations Failing

**Symptoms:** Deployment succeeds but database schema is outdated.

**Diagnosis:**
```bash
railway run npx prisma migrate status
```

**Solution:**
```bash
# Deploy pending migrations
railway run npx prisma migrate deploy

# If migrations are corrupted, reset (CAUTION: loses data)
railway run npx prisma migrate reset --force
```

### Issue: CORS Errors

**Symptoms:** Frontend cannot access API.

**Diagnosis:** Check browser console for CORS errors.

**Solution:**
1. Add frontend domain to `CORS_ORIGINS`:
   ```
   CORS_ORIGINS=https://aegis-vaults.xyz,https://www.aegis-vaults.xyz
   ```

2. Verify CORS headers in API responses:
   ```bash
   curl -H "Origin: https://aegis-vaults.xyz" \
        -H "Access-Control-Request-Method: GET" \
        -X OPTIONS \
        https://aegis-guardian-production.up.railway.app/api/vaults
   ```

### Issue: Out of Memory

**Symptoms:** Railway service crashes with `ENOMEM`.

**Diagnosis:** Check Railway metrics for memory usage.

**Solutions:**
1. Optimize Prisma queries (select only needed fields)
2. Reduce `DATABASE_POOL_MAX`
3. Implement pagination on large queries
4. Upgrade Railway plan for more memory

### Issue: Slow API Responses

**Symptoms:** API endpoints take > 1 second.

**Diagnosis:**
1. Check database query performance:
   ```sql
   SELECT query, mean_exec_time, calls
   FROM pg_stat_statements
   ORDER BY mean_exec_time DESC
   LIMIT 10;
   ```

2. Check cache hit rate in Redis:
   ```bash
   railway connect redis
   INFO stats
   ```

**Solutions:**
1. Add database indexes for slow queries
2. Increase cache TTL for frequently accessed data
3. Optimize Prisma queries (use `select` to reduce payload)
4. Enable query result caching

---

## Smoke Test Script

Create a file `scripts/smoke-test.sh`:

```bash
#!/bin/bash
# Smoke test script for Aegis Guardian API

BASE_URL="${1:-https://aegis-guardian-production.up.railway.app}"

echo "Running smoke tests against: $BASE_URL"
echo "=========================================="

# Test 1: Health Check
echo "\n[TEST 1] Health Check"
curl -s "$BASE_URL/api/health" | jq .
if [ $? -eq 0 ]; then
  echo "✓ Health check passed"
else
  echo "✗ Health check failed"
  exit 1
fi

# Test 2: List Vaults
echo "\n[TEST 2] List Vaults"
curl -s "$BASE_URL/api/vaults?page=1&pageSize=10" | jq '.success'
if [ $? -eq 0 ]; then
  echo "✓ List vaults passed"
else
  echo "✗ List vaults failed"
  exit 1
fi

# Test 3: Global Analytics
echo "\n[TEST 3] Global Analytics"
curl -s "$BASE_URL/api/analytics/global" | jq '.success'
if [ $? -eq 0 ]; then
  echo "✓ Global analytics passed"
else
  echo "✗ Global analytics failed"
  exit 1
fi

# Test 4: List Transactions
echo "\n[TEST 4] List Transactions"
curl -s "$BASE_URL/api/transactions?page=1&pageSize=10" | jq '.success'
if [ $? -eq 0 ]; then
  echo "✓ List transactions passed"
else
  echo "✗ List transactions failed"
  exit 1
fi

# Test 5: List Overrides
echo "\n[TEST 5] List Overrides"
curl -s "$BASE_URL/api/overrides?page=1&pageSize=10" | jq '.success'
if [ $? -eq 0 ]; then
  echo "✓ List overrides passed"
else
  echo "✗ List overrides failed"
  exit 1
fi

echo "\n=========================================="
echo "All smoke tests passed! ✓"
```

Make it executable:
```bash
chmod +x scripts/smoke-test.sh
```

Run it:
```bash
./scripts/smoke-test.sh https://aegis-guardian-production.up.railway.app
```

---

## Production Readiness Checklist

Before going live:

### Security
- [ ] JWT_SECRET is cryptographically strong (32+ bytes)
- [ ] WEBHOOK_HMAC_SECRET is cryptographically strong (32+ bytes)
- [ ] CORS_ORIGINS is set to only allowed domains
- [ ] SSL/TLS enabled (Railway does this automatically)
- [ ] Rate limiting configured (`RATE_LIMIT_MAX=100`)

### Monitoring
- [ ] Sentry DSN configured for error tracking
- [ ] Railway metrics dashboard reviewed
- [ ] Health check endpoint returning 200
- [ ] Log level set to `info` or `warn` (not `debug`)

### Performance
- [ ] Database indexes added for frequently queried fields
- [ ] Redis caching enabled and working
- [ ] Connection pooling configured appropriately
- [ ] API response times < 500ms for 95th percentile

### Reliability
- [ ] Database migrations run successfully
- [ ] Event listener receiving and processing events
- [ ] Background jobs processing (if enabled)
- [ ] Graceful shutdown implemented (Railway handles SIGTERM)

### Documentation
- [ ] API endpoints documented
- [ ] Environment variables documented in `.env.production.template`
- [ ] Deployment runbook created (this document)
- [ ] Team trained on deployment process

---

## Migration Commands Reference

### Deploy Migrations (Production)
```bash
railway run npx prisma migrate deploy
```

### Check Migration Status
```bash
railway run npx prisma migrate status
```

### Generate Prisma Client
```bash
npx prisma generate
```

### Create New Migration (Development)
```bash
npx prisma migrate dev --name your_migration_name
```

### Reset Database (CAUTION: Loses all data)
```bash
railway run npx prisma migrate reset --force
```

### Seed Database (Optional)
```bash
railway run npm run db:seed
```

Note: You need to create `prisma/seed.ts` first if you want to seed initial data.

---

## Performance Recommendations

### 1. Connection Pooling

For Railway's Hobby plan (limited connections):
```
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=5
```

For Railway's Pro plan:
```
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20
```

### 2. Caching Strategy

Recommended TTLs:
- Vaults: 30 seconds (high frequency updates)
- Transactions: 60 seconds (append-only)
- Analytics: 300 seconds (computed data)
- Overrides: 10 seconds (time-sensitive)

### 3. Database Optimization

Add these indexes if not already present:

```sql
-- Vault indexes
CREATE INDEX IF NOT EXISTS idx_vault_owner ON "Vault"("owner");
CREATE INDEX IF NOT EXISTS idx_vault_guardian ON "Vault"("guardian");
CREATE INDEX IF NOT EXISTS idx_vault_active ON "Vault"("isActive");

-- Transaction indexes
CREATE INDEX IF NOT EXISTS idx_transaction_vault_status ON "Transaction"("vaultId", "status");
CREATE INDEX IF NOT EXISTS idx_transaction_created ON "Transaction"("createdAt" DESC);

-- Override indexes
CREATE INDEX IF NOT EXISTS idx_override_vault_status ON "Override"("vaultId", "status");
CREATE INDEX IF NOT EXISTS idx_override_nonce ON "Override"("nonce");
```

### 4. Query Optimization

Always use `select` to limit fields returned:

```typescript
// Bad (returns all fields)
const vaults = await prisma.vault.findMany()

// Good (returns only needed fields)
const vaults = await prisma.vault.findMany({
  select: {
    id: true,
    publicKey: true,
    owner: true,
    dailyLimit: true,
  }
})
```

---

## Contact & Support

For issues or questions:

- **GitHub Issues:** https://github.com/your-org/aegis-guardian/issues
- **Documentation:** https://docs.aegis.finance
- **Railway Support:** https://railway.app/help

---

**End of Deployment Guide**
