# Aegis Guardian - Production Deployment Guide

This guide covers the complete deployment process for Aegis Guardian to Railway.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Deployment Process](#deployment-process)
- [Post-Deployment](#post-deployment)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)
- [Rollback Procedures](#rollback-procedures)

## Prerequisites

### Required Tools

- **Node.js 20+**: JavaScript runtime
- **Railway CLI**: `npm install -g @railway/cli`
- **OpenSSL**: For generating secrets (usually pre-installed)
- **Git**: Version control
- **curl**: For health checks (usually pre-installed)

### Required Accounts

- **Railway Account**: Sign up at https://railway.app
- **Stripe Account** (Optional): For subscription billing
- **SendGrid Account** (Optional): For email notifications
- **Telegram Bot** (Optional): For Telegram notifications

### Railway Pricing

- **Starter Plan**: $5/month + usage
- **Pro Plan**: $20/month + usage
- **PostgreSQL**: ~$5-10/month (included in usage)
- **Redis**: ~$3-5/month (included in usage)

Expected total: **$15-20/month** for moderate usage

## Initial Setup

### Step 1: Install Railway CLI

```bash
npm install -g @railway/cli
```

### Step 2: Login to Railway

```bash
railway login
```

This will open a browser for authentication.

### Step 3: Run Setup Script

```bash
cd /Users/ryankaelle/dev/Aegis/aegis-guardian
chmod +x scripts/*.sh
./scripts/railway-setup.sh aegis-guardian-prod
```

This script will:
- Create a new Railway project
- Add PostgreSQL database
- Add Redis cache
- Generate secure secrets
- Configure environment variables
- Save configuration to `.railway-config.json`

**IMPORTANT**: Keep `.railway-config.json` secure and do NOT commit it to version control.

### Step 4: Configure Solana Settings

Update these variables for your deployment:

```bash
# For devnet deployment
railway variables --set PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
railway variables --set SOLANA_CLUSTER=devnet
railway variables --set SOLANA_RPC_URL=https://api.devnet.solana.com

# For mainnet deployment (when ready)
railway variables --set PROGRAM_ID=YOUR_MAINNET_PROGRAM_ID
railway variables --set SOLANA_CLUSTER=mainnet-beta
railway variables --set SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

### Step 5: Configure Domain

After first deployment, you'll get a Railway URL like `aegis-guardian-production.up.railway.app`.

Set your base URL:

```bash
railway variables --set BASE_URL=https://aegis-guardian-production.up.railway.app
railway variables --set ACTIONS_BASE_URL=https://aegis-guardian-production.up.railway.app/api/actions
```

For custom domain:

```bash
railway domain
# Follow prompts to add custom domain
# Then update:
railway variables --set BASE_URL=https://api.aegis.finance
railway variables --set ACTIONS_BASE_URL=https://api.aegis.finance/api/actions
```

### Step 6: Configure CORS

```bash
railway variables --set CORS_ORIGINS=https://app.aegis.finance,https://aegis.finance
```

## Deployment Process

### Option A: Automated Deployment (Recommended)

```bash
./scripts/deploy-railway.sh production
```

This script will:
1. Run pre-deployment checks
2. Copy IDL from protocol
3. Install dependencies
4. Generate Prisma Client
5. Run type checking
6. Build locally for verification
7. Run database migrations
8. Deploy to Railway
9. Verify deployment health

### Option B: Manual Deployment

```bash
# 1. Copy IDL file
cp ../aegis-protocol/target/idl/aegis_core.json ./src/lib/idl/

# 2. Install dependencies
npm ci

# 3. Generate Prisma Client
npx prisma generate

# 4. Run checks
npm run lint
npm run type-check

# 5. Build
npm run build

# 6. Deploy
railway up --detach

# 7. Run migrations
railway run npx prisma migrate deploy

# 8. Check status
railway status
```

### First-Time Deployment

On first deployment, you need to:

1. **Run database migrations**:
   ```bash
   railway run npx prisma migrate deploy
   ```

2. **Verify health**:
   ```bash
   curl https://your-service.railway.app/api/health
   ```

3. **Check logs**:
   ```bash
   railway logs --follow
   ```

## Post-Deployment

### Verification

Run comprehensive verification:

```bash
./scripts/verify-deployment.sh https://your-service.railway.app
```

This checks:
- Health endpoint
- Database connectivity
- Redis connectivity
- API endpoints
- SSL/TLS configuration
- Security headers
- Response times
- Environment configuration

### Setup Monitoring

```bash
./scripts/setup-monitoring.sh
```

This will guide you through:
- Railway metrics
- External uptime monitoring (UptimeRobot, BetterUptime)
- Error tracking (Sentry)
- Log aggregation
- Alert configuration

### Configure CI/CD

Set up GitHub Actions for automated deployments:

1. **Create Railway API token**:
   ```bash
   railway tokens create
   ```

2. **Add secrets to GitHub**:
   - Go to repository Settings > Secrets and variables > Actions
   - Add `RAILWAY_TOKEN` with the token from step 1
   - Add `RAILWAY_PROJECT_ID` (get from Railway dashboard)
   - Add `RAILWAY_SERVICE_URL` (your service URL)
   - Add `SLACK_WEBHOOK_URL` (optional, for notifications)

3. **Push to main branch**:
   ```bash
   git push origin main
   ```

The deployment workflow will automatically run on push to `main` branch.

## Monitoring

### Built-in Railway Monitoring

View metrics in Railway dashboard:
- CPU usage
- Memory usage
- Network traffic
- Request count
- Response times

### Log Monitoring

```bash
# View logs
railway logs

# Follow logs in real-time
railway logs --follow

# Filter logs
railway logs | grep ERROR
```

### Health Checks

Railway automatically monitors `/api/health` endpoint.

Configure alerts in Railway dashboard for:
- Service down
- High error rate
- High resource usage

### External Monitoring

**Recommended: UptimeRobot (Free)**

1. Sign up at https://uptimerobot.com
2. Add HTTP(s) monitor
3. URL: `https://your-service.railway.app/api/health`
4. Interval: 5 minutes
5. Alert contacts: Email, Slack, Discord

**Alternative: BetterUptime**

1. Sign up at https://betterstack.com/better-uptime
2. Create uptime monitor
3. URL: `https://your-service.railway.app/api/health`
4. Interval: 30 seconds (paid) or 3 minutes (free)

## Troubleshooting

### Service Won't Start

**Check logs**:
```bash
railway logs
```

**Common issues**:

1. **Missing environment variables**:
   ```bash
   railway variables
   ```
   Verify all required variables are set.

2. **Database connection failed**:
   ```bash
   railway run npx prisma migrate status
   ```
   Check if migrations are applied.

3. **Build failed**:
   Check build logs for TypeScript errors or missing dependencies.

### Database Issues

**Check connection**:
```bash
railway run npx prisma db push --preview-feature
```

**Reset database** (DANGEROUS):
```bash
railway run npx prisma migrate reset
```

**View migration status**:
```bash
railway run npx prisma migrate status
```

### Event Listener Issues

If event listener is not receiving events:

1. **Check Solana RPC connectivity**:
   ```bash
   curl $SOLANA_RPC_URL -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```

2. **Verify Program ID**:
   ```bash
   railway variables get PROGRAM_ID
   ```

3. **Check listener logs**:
   ```bash
   railway logs | grep "event-listener"
   ```

4. **Restart listener**:
   ```bash
   railway restart
   ```

### High Memory Usage

If service is consuming too much memory:

1. **Check metrics in Railway dashboard**
2. **Review connection pool settings**:
   - PostgreSQL: Max 10 connections
   - Redis: Max 10 connections
3. **Scale up if needed** (Railway dashboard)

### Slow Response Times

1. **Enable request tracing**:
   ```bash
   railway variables --set REQUEST_TRACING_ENABLED=true
   railway restart
   ```

2. **Check database query performance**:
   ```bash
   railway run npx prisma studio
   ```

3. **Review Redis cache hit rate**

4. **Consider upgrading RPC provider** for Solana queries

## Rollback Procedures

### Quick Rollback

```bash
railway rollback
```

This rolls back to the previous deployment.

### Rollback to Specific Deployment

```bash
./scripts/rollback.sh <deployment-id>
```

### Emergency Feature Disable

Quickly disable features without full rollback:

```bash
# Disable event listener
./scripts/emergency-disable.sh event-listener

# Disable webhooks
./scripts/emergency-disable.sh webhooks

# Disable all features
./scripts/emergency-disable.sh all
```

### Database Rollback

If a migration caused issues:

```bash
# Mark migration as rolled back
railway run npx prisma migrate resolve --rolled-back <migration-name>

# Then rollback the service
railway rollback
```

## Security Checklist

Before going to production:

- [ ] All secrets are set via environment variables (not hardcoded)
- [ ] CORS is configured to only allow your frontend domains
- [ ] Rate limiting is enabled
- [ ] HTTPS is enforced (Railway handles this automatically)
- [ ] Database has strong password (Railway generates this)
- [ ] JWT_SECRET is cryptographically secure
- [ ] WEBHOOK_HMAC_SECRET is cryptographically secure
- [ ] Stripe webhook secret is configured (if using Stripe)
- [ ] Sentry is configured for error tracking
- [ ] Uptime monitoring is set up
- [ ] Team has access to Railway project
- [ ] Backup strategy is documented
- [ ] Incident response plan is in place

## Performance Optimization

### Database Connection Pooling

Prisma automatically manages connection pooling. For production:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Railway sets `DATABASE_URL` with connection pooling enabled.

### Redis Caching

Implement caching for:
- Vault configurations (TTL: 5 minutes)
- Transaction counts (TTL: 1 minute)
- Analytics data (TTL: 15 minutes)

### CDN Configuration

For static assets, consider adding a CDN:
- Cloudflare (free tier available)
- AWS CloudFront
- Vercel Edge Network

### Rate Limiting

Current settings:
- 100 requests per minute per IP
- Adjust in environment variables:
  ```bash
  railway variables --set RATE_LIMIT_MAX=200
  ```

## Cost Optimization

### Monitor Usage

Check Railway dashboard for:
- CPU hours
- Memory usage
- Database storage
- Network egress

### Optimization Tips

1. **Reduce log verbosity in production**:
   ```bash
   railway variables --set LOG_LEVEL=warn
   ```

2. **Implement aggressive caching**

3. **Use connection pooling** (enabled by default)

4. **Optimize database queries**:
   - Add indexes for frequently queried fields
   - Use Prisma's `select` to fetch only needed fields

5. **Scale down during low-traffic periods** (manual)

## Support

### Railway Support

- Documentation: https://docs.railway.app
- Discord: https://discord.gg/railway
- GitHub: https://github.com/railwayapp/railway

### Aegis Guardian Issues

- Check logs: `railway logs`
- Review documentation: `DEVNET_SETUP.md`, `EVENT_LISTENER.md`
- Contact team lead

## Additional Resources

- [Railway Documentation](https://docs.railway.app)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Prisma Deployment](https://www.prisma.io/docs/guides/deployment)
- [Solana RPC Providers](https://solana.com/rpc)
