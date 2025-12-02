# Aegis Guardian - Devnet Setup Guide

## Overview

This guide walks through configuring Aegis Guardian to connect to the devnet deployment of the Aegis Protocol.

**Program ID:** ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
**Cluster:** devnet
**RPC Endpoint:** https://api.devnet.solana.com

---

## Prerequisites

- Node.js 20+
- PostgreSQL 15+ (running and accessible)
- Redis 7+ (running and accessible)
- Aegis Protocol deployed to devnet

---

## Configuration Steps

### 1. Environment Configuration

Copy the devnet environment template:

```bash
cd /Users/ryankaelle/dev/Aegis/aegis-guardian

# Copy devnet environment file
cp .env.devnet .env

# Or create new .env with devnet settings
cat > .env << 'EOF'
# Solana Configuration - DEVNET
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com
SOLANA_CLUSTER=devnet
PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

# Database (update with your credentials)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aegis_guardian_devnet?schema=public

# Redis
REDIS_URL=redis://localhost:6379

# Event Listener
EVENT_LISTENER_ENABLED=true
EVENT_LISTENER_RESTART_DELAY=5000

# Application
NODE_ENV=development
PORT=3000
BASE_URL=http://localhost:3000
LOG_LEVEL=info

# Security (generate new secrets!)
JWT_SECRET=$(openssl rand -base64 32)
WEBHOOK_HMAC_SECRET=$(openssl rand -base64 32)

# API
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
CORS_ORIGINS=http://localhost:3001,http://localhost:3002

# Features
ANALYTICS_ENABLED=true
BLINK_GENERATION_ENABLED=true
WEBHOOKS_ENABLED=true
JOBS_ENABLED=true
EOF
```

### 2. Generate Security Secrets

```bash
# Generate JWT secret
echo "JWT_SECRET=$(openssl rand -base64 32)"

# Generate webhook HMAC secret
echo "WEBHOOK_HMAC_SECRET=$(openssl rand -base64 32)"
```

Add these to your `.env` file.

### 3. Copy Protocol IDL

```bash
# Create IDL directory if it doesn't exist
mkdir -p /Users/ryankaelle/dev/Aegis/aegis-guardian/src/lib/idl

# Copy IDL from protocol
cp /Users/ryankaelle/dev/Aegis/aegis-protocol/target/idl/aegis_core.json \
   /Users/ryankaelle/dev/Aegis/aegis-guardian/src/lib/idl/aegis_core.json

# Verify IDL copied
ls -lh /Users/ryankaelle/dev/Aegis/aegis-guardian/src/lib/idl/aegis_core.json
```

### 4. Database Setup

```bash
# Create devnet database
createdb aegis_guardian_devnet

# Or using psql
psql -U postgres -c "CREATE DATABASE aegis_guardian_devnet;"

# Run migrations
npx prisma migrate deploy

# Verify database
npx prisma db push
```

### 5. Install Dependencies

```bash
npm install

# Or if using Yarn
yarn install
```

### 6. Verify Configuration

```bash
# Check environment variables are loaded
npm run env:check

# Verify database connection
npx prisma db pull

# Verify Redis connection
npm run redis:ping
```

---

## Starting the Service

### Development Mode

```bash
npm run dev
```

Expected output:
```
[INFO] Starting Aegis Guardian...
[INFO] Environment: development
[INFO] Cluster: devnet
[INFO] Program ID: ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
[INFO] Database connected
[INFO] Redis connected
[INFO] Event listener starting...
[INFO] WebSocket connected to wss://api.devnet.solana.com
[INFO] Subscribed to program logs (subscription: <id>)
[INFO] Server listening on http://localhost:3000
```

### Production Mode (PM2)

```bash
# Install PM2 if not already installed
npm install -g pm2

# Start with PM2
pm2 start npm --name "aegis-guardian-devnet" -- run start

# View logs
pm2 logs aegis-guardian-devnet

# Monitor
pm2 monit

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
```

### Docker Mode

```bash
# Build Docker image
docker build -t aegis-guardian:devnet .

# Run container
docker run -d \
  --name aegis-guardian-devnet \
  --env-file .env \
  -p 3000:3000 \
  aegis-guardian:devnet

# View logs
docker logs -f aegis-guardian-devnet
```

---

## Verification Steps

### 1. Health Check

```bash
# Check API health
curl http://localhost:3000/api/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-12-02T...",
  "services": {
    "database": "connected",
    "redis": "connected",
    "eventListener": "connected",
    "solana": "connected"
  },
  "version": "1.0.0"
}
```

### 2. Event Listener Status

```bash
# Check event listener endpoint
curl http://localhost:3000/api/admin/event-listener/status

# Expected response:
{
  "status": "connected",
  "programId": "ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ",
  "cluster": "devnet",
  "subscriptionId": "<subscription-id>",
  "connectedAt": "2025-12-02T...",
  "eventsReceived": 0,
  "lastEventAt": null
}
```

### 3. Database Verification

```bash
# Check tables exist
psql $DATABASE_URL -c "\dt"

# Expected tables:
# vaults, transactions, events, analytics, webhooks, etc.

# Check events table
psql $DATABASE_URL -c "SELECT COUNT(*) FROM events;"
```

### 4. WebSocket Connection Test

Create a test file `test-websocket.ts`:

```typescript
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('wss://api.devnet.solana.com', 'confirmed');
const programId = new PublicKey('ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ');

console.log('Connecting to WebSocket...');

const subscriptionId = connection.onLogs(
  programId,
  (logs) => {
    console.log('Received logs:', logs);
  },
  'confirmed'
);

console.log('Subscribed with ID:', subscriptionId);
console.log('Waiting for events...');

// Keep process alive
process.stdin.resume();
```

Run:
```bash
npx ts-node test-websocket.ts
```

---

## Testing Event Flow

### 1. Initialize a Test Vault

```bash
cd /Users/ryankaelle/dev/Aegis/aegis-protocol

# Run test that creates a vault
anchor test --skip-build --skip-deploy -- --grep "initialize vault"
```

### 2. Verify Event Reception

Check Guardian logs:
```bash
# If using PM2
pm2 logs aegis-guardian-devnet | grep -i event

# If running directly
# Check console output for:
[INFO] Event received: VaultInitialized
[INFO] Event data: {...}
[INFO] Event stored in database (id: <uuid>)
```

### 3. Query Database

```bash
# Check events in database
psql $DATABASE_URL -c "
  SELECT
    id,
    event_type,
    program_id,
    created_at
  FROM events
  ORDER BY created_at DESC
  LIMIT 10;
"
```

### 4. Test REST API

```bash
# List vaults
curl http://localhost:3000/api/vaults

# Get specific vault (use vault address from test)
curl http://localhost:3000/api/vaults/<VAULT_ADDRESS>

# List transactions
curl http://localhost:3000/api/transactions
```

---

## Monitoring

### Log Files

```bash
# View application logs
tail -f logs/aegis-guardian.log

# View event listener logs
tail -f logs/event-listener.log

# View error logs
tail -f logs/error.log
```

### Metrics Endpoints

```bash
# Get metrics
curl http://localhost:3000/api/metrics

# Expected response:
{
  "vaults": {
    "total": 5,
    "active": 4
  },
  "transactions": {
    "total": 123,
    "blocked": 5,
    "executed": 118
  },
  "events": {
    "total": 150,
    "last24h": 45
  },
  "eventListener": {
    "status": "connected",
    "eventsReceived": 150,
    "lastEventAt": "2025-12-02T..."
  }
}
```

### Database Queries

```bash
# Total events received
psql $DATABASE_URL -c "SELECT COUNT(*) FROM events;"

# Events by type
psql $DATABASE_URL -c "
  SELECT event_type, COUNT(*) as count
  FROM events
  GROUP BY event_type
  ORDER BY count DESC;
"

# Recent events
psql $DATABASE_URL -c "
  SELECT event_type, created_at
  FROM events
  ORDER BY created_at DESC
  LIMIT 10;
"
```

---

## Troubleshooting

### Issue: Event Listener Not Connecting

**Symptoms:**
- No logs about WebSocket connection
- Health check shows eventListener: "disconnected"

**Solutions:**

1. Verify WebSocket URL:
```bash
grep SOLANA_WS_URL .env
# Should be: wss://api.devnet.solana.com
```

2. Test WebSocket connectivity:
```bash
npm install -g wscat
wscat -c wss://api.devnet.solana.com
```

3. Check program ID:
```bash
grep PROGRAM_ID .env
# Should be: ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

# Verify program exists
solana program show ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ --url devnet
```

4. Restart service:
```bash
pm2 restart aegis-guardian-devnet
```

### Issue: Database Connection Failed

**Symptoms:**
- "Database connection failed" in logs
- Health check shows database: "disconnected"

**Solutions:**

1. Verify PostgreSQL is running:
```bash
pg_isready

# Or check service
brew services list | grep postgresql
# Or on Linux:
systemctl status postgresql
```

2. Test connection:
```bash
psql $DATABASE_URL -c "SELECT 1;"
```

3. Check DATABASE_URL format:
```bash
# Should be: postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
grep DATABASE_URL .env
```

4. Verify database exists:
```bash
psql -U postgres -l | grep aegis_guardian_devnet
```

### Issue: No Events Being Received

**Symptoms:**
- Event listener connected
- No errors in logs
- But eventsReceived stays at 0

**Possible Causes:**

1. No transactions being sent to program:
```bash
# Check if any program accounts exist
solana program show ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ --url devnet
```

Solution: Run protocol tests to generate events:
```bash
cd /Users/ryankaelle/dev/Aegis/aegis-protocol
anchor test --skip-build --skip-deploy
```

2. Wrong program ID in Guardian config:
```bash
# Check .env
grep PROGRAM_ID .env

# Compare with deployed program
cat /Users/ryankaelle/dev/Aegis/aegis-protocol/Anchor.toml | grep aegis_core
```

3. WebSocket subscription not active:
```bash
# Check logs for subscription ID
pm2 logs aegis-guardian-devnet | grep -i subscr
```

### Issue: RPC Rate Limiting

**Symptoms:**
- 429 errors in logs
- Intermittent connection drops

**Solutions:**

1. Use dedicated RPC provider:
```bash
# Update .env with provider URL
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WS_URL=wss://devnet.helius-rpc.com/?api-key=YOUR_KEY
```

Recommended providers:
- Helius: https://helius.xyz
- RPCPool: https://rpcpool.com
- Quicknode: https://quicknode.com

2. Implement exponential backoff in event listener

3. Add request caching for frequently accessed data

---

## Performance Tuning

### Database Optimization

```sql
-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_program_id ON events(program_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_transactions_vault_id ON transactions(vault_id);
CREATE INDEX IF NOT EXISTS idx_vaults_owner ON vaults(owner);
```

### Connection Pooling

Update `.env`:
```env
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
```

### Redis Caching

Enable caching for frequently accessed data:
```env
REDIS_CACHE_ENABLED=true
REDIS_CACHE_TTL=300
```

---

## Production Checklist

Before deploying to production:

- [ ] All secrets generated with secure random values
- [ ] Database backups configured
- [ ] Monitoring and alerting set up
- [ ] Rate limiting configured
- [ ] CORS origins restricted to production domains
- [ ] Sentry or error tracking configured
- [ ] PM2 or production process manager configured
- [ ] SSL/TLS certificates configured
- [ ] Firewall rules configured
- [ ] Load balancer configured (if needed)
- [ ] Health checks configured in orchestration
- [ ] Log rotation configured
- [ ] Database connection pooling tuned
- [ ] Redis persistence configured

---

## Additional Resources

- Aegis Protocol Deployment Report: `/Users/ryankaelle/dev/Aegis/aegis-protocol/DEPLOYMENT_REPORT.md`
- Protocol Verification Script: `/Users/ryankaelle/dev/Aegis/aegis-protocol/scripts/verify-deployment.sh`
- RPC Testing Script: `/Users/ryankaelle/dev/Aegis/aegis-protocol/scripts/test-rpc.sh`
- Monitoring Script: `/Users/ryankaelle/dev/Aegis/aegis-protocol/scripts/monitor-deployment.sh`

---

## Support

For issues or questions:
1. Check logs: `pm2 logs aegis-guardian-devnet`
2. Review health check: `curl http://localhost:3000/api/health`
3. Verify protocol deployment: Run verification script
4. Check database: Query events table
5. Test WebSocket: Use test script provided above

---

**Last Updated:** 2025-12-02
