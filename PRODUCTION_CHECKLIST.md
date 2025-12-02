# Aegis Guardian - Production Deployment Checklist

**Target:** Railway (PostgreSQL + Redis)
**Solana Cluster:** Devnet
**Program ID:** ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

---

## Pre-Deployment Tasks

### 1. Secrets Generation

```bash
# Generate JWT Secret
openssl rand -base64 32
# Save output: ___________________________________________

# Generate Webhook HMAC Secret
openssl rand -base64 32
# Save output: ___________________________________________
```

- [ ] JWT_SECRET generated and saved securely
- [ ] WEBHOOK_HMAC_SECRET generated and saved securely

### 2. External Services Setup

- [ ] Solana RPC provider account created (Helius/QuickNode)
  - Provider: ___________
  - API Key: ___________
  - RPC URL: ___________
  - WebSocket URL: ___________

- [ ] Sentry account created (optional but recommended)
  - Project created: [ ]
  - DSN obtained: ___________

- [ ] Telegram Bot created (optional)
  - Bot Token: ___________

- [ ] SendGrid account created (optional)
  - API Key: ___________
  - From Email verified: ___________

- [ ] Stripe account configured (optional)
  - Secret Key: ___________
  - Webhook Secret: ___________

### 3. Repository Preparation

- [ ] All code committed to main branch
- [ ] Dependencies installed and lockfile updated
- [ ] Type checks passing (`npm run type-check`)
- [ ] Linting passing (`npm run lint`)

### 4. Static Assets

- [ ] IDL file copied to `public/idl/aegis_core.json`
  ```bash
  mkdir -p public/idl
  cp /Users/ryankaelle/dev/Aegis/aegis-protocol/target/idl/aegis_core.json public/idl/
  ```

- [ ] Icons created in `public/icons/`:
  - [ ] `aegis-vault.png`
  - [ ] `aegis-shield.png`
  - [ ] `aegis-blocked.png`

- [ ] All static assets committed to repository

---

## Railway Setup

### 1. Create Project

- [ ] Railway account created/logged in
- [ ] New project created
- [ ] GitHub repository connected
- [ ] Repository: `aegis-guardian` selected

### 2. Add Database Services

- [ ] PostgreSQL service added
  - [ ] `DATABASE_URL` automatically injected
  - [ ] Connection limit noted: ___________

- [ ] Redis service added
  - [ ] `REDIS_URL` automatically injected
  - [ ] Memory limit noted: ___________

### 3. Configure Build Settings

- [ ] Build command verified:
  ```bash
  npm install && npx prisma generate && npm run build
  ```

- [ ] Start command verified:
  ```bash
  npm run start
  ```

- [ ] Health check path set: `/api/health`

### 4. Environment Variables

Copy this list to Railway dashboard → Variables:

#### Required Variables

```bash
# Application
NODE_ENV=production
BASE_URL=https://your-app-name.up.railway.app
APP_VERSION=1.0.0
LOG_LEVEL=info
PORT=3000

# Solana
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WS_URL=wss://devnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_CLUSTER=devnet

# Program ID
AEGIS_PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

# Event Listener
EVENT_LISTENER_ENABLED=true
EVENT_LISTENER_RESTART_DELAY=5000
EVENT_LISTENER_MAX_RECONNECT_ATTEMPTS=10

# Database Pooling
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Security
JWT_SECRET=<your-generated-secret>
WEBHOOK_HMAC_SECRET=<your-generated-secret>
SESSION_TIMEOUT=3600

# API
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
CORS_ORIGINS=https://app.aegis.finance,https://aegis.finance

# Actions/Blinks
ACTIONS_BASE_URL=https://your-app-name.up.railway.app/api/actions
BLINK_ICON_VAULT=https://your-app-name.up.railway.app/icons/aegis-vault.png
BLINK_ICON_SHIELD=https://your-app-name.up.railway.app/icons/aegis-shield.png
BLINK_ICON_BLOCKED=https://your-app-name.up.railway.app/icons/aegis-blocked.png

# Webhooks
WEBHOOKS_ENABLED=true
WEBHOOK_MAX_RETRIES=3
WEBHOOK_RETRY_DELAY=1000
WEBHOOK_TIMEOUT=5000

# Background Jobs
JOBS_ENABLED=true
JOBS_CONCURRENCY=5
METRICS_CRON_SCHEDULE=0 0 * * *

# Features
ANALYTICS_ENABLED=true
BLINK_GENERATION_ENABLED=true
EXPERIMENTAL_FEATURES_ENABLED=false
REQUEST_TRACING_ENABLED=true

# Next.js
NEXT_PUBLIC_API_URL=https://your-app-name.up.railway.app
```

#### Optional Variables (if using)

```bash
# Monitoring
SENTRY_DSN=<your-sentry-dsn>
SENTRY_TRACES_SAMPLE_RATE=0.1

# Notifications
TELEGRAM_BOT_TOKEN=<your-bot-token>
SENDGRID_API_KEY=<your-sendgrid-key>
SENDGRID_FROM_EMAIL=noreply@aegis.finance

# Stripe
STRIPE_SECRET_KEY=<your-stripe-key>
STRIPE_WEBHOOK_SECRET=<your-stripe-webhook-secret>
STRIPE_PERSONAL_PRICE_ID=<price-id>
STRIPE_TEAM_PRICE_ID=<price-id>
STRIPE_ENTERPRISE_PRICE_ID=<price-id>
```

**Checklist:**

- [ ] All required variables added to Railway
- [ ] Optional variables added (if using features)
- [ ] BASE_URL updated with actual Railway URL
- [ ] ACTIONS_BASE_URL updated with actual Railway URL
- [ ] NEXT_PUBLIC_API_URL updated with actual Railway URL
- [ ] CORS_ORIGINS updated with actual frontend domains
- [ ] All icon URLs updated (if hosting on app)

---

## Deployment

### 1. Initial Deployment

- [ ] Code pushed to main branch
- [ ] Railway automatically triggered deployment
- [ ] Deployment succeeded (check Railway logs)
- [ ] Public URL generated: ___________

### 2. Run Database Migrations

**CRITICAL:** Must be done after first deployment.

```bash
# Option A: Railway CLI
railway login
railway link
railway run npx prisma migrate deploy
```

```bash
# Option B: Railway Dashboard
# Go to Settings → Deploy → Run Command:
npx prisma migrate deploy
```

- [ ] Migrations executed successfully
- [ ] No errors in migration logs

### 3. Update URLs

After getting the Railway public URL, update these variables:

- [ ] BASE_URL updated
- [ ] ACTIONS_BASE_URL updated
- [ ] NEXT_PUBLIC_API_URL updated
- [ ] BLINK_ICON_* URLs updated (if using app-hosted icons)

### 4. Redeploy (if URLs changed)

- [ ] Environment variables saved in Railway
- [ ] Manual redeploy triggered (or push to trigger)
- [ ] Deployment succeeded

---

## Post-Deployment Verification

### 1. Health Check

```bash
curl https://your-app-name.up.railway.app/api/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "services": {
    "database": { "status": "healthy" },
    "redis": { "status": "healthy" }
  }
}
```

- [ ] Health check returns 200 OK
- [ ] Database status is "healthy"
- [ ] Redis status is "healthy"

### 2. Event Listener

Check Railway logs for:

```
INFO: Event listener initialized
INFO: WebSocket event listener started
```

- [ ] Event listener started successfully
- [ ] No connection errors in logs

### 3. Smoke Tests

```bash
chmod +x scripts/smoke-test.sh
./scripts/smoke-test.sh https://your-app-name.up.railway.app
```

- [ ] All smoke tests passed
- [ ] No 500 errors
- [ ] All endpoints responding

### 4. Manual API Tests

```bash
# List vaults
curl https://your-app-name.up.railway.app/api/vaults

# Global analytics
curl https://your-app-name.up.railway.app/api/analytics/global

# List transactions
curl https://your-app-name.up.railway.app/api/transactions

# List overrides
curl https://your-app-name.up.railway.app/api/overrides
```

- [ ] Vaults endpoint working
- [ ] Analytics endpoint working
- [ ] Transactions endpoint working
- [ ] Overrides endpoint working

### 5. Blink/Actions Test

If you have a vault with an override:

```bash
curl https://your-app-name.up.railway.app/api/actions/YOUR_VAULT_ADDRESS/0
```

- [ ] Actions endpoint returns Blink metadata
- [ ] Icon URLs are accessible

### 6. Database Verification

```bash
railway run npx prisma db pull
```

- [ ] Schema matches `schema.prisma`
- [ ] All tables created
- [ ] Indexes present

### 7. Redis Verification

```bash
railway connect redis
INFO stats
DBSIZE
```

- [ ] Redis connected successfully
- [ ] Stats showing activity

---

## Monitoring Setup

### 1. Railway Metrics

- [ ] Railway dashboard bookmarked
- [ ] Logs page reviewed
- [ ] Metrics page reviewed
- [ ] Alert thresholds configured (if available)

### 2. Sentry (if enabled)

- [ ] Sentry project created
- [ ] SENTRY_DSN configured
- [ ] First error test sent:
  ```bash
  curl https://your-app-name.up.railway.app/api/test-error
  ```
- [ ] Error appears in Sentry dashboard

### 3. Custom Monitoring

- [ ] Uptime monitoring configured (UptimeRobot, Pingdom, etc.)
  - URL: https://your-app-name.up.railway.app/api/health
  - Interval: 5 minutes
  - Alert threshold: 2 consecutive failures

- [ ] Alert channels configured:
  - Email: ___________
  - Slack/Discord: ___________
  - PagerDuty: ___________

---

## Performance Optimization

### 1. Database Indexes

Run this SQL to verify indexes:

```sql
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

**Expected indexes:**
- `Vault`: owner, guardian, isActive, createdAt, userId
- `Transaction`: vaultId, status, from, to, createdAt, executedAt
- `Override`: vaultId, status, nonce, canExecuteAfter, createdAt

- [ ] All indexes present
- [ ] No missing indexes on frequently queried fields

### 2. Cache Performance

Check cache hit rate:

```bash
railway connect redis
INFO stats
```

Look for `keyspace_hits` and `keyspace_misses`.

Calculate hit rate: `hits / (hits + misses) * 100`

- [ ] Cache hit rate > 50% (after warm-up period)
- [ ] Cache eviction policy understood

### 3. API Response Times

Use the smoke test script with timing:

```bash
./scripts/smoke-test.sh https://your-app-name.up.railway.app true
```

**Target response times:**
- Health check: < 100ms
- List endpoints: < 200ms
- Single record: < 100ms
- Analytics: < 500ms

- [ ] Response times within targets
- [ ] No timeouts

---

## Security Audit

### 1. Secrets Management

- [ ] No secrets committed to repository
- [ ] `.env` files in `.gitignore`
- [ ] Railway environment variables use "sensitive" flag
- [ ] Team members have appropriate access levels

### 2. API Security

- [ ] CORS configured for specific origins (not "*")
- [ ] Rate limiting enabled
- [ ] Input validation with Zod on all endpoints
- [ ] No SQL injection vulnerabilities
- [ ] No XSS vulnerabilities

### 3. Network Security

- [ ] HTTPS enforced (Railway does this automatically)
- [ ] No sensitive data in logs
- [ ] Error messages don't leak internal details

### 4. Dependency Security

```bash
npm audit
```

- [ ] No critical vulnerabilities
- [ ] No high vulnerabilities (or mitigated)
- [ ] Dependencies up to date

---

## Documentation

- [ ] API endpoints documented (see DEPLOYMENT_GUIDE.md)
- [ ] Environment variables documented (see .env.production.template)
- [ ] Deployment process documented (see DEPLOYMENT_GUIDE.md)
- [ ] Team trained on:
  - Viewing Railway logs
  - Running smoke tests
  - Responding to alerts
  - Rolling back deployments

---

## Rollback Plan

### Prepare Rollback

- [ ] Previous working commit ID noted: ___________
- [ ] Rollback process documented below

### Rollback Steps

1. In Railway dashboard:
   - Go to Deployments tab
   - Find last working deployment
   - Click "Redeploy"

2. Via Git:
   ```bash
   git revert HEAD
   git push origin main
   ```

3. Via Railway CLI:
   ```bash
   railway rollback <deployment-id>
   ```

- [ ] Rollback process tested (in staging)
- [ ] Team knows how to execute rollback

---

## Go-Live Checklist

### Final Checks

- [ ] All items above completed
- [ ] No outstanding errors in Railway logs
- [ ] No outstanding errors in Sentry
- [ ] Health check passing for 15+ minutes
- [ ] Event listener receiving events (if on-chain activity exists)
- [ ] Smoke tests passing
- [ ] Performance within targets
- [ ] Security audit completed
- [ ] Team ready for monitoring

### Communication

- [ ] Frontend team notified of Guardian URL
- [ ] SDK updated with Guardian URL (if applicable)
- [ ] Status page updated (if applicable)
- [ ] Users notified (if public beta)

### Post-Launch Monitoring

Monitor for first 24 hours:
- Railway metrics (CPU, memory, requests)
- Error rate in Sentry
- API response times
- Event listener connection stability
- Database query performance

- [ ] 1 hour post-launch: No issues
- [ ] 4 hours post-launch: No issues
- [ ] 24 hours post-launch: No issues

---

## Success Criteria

The deployment is considered successful when:

1. ✓ Health check passing
2. ✓ All API endpoints responding correctly
3. ✓ Event listener receiving and processing on-chain events
4. ✓ Database migrations applied successfully
5. ✓ Redis caching working
6. ✓ No errors in logs for 1+ hour
7. ✓ Smoke tests passing
8. ✓ Performance within targets
9. ✓ Frontend can connect and retrieve data
10. ✓ Blinks/Actions working for override approvals

---

## Contacts

**Primary On-Call:**
- Name: ___________
- Phone: ___________
- Email: ___________

**Secondary On-Call:**
- Name: ___________
- Phone: ___________
- Email: ___________

**Infrastructure (Railway):**
- Railway Support: https://railway.app/help
- Railway Status: https://status.railway.app

**Solana RPC Provider:**
- Provider: ___________
- Support URL: ___________
- API Key Management: ___________

---

**Deployment Date:** ___________
**Deployed By:** ___________
**Railway URL:** ___________
**Commit SHA:** ___________

**Sign-Off:**
- Backend Lead: ___________
- DevOps Lead: ___________
- Product Manager: ___________
