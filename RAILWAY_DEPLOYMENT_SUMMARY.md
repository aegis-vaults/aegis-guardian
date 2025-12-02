# Aegis Guardian - Railway Deployment Summary

**Date:** 2025-12-02
**Target Platform:** Railway (https://railway.app)
**Environment:** Production (Devnet)
**Program ID:** ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

---

## Quick Start

For detailed instructions, see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

### 1. Generate Secrets

```bash
# JWT Secret
openssl rand -base64 32

# Webhook HMAC Secret
openssl rand -base64 32
```

Save these for Railway environment variables.

### 2. Prepare Repository

```bash
# Copy IDL
mkdir -p public/idl
cp /Users/ryankaelle/dev/Aegis/aegis-protocol/target/idl/aegis_core.json public/idl/

# Ensure icons exist (or add placeholders)
ls public/icons/aegis-*.png

# Commit changes
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

### 3. Deploy to Railway

1. Create new Railway project
2. Connect GitHub repository
3. Add PostgreSQL service
4. Add Redis service
5. Add environment variables (see below)
6. Deploy will trigger automatically

### 4. Run Migrations

```bash
railway login
railway link
railway run npx prisma migrate deploy
```

### 5. Verify Deployment

```bash
# Run smoke tests
./scripts/smoke-test.sh https://your-app-name.up.railway.app

# Check health
curl https://your-app-name.up.railway.app/api/health
```

---

## Environment Variables for Railway

### Required (MUST SET)

```bash
# Application
NODE_ENV=production
BASE_URL=https://your-app-name.up.railway.app
APP_VERSION=1.0.0
LOG_LEVEL=info

# Solana (Use your RPC provider)
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WS_URL=wss://devnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_CLUSTER=devnet

# Program ID (CONFIRMED)
AEGIS_PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

# Event Listener
EVENT_LISTENER_ENABLED=true

# Security (GENERATE THESE!)
JWT_SECRET=<your-generated-secret>
WEBHOOK_HMAC_SECRET=<your-generated-secret>

# API
CORS_ORIGINS=https://app.aegis.finance,https://aegis.finance

# Actions/Blinks
ACTIONS_BASE_URL=https://your-app-name.up.railway.app/api/actions
BLINK_ICON_VAULT=https://your-app-name.up.railway.app/icons/aegis-vault.png
BLINK_ICON_SHIELD=https://your-app-name.up.railway.app/icons/aegis-shield.png
BLINK_ICON_BLOCKED=https://your-app-name.up.railway.app/icons/aegis-blocked.png

# Next.js
NEXT_PUBLIC_API_URL=https://your-app-name.up.railway.app
```

### Recommended

```bash
# Monitoring
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
```

### Optional

```bash
# Notifications
TELEGRAM_BOT_TOKEN=<bot-token>
SENDGRID_API_KEY=<api-key>

# Stripe
STRIPE_SECRET_KEY=<secret-key>
```

**Note:** Railway automatically provides `DATABASE_URL` and `REDIS_URL` when you add those services.

---

## File Structure

```
aegis-guardian/
├── .env.production.template    # Environment variables template
├── DEPLOYMENT_GUIDE.md         # Full deployment instructions
├── PRODUCTION_CHECKLIST.md     # Step-by-step checklist
├── DATABASE_MIGRATIONS.md      # Migration guide
├── API_DOCUMENTATION.md        # API endpoint reference
├── railway.json                # Railway configuration
├── package.json                # Dependencies and scripts
├── next.config.js              # Next.js configuration
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── migrations/            # Migration history
├── scripts/
│   ├── smoke-test.sh          # Post-deployment tests
│   └── start-listener.ts      # Event listener script
├── src/
│   ├── app/api/               # API routes
│   │   ├── health/            # Health check
│   │   ├── vaults/            # Vault endpoints
│   │   ├── transactions/      # Transaction endpoints
│   │   ├── overrides/         # Override endpoints
│   │   ├── analytics/         # Analytics endpoints
│   │   ├── webhooks/          # Webhook management
│   │   └── actions/           # Blinks/Actions API
│   └── lib/
│       ├── db.ts              # Prisma client
│       ├── redis.ts           # Redis client
│       ├── logger.ts          # Structured logging
│       └── services/
│           ├── event-listener.ts    # Solana event monitoring
│           ├── blink-generator.ts   # Blink generation
│           ├── notifications.ts     # Notification service
│           └── analytics.ts         # Analytics service
└── public/
    ├── idl/
    │   └── aegis_core.json    # Protocol IDL (MUST COPY)
    └── icons/
        ├── aegis-vault.png    # Vault icon
        ├── aegis-shield.png   # Shield icon
        └── aegis-blocked.png  # Blocked icon
```

---

## Key Components

### 1. Event Listener

**File:** `/src/lib/services/event-listener.ts`

Monitors Solana blockchain for Aegis Protocol events:
- VaultInitialized
- TransactionExecuted
- TransactionBlocked
- OverrideRequested
- OverrideApproved
- PolicyUpdated

**Configuration:**
- Uses WebSocket for devnet/mainnet
- Falls back to polling for localnet
- Auto-reconnects on disconnect
- Parses base64-encoded event data

### 2. Database (Prisma + PostgreSQL)

**Schema:** `/prisma/schema.prisma`

**Tables:**
- User, Vault, Transaction, Override
- Blink, Webhook, DailyMetrics
- TeamMember, FeeCollection

**Migrations:**
- `20251202032036_init` - Initial schema
- `20251202065256_add_override_fields` - Override enhancements

### 3. Caching (Redis)

**Implementation:** `/src/lib/redis.ts`

**Cached Data:**
- Vaults (30s TTL)
- Transactions (60s TTL)
- Analytics (300s TTL)

**Features:**
- Automatic reconnection
- Pattern-based invalidation
- JSON serialization

### 4. API Endpoints

**Routes:** `/src/app/api/`

**Endpoints:**
- GET /api/health - Health check
- GET /api/vaults - List vaults
- GET /api/transactions - List transactions
- GET /api/overrides - List override requests
- GET /api/analytics/global - Global analytics
- GET /api/actions/{vault}/{nonce} - Blink metadata
- POST /api/actions/{vault}/{nonce} - Generate approval transaction

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for full reference.

### 5. Blink Generation

**File:** `/src/lib/services/blink-generator.ts`

Generates Solana Actions (Blinks) for:
- Blocked transaction notifications
- Override approval requests

Integrates with Solana Actions API standard.

---

## Railway Configuration

### railway.json

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "numReplicas": 1,
    "startCommand": "node server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 10
  }
}
```

**Note:** Current railway.json references a Dockerfile. You may need to create one or update to use Next.js directly:

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm run start"
  }
}
```

### Build Process

Railway will:
1. Install dependencies (`npm install`)
2. Generate Prisma client (`npx prisma generate`)
3. Build Next.js (`npm run build`)
4. Start server (`npm run start`)

---

## Migration Commands

### Deploy Migrations (Production)
```bash
railway run npx prisma migrate deploy
```

### Check Status
```bash
railway run npx prisma migrate status
```

### View Database
```bash
railway run npx prisma studio
```

### Connect to PostgreSQL
```bash
railway connect postgres
```

### Connect to Redis
```bash
railway connect redis
```

---

## Monitoring

### Railway Dashboard

Monitor in real-time:
- CPU usage
- Memory usage
- Request volume
- Error rate
- Build/deployment status

### Health Check Endpoint

```bash
curl https://your-app-name.up.railway.app/api/health
```

**Response:**
```json
{
  "status": "healthy",
  "services": {
    "database": { "status": "healthy" },
    "redis": { "status": "healthy" }
  }
}
```

### Logs

View structured logs in Railway dashboard:
- Filter by level (info, warn, error)
- Search by message
- Track request IDs

### Sentry (Optional)

For advanced error tracking:
1. Create Sentry project
2. Add `SENTRY_DSN` to Railway
3. Errors automatically tracked

---

## Performance Targets

### API Response Times
- Health check: < 100ms
- List endpoints: < 200ms
- Single record: < 100ms
- Analytics: < 500ms

### Database
- Connection pool: 2-10 connections
- Query time: < 50ms average
- Index usage: > 90%

### Cache
- Hit rate: > 80% (after warm-up)
- TTL: 30-300s depending on data

### Event Listener
- Processing lag: < 5 seconds
- Reconnect time: < 10 seconds

---

## Security Checklist

- [ ] JWT_SECRET is cryptographically strong (32+ bytes)
- [ ] WEBHOOK_HMAC_SECRET is cryptographically strong (32+ bytes)
- [ ] CORS_ORIGINS set to specific domains (not "*")
- [ ] Rate limiting enabled (100 req/min)
- [ ] Input validation with Zod on all endpoints
- [ ] No secrets in repository
- [ ] SSL/TLS enabled (Railway default)
- [ ] Database connection uses SSL
- [ ] Error messages don't leak sensitive info

---

## Troubleshooting

### Event Listener Not Receiving Events

**Check:**
1. `EVENT_LISTENER_ENABLED=true`
2. `PROGRAM_ID` is correct
3. `SOLANA_RPC_URL` and `SOLANA_WS_URL` are accessible
4. Railway logs show "Event listener started"

**Solution:**
```bash
# View logs
railway logs

# Restart service
railway restart
```

### Database Migration Failed

**Check:**
```bash
railway run npx prisma migrate status
```

**Solution:**
```bash
# Reset and reapply (development only!)
railway run npx prisma migrate reset --force

# Or manually fix and mark as applied
railway run npx prisma migrate resolve --applied "<migration-name>"
```

### Health Check Failing

**Check:**
```bash
curl https://your-app-name.up.railway.app/api/health
```

**Common Issues:**
- Database not connected
- Redis not connected
- Service not fully started

**Solution:**
1. Verify `DATABASE_URL` and `REDIS_URL` are set
2. Check PostgreSQL and Redis services are running
3. View Railway logs for connection errors

### High Memory Usage

**Solutions:**
1. Reduce `DATABASE_POOL_MAX`
2. Optimize Prisma queries (use `select`)
3. Implement pagination on large queries
4. Upgrade Railway plan

---

## Performance Optimization

### Database Indexes

Verify indexes exist:
```sql
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public';
```

Add missing indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_vault_owner ON "Vault"("owner");
CREATE INDEX IF NOT EXISTS idx_transaction_vault_status
  ON "Transaction"("vaultId", "status");
```

### Query Optimization

Always use `select`:
```typescript
// Bad
await prisma.vault.findMany()

// Good
await prisma.vault.findMany({
  select: { id: true, publicKey: true, owner: true }
})
```

### Caching Strategy

Recommended TTLs:
- Vaults: 30s (frequent updates)
- Transactions: 60s (append-only)
- Analytics: 300s (computed data)
- Overrides: 10s (time-sensitive)

---

## Rollback Plan

### Via Railway Dashboard

1. Go to Deployments tab
2. Find last working deployment
3. Click "Redeploy"

### Via Railway CLI

```bash
railway rollback <deployment-id>
```

### Via Git

```bash
git revert HEAD
git push origin main
```

---

## Testing

### Smoke Tests

```bash
chmod +x scripts/smoke-test.sh
./scripts/smoke-test.sh https://your-app-name.up.railway.app
```

Tests:
- Health check
- Vaults API
- Transactions API
- Overrides API
- Analytics API
- CORS headers

### Manual Tests

```bash
# Health
curl https://your-app-name.up.railway.app/api/health

# Vaults
curl https://your-app-name.up.railway.app/api/vaults

# Analytics
curl https://your-app-name.up.railway.app/api/analytics/global
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | Complete deployment instructions |
| [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) | Step-by-step checklist |
| [DATABASE_MIGRATIONS.md](./DATABASE_MIGRATIONS.md) | Database migration guide |
| [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) | API endpoint reference |
| [.env.production.template](./.env.production.template) | Environment variables template |

---

## Support

**Railway Issues:**
- Railway Support: https://railway.app/help
- Railway Status: https://status.railway.app
- Railway Docs: https://docs.railway.app

**Aegis Issues:**
- GitHub Issues: https://github.com/your-org/aegis-guardian/issues
- Documentation: https://docs.aegis.finance

**Solana RPC Providers:**
- Helius: https://www.helius.dev
- QuickNode: https://www.quicknode.com
- RPCPool: https://rpcpool.com

---

## Next Steps After Deployment

1. **Update Frontend:**
   - Configure Guardian URL in frontend
   - Test API connectivity
   - Verify Blinks work in production

2. **Update SDK:**
   - Configure Guardian URL in SDK
   - Test analytics queries
   - Publish new SDK version

3. **Monitoring Setup:**
   - Configure uptime monitoring (UptimeRobot/Pingdom)
   - Set up Sentry (if not already)
   - Configure alert channels

4. **Documentation:**
   - Update README with production URL
   - Document any custom configurations
   - Create runbook for common operations

5. **Team Training:**
   - Share Railway dashboard access
   - Train team on viewing logs
   - Review rollback procedures

---

## Production Readiness Summary

✓ **Environment Configuration:**
- Template created (.env.production.template)
- All required variables documented
- Secrets generation instructions provided

✓ **Database:**
- Schema defined (prisma/schema.prisma)
- Migrations created and tested
- Migration commands documented

✓ **API Endpoints:**
- Health check implemented
- CRUD endpoints for all resources
- Pagination and filtering supported
- Error handling standardized

✓ **Event Listener:**
- WebSocket connection implemented
- Event parsing working
- Auto-reconnection configured
- Error handling robust

✓ **Caching:**
- Redis integration complete
- Cache invalidation strategy defined
- TTLs configured per data type

✓ **Monitoring:**
- Health check endpoint
- Structured logging (Pino)
- Sentry integration ready

✓ **Security:**
- Input validation (Zod)
- Rate limiting configured
- CORS properly set
- Secrets not in repository

✓ **Documentation:**
- Deployment guide complete
- API documentation complete
- Database migration guide complete
- Production checklist complete

✓ **Testing:**
- Smoke test script created
- Manual test commands provided
- Error scenarios documented

---

**Ready for Deployment:** Yes

**Recommended Next Review:** After first production deployment (verify all systems working)

**Estimated Deployment Time:** 30-60 minutes (including verification)

---

**Deployment Date:** ___________
**Deployed By:** ___________
**Railway URL:** ___________
**Status:** [ ] Success [ ] Issues (describe below)

**Notes:**
