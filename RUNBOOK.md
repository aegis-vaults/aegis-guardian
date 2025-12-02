# Aegis Guardian Operations Runbook

This runbook provides procedures for common operational scenarios and incident response.

## Table of Contents

- [Service Overview](#service-overview)
- [Common Alerts](#common-alerts)
- [Incident Response](#incident-response)
- [Maintenance Procedures](#maintenance-procedures)
- [Performance Tuning](#performance-tuning)
- [Disaster Recovery](#disaster-recovery)

## Service Overview

### Architecture

```
┌─────────────────┐
│   Railway       │
│  Load Balancer  │
└────────┬────────┘
         │
┌────────▼────────┐
│  Guardian API   │  (Next.js)
│  Port 3000      │
└────┬───────┬────┘
     │       │
     │       └──────┐
     │              │
┌────▼───────┐ ┌───▼────────┐
│ PostgreSQL │ │   Redis    │
│ (Railway)  │ │ (Railway)  │
└────────────┘ └────────────┘
```

### Key Components

- **Guardian API**: Next.js application handling REST API and WebSocket
- **PostgreSQL**: Primary data store for vaults, transactions, users
- **Redis**: Cache and job queue (Bull/BullMQ)
- **Event Listener**: WebSocket connection to Solana RPC for on-chain events

### Health Check

**Endpoint**: `GET /api/health`

**Expected Response**:
```json
{
  "status": "healthy",
  "services": {
    "database": { "status": "healthy" },
    "redis": { "status": "healthy" }
  },
  "uptime": 12345,
  "responseTime": 45
}
```

### Service Dependencies

1. **PostgreSQL** (Critical): Service cannot start without database
2. **Redis** (Critical): Required for caching and jobs
3. **Solana RPC** (High): Required for event listener
4. **SendGrid** (Low): Optional, for email notifications
5. **Stripe** (Medium): Optional, for subscriptions

## Common Alerts

### Alert: Service Down

**Symptom**: Health check returns 5xx or times out

**Impact**: All API requests fail, no new transactions processed

**Diagnosis**:
```bash
# Check service status
railway status

# Check recent logs
railway logs --tail 100

# Check resource usage
# (View in Railway dashboard)
```

**Common Causes**:
1. Out of memory
2. Database connection failed
3. Unhandled exception causing crash
4. Railway platform issue

**Resolution**:

1. **Check if Railway is experiencing issues**:
   - Visit https://railway.statuspage.io

2. **Check logs for errors**:
   ```bash
   railway logs | grep -i error
   ```

3. **Restart service**:
   ```bash
   railway restart
   ```

4. **If restart doesn't help, rollback**:
   ```bash
   railway rollback
   ```

5. **Check resource limits**:
   - View metrics in Railway dashboard
   - Consider scaling up if consistently hitting limits

**Escalation**: If issue persists after rollback, contact Railway support and team lead.

---

### Alert: Database Connection Failed

**Symptom**: Health check shows database: unhealthy

**Impact**: API returns 503, no data can be read or written

**Diagnosis**:
```bash
# Check database status in Railway dashboard
# Try connecting manually
railway run npx prisma db push --preview-feature
```

**Common Causes**:
1. Database is down or restarting
2. Connection pool exhausted
3. Network issue
4. Invalid DATABASE_URL

**Resolution**:

1. **Check Railway database status**:
   - View Railway dashboard
   - Check database metrics

2. **Verify DATABASE_URL**:
   ```bash
   railway variables get DATABASE_URL
   ```

3. **Check connection pool**:
   - Default max connections: 10
   - Check if hitting limit in logs

4. **Restart database** (from Railway dashboard)

5. **If persistent, check migrations**:
   ```bash
   railway run npx prisma migrate status
   ```

**Escalation**: Contact Railway support if database service is unavailable.

---

### Alert: Redis Connection Failed

**Symptom**: Health check shows redis: unhealthy

**Impact**: Degraded performance, no caching, job queue stopped

**Diagnosis**:
```bash
# Check Redis status in Railway dashboard
# Check REDIS_URL
railway variables get REDIS_URL
```

**Common Causes**:
1. Redis is down or restarting
2. Connection limit reached
3. Network issue
4. Invalid REDIS_URL

**Resolution**:

1. **Check Railway Redis status**:
   - View Railway dashboard

2. **Verify REDIS_URL**:
   ```bash
   railway variables get REDIS_URL
   ```

3. **Restart Redis** (from Railway dashboard)

4. **Restart Guardian service**:
   ```bash
   railway restart
   ```

**Workaround**: Service can partially function without Redis, but performance will be degraded.

---

### Alert: High Response Time

**Symptom**: Average response time > 2000ms for 5 minutes

**Impact**: Slow user experience, potential timeouts

**Diagnosis**:
```bash
# Check recent response times
curl -w "@-" -o /dev/null -s https://your-service.railway.app/api/health <<EOF
{
  "time_namelookup": %{time_namelookup},
  "time_connect": %{time_connect},
  "time_starttransfer": %{time_starttransfer},
  "time_total": %{time_total}
}
EOF

# Check for slow queries in logs
railway logs | grep "slow query"

# Check resource usage in Railway dashboard
```

**Common Causes**:
1. Slow database queries
2. High CPU/memory usage
3. External API (Solana RPC) slowness
4. Cold start (after idle period)
5. Increased traffic

**Resolution**:

1. **Enable request tracing**:
   ```bash
   railway variables --set REQUEST_TRACING_ENABLED=true
   railway restart
   ```

2. **Check database query performance**:
   - Review logs for slow queries
   - Check database indexes
   - Use `npx prisma studio` to analyze queries

3. **Check Solana RPC performance**:
   ```bash
   curl $SOLANA_RPC_URL -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' -w "\nTime: %{time_total}s\n"
   ```
   - Consider upgrading to paid RPC provider (Helius, Triton)

4. **Scale up if needed**:
   - Increase Railway service resources in dashboard

5. **Implement caching**:
   - Review Redis cache hit rate
   - Add caching for frequently accessed data

---

### Alert: Event Listener Disconnected

**Symptom**: Event listener status shows disconnected for > 2 minutes

**Impact**: On-chain events not processed, transactions not monitored

**Diagnosis**:
```bash
# Check logs for websocket errors
railway logs | grep "event-listener\|websocket"

# Check Solana RPC health
curl $SOLANA_RPC_URL -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

**Common Causes**:
1. Solana RPC WebSocket disconnection
2. RPC rate limiting
3. Network instability
4. Invalid PROGRAM_ID

**Resolution**:

1. **Check RPC endpoint health**:
   - Public RPCs (api.devnet.solana.com) can be unreliable
   - Consider paid RPC provider

2. **Verify PROGRAM_ID**:
   ```bash
   railway variables get PROGRAM_ID
   ```

3. **Check rate limits**:
   - Public RPCs have aggressive rate limits
   - Paid RPCs have higher limits

4. **Restart service** (auto-reconnect should occur):
   ```bash
   railway restart
   ```

5. **Temporary disable if persistent**:
   ```bash
   ./scripts/emergency-disable.sh event-listener
   ```
   Then investigate and fix before re-enabling.

**Escalation**: If RPC provider is consistently unreliable, migrate to paid provider (Helius, Triton, QuickNode).

---

### Alert: High Error Rate

**Symptom**: Error rate > 5% for 5 minutes

**Impact**: Multiple API requests failing

**Diagnosis**:
```bash
# Check error logs
railway logs | grep -i "error\|exception"

# Check specific error types
railway logs | grep "status: 500\|status: 503"

# Check Sentry (if configured)
# View error dashboard at sentry.io
```

**Common Causes**:
1. Unhandled exceptions in code
2. Database query errors
3. External API failures (Solana RPC)
4. Invalid client requests
5. Rate limiting

**Resolution**:

1. **Identify error pattern**:
   - Review recent error logs
   - Check Sentry for error grouping

2. **Check for deployment correlation**:
   ```bash
   # View recent deployments
   railway logs | grep "deployment"
   ```
   If errors started after deployment, consider rollback.

3. **Check external dependencies**:
   - Database health
   - Redis health
   - Solana RPC health

4. **Rollback if caused by recent deployment**:
   ```bash
   ./scripts/rollback.sh
   ```

5. **Emergency disable problematic features**:
   ```bash
   ./scripts/emergency-disable.sh <feature>
   ```

---

### Alert: High Memory Usage

**Symptom**: Memory usage > 90% for 5 minutes

**Impact**: Potential service crashes, slow performance

**Diagnosis**:
```bash
# View memory metrics in Railway dashboard
# Check for memory leaks in logs
railway logs | grep "memory\|heap"
```

**Common Causes**:
1. Memory leak in code
2. Large result sets from database
3. Too many concurrent connections
4. Large log buffers
5. Insufficient memory allocation

**Resolution**:

1. **Restart service** (temporary relief):
   ```bash
   railway restart
   ```

2. **Check database query sizes**:
   - Review logs for large queries
   - Implement pagination

3. **Check connection pools**:
   - PostgreSQL: Max 10 connections
   - Redis: Max 10 connections
   - Reduce if necessary

4. **Review log level**:
   ```bash
   railway variables --set LOG_LEVEL=warn
   railway restart
   ```

5. **Scale up memory** (Railway dashboard):
   - Increase service memory allocation

6. **Investigate memory leaks**:
   - Review recent code changes
   - Check for unclosed connections
   - Monitor after restart

---

### Alert: Failed Transactions Spike

**Symptom**: > 20 failed transactions in 5 minutes

**Impact**: Users unable to execute transactions

**Diagnosis**:
```bash
# Query database for recent failed transactions
railway run npx prisma studio
# Or check logs
railway logs | grep "transaction.*failed"
```

**Common Causes**:
1. Solana RPC issues
2. Program account issues
3. Insufficient SOL for fees
4. Invalid transaction data
5. Rate limiting on RPC

**Resolution**:

1. **Check Solana network status**:
   - Visit https://status.solana.com

2. **Verify program deployment**:
   ```bash
   solana program show $PROGRAM_ID --url $SOLANA_CLUSTER
   ```

3. **Check RPC health**:
   ```bash
   curl $SOLANA_RPC_URL -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```

4. **Review transaction failure reasons**:
   - Check logs for specific error messages
   - Common: "insufficient funds", "blockhash not found", "account not found"

5. **If RPC issues, switch to backup RPC**:
   ```bash
   railway variables --set SOLANA_RPC_URL=https://backup-rpc-url
   railway restart
   ```

---

## Incident Response

### Severity Levels

**P0 - Critical**:
- Service completely down
- Database data loss
- Security breach

**P1 - High**:
- Major feature unavailable
- High error rate (>10%)
- Database connectivity issues

**P2 - Medium**:
- Degraded performance
- Non-critical feature unavailable
- Elevated error rate (5-10%)

**P3 - Low**:
- Minor issues
- Cosmetic bugs
- Performance warnings

### Incident Response Flow

```
1. Detect
   ↓
2. Acknowledge (update status page)
   ↓
3. Assess severity
   ↓
4. Triage (identify root cause)
   ↓
5. Mitigate (stop the bleeding)
   ↓
6. Fix (resolve root cause)
   ↓
7. Verify
   ↓
8. Post-mortem
```

### Immediate Actions (First 5 Minutes)

1. **Acknowledge the incident**
2. **Check service health**:
   ```bash
   curl https://your-service.railway.app/api/health
   ```
3. **Check Railway status**: https://railway.statuspage.io
4. **Review recent changes**:
   ```bash
   railway logs | head -100
   ```
5. **Notify team** via Slack/Discord

### Mitigation Strategies

**For P0/P1 incidents**:

1. **Rollback** if caused by recent deployment:
   ```bash
   railway rollback
   ```

2. **Emergency disable** problematic features:
   ```bash
   ./scripts/emergency-disable.sh <feature>
   ```

3. **Restart services**:
   ```bash
   railway restart
   ```

4. **Scale up** if resource-related (Railway dashboard)

5. **Switch to backup RPC** if Solana-related:
   ```bash
   railway variables --set SOLANA_RPC_URL=https://backup-url
   railway restart
   ```

## Maintenance Procedures

### Scheduled Maintenance

**Communication**:
1. Notify users 24 hours in advance
2. Update status page
3. Send email/Discord announcement

**Maintenance Window**: Recommended: Sundays 02:00-04:00 UTC (low traffic)

**Procedure**:

1. **Create maintenance announcement**
2. **Take database backup** (Railway automatic backups)
3. **Deploy changes**:
   ```bash
   ./scripts/deploy-railway.sh production
   ```
4. **Run migrations**:
   ```bash
   railway run npx prisma migrate deploy
   ```
5. **Verify deployment**:
   ```bash
   ./scripts/verify-deployment.sh
   ```
6. **Monitor for 30 minutes**
7. **Update status page** (maintenance complete)

### Database Migrations

**Zero-Downtime Migration Strategy**:

**Phase 1: Additive Changes**
```bash
# Add new column (nullable or with default)
railway run npx prisma migrate deploy

# Deploy code that writes to both old and new columns
./scripts/deploy-railway.sh production
```

**Phase 2: Backfill** (if needed)
```bash
# Run backfill script
railway run node scripts/backfill-data.js
```

**Phase 3: Cutover**
```bash
# Deploy code that only uses new schema
./scripts/deploy-railway.sh production
```

**Phase 4: Cleanup**
```bash
# Remove old column in separate migration
railway run npx prisma migrate deploy
```

### Scaling

**Scale Up** (Railway dashboard):
1. Go to service settings
2. Increase CPU/memory
3. Save changes (service will restart)

**Scale Horizontally** (requires load balancer):
- Not directly supported on Railway
- Consider using Railway's regions for geo-distribution

### Secrets Rotation

**Rotate JWT_SECRET**:
```bash
# Generate new secret
NEW_SECRET=$(openssl rand -base64 32)

# Set new secret
railway variables --set JWT_SECRET=$NEW_SECRET

# Restart service
railway restart

# Note: This will invalidate all existing sessions
```

**Rotate WEBHOOK_HMAC_SECRET**:
```bash
# Generate new secret
NEW_SECRET=$(openssl rand -base64 32)

# Set new secret
railway variables --set WEBHOOK_HMAC_SECRET=$NEW_SECRET

# Restart service
railway restart

# Update webhook subscribers with new secret
```

**Rotate Database Password**:
- Not necessary (Railway manages this)
- If needed, create new database and migrate

## Performance Tuning

### Database Optimization

**Add Indexes**:
```prisma
// In schema.prisma
@@index([fieldName])
```

**Common indexes to check**:
- Vault.owner
- Transaction.vaultId
- Transaction.status
- Override.vaultId
- Override.status

**Query Optimization**:
```typescript
// Use select to fetch only needed fields
const vaults = await prisma.vault.findMany({
  select: {
    id: true,
    name: true,
    owner: true,
    // Don't fetch large fields if not needed
  }
})

// Use pagination
const vaults = await prisma.vault.findMany({
  take: 20,
  skip: page * 20
})
```

### Caching Strategy

**Cache these**:
- Vault configurations (5 minutes)
- User profiles (10 minutes)
- Analytics data (15 minutes)
- Transaction counts (1 minute)

**Don't cache**:
- Real-time transaction status
- Pending overrides
- Health checks

### RPC Optimization

**Use paid RPC provider**:
- Helius: https://helius.xyz
- Triton: https://triton.one
- QuickNode: https://quicknode.com

**Benefits**:
- Higher rate limits
- Better reliability
- Lower latency
- Dedicated infrastructure

## Disaster Recovery

### Backup Strategy

**Database Backups**:
- Railway automatic backups: Daily
- Retention: 7 days (Starter), 30 days (Pro)

**Manual Backup**:
```bash
# Export database
railway run npx prisma db pull --schema=./backup-schema.prisma
```

**Configuration Backup**:
- `.railway-config.json` (stored securely, not in git)
- Environment variables (documented)

### Recovery Procedures

**Recover from Database Backup**:
1. Contact Railway support to restore from backup
2. Specify restore point timestamp
3. Verify data after restore
4. Redeploy service if necessary

**Recover from Total Loss**:
1. Create new Railway project
2. Run setup script: `./scripts/railway-setup.sh`
3. Restore environment variables from backup
4. Restore database from backup (if available)
5. Deploy application
6. Update DNS (if custom domain)

**Estimated Recovery Time**:
- Database restore: 15-30 minutes
- Full rebuild: 1-2 hours

### Business Continuity

**Critical Services Priority**:
1. Database (PostgreSQL) - Highest
2. API service (Guardian) - Highest
3. Redis (cache/jobs) - High
4. Event listener - High
5. Notifications - Medium

**Degraded Mode**:
If resources are limited, can run with:
- Database only (no Redis)
- No event listener (manual transaction processing)
- No notifications

## Contact Information

**Railway Support**:
- Email: support@railway.app
- Discord: https://discord.gg/railway

**On-Call Engineer**:
- Primary: [Name] - [Contact]
- Secondary: [Name] - [Contact]

**Escalation**:
- Technical Lead: [Name] - [Contact]
- Product Manager: [Name] - [Contact]

## Post-Mortem Template

After major incidents, complete a post-mortem:

```markdown
# Incident Post-Mortem: [Brief Description]

## Incident Details
- Date/Time: [UTC timestamp]
- Duration: [X hours/minutes]
- Severity: [P0/P1/P2/P3]
- Detected by: [Monitoring/User report/Internal]

## Impact
- Users affected: [Number/All/Percentage]
- Features affected: [List]
- Data loss: [Yes/No - Details]

## Timeline
- [HH:MM] - Initial detection
- [HH:MM] - Team notified
- [HH:MM] - Root cause identified
- [HH:MM] - Mitigation applied
- [HH:MM] - Service restored
- [HH:MM] - Incident closed

## Root Cause
[Detailed explanation]

## Resolution
[What was done to fix it]

## Action Items
- [ ] [Preventive measure 1]
- [ ] [Preventive measure 2]
- [ ] [Monitoring improvement 1]
- [ ] [Documentation update 1]

## Lessons Learned
[What we learned and what we'll do differently]
```
