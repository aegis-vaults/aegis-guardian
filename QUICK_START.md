# Aegis Guardian - Quick Start Deployment Guide

This is a condensed guide for deploying Aegis Guardian to Railway. For detailed information, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Prerequisites

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login
```

## 5-Minute Setup

### 1. Run Setup Script

```bash
cd /Users/ryankaelle/dev/Aegis/aegis-guardian
chmod +x scripts/*.sh
./scripts/railway-setup.sh aegis-guardian-prod
```

This creates:
- Railway project
- PostgreSQL database
- Redis cache
- Environment variables with generated secrets

### 2. Configure Domain (After First Deploy)

```bash
# Get your Railway URL from first deployment
railway variables --set BASE_URL=https://your-app.up.railway.app
railway variables --set ACTIONS_BASE_URL=https://your-app.up.railway.app/api/actions
railway variables --set CORS_ORIGINS=https://your-frontend.com
```

### 3. Deploy

```bash
./scripts/deploy-railway.sh production
```

This will:
- Copy IDL from protocol
- Build and verify locally
- Deploy to Railway
- Run migrations
- Verify health

### 4. Verify

```bash
./scripts/verify-deployment.sh https://your-app.up.railway.app
```

## Quick Commands

### View Logs
```bash
railway logs
railway logs --follow  # Stream logs
```

### Check Status
```bash
railway status
```

### Restart Service
```bash
railway restart
```

### Rollback
```bash
railway rollback
```

### Environment Variables
```bash
# List all variables
railway variables

# Set a variable
railway variables --set KEY=value

# Get a variable
railway variables get KEY

# Manage variables with script
./scripts/manage-env.sh validate  # Check all required vars
./scripts/manage-env.sh backup    # Backup current vars
```

## Monitoring Setup

### Essential: Uptime Monitoring

1. Sign up at https://uptimerobot.com (free)
2. Add HTTP(s) monitor
3. URL: `https://your-app.up.railway.app/api/health`
4. Interval: 5 minutes
5. Add alert contacts

### Recommended: Error Tracking

1. Sign up at https://sentry.io
2. Create Next.js project
3. Get your DSN
4. Set variables:
   ```bash
   railway variables --set SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
   railway variables --set SENTRY_TRACES_SAMPLE_RATE=0.1
   railway restart
   ```

## Common Issues

### Service Won't Start

**Check logs:**
```bash
railway logs | grep ERROR
```

**Common fixes:**
```bash
# Verify environment variables
./scripts/manage-env.sh validate

# Check database migrations
railway run npx prisma migrate status

# Restart service
railway restart

# If all else fails, rollback
railway rollback
```

### Database Connection Failed

```bash
# Check database status in Railway dashboard
# Verify DATABASE_URL is set
railway variables get DATABASE_URL

# Run migrations
railway run npx prisma migrate deploy

# Restart service
railway restart
```

### Event Listener Disconnected

```bash
# Check RPC URL
railway variables get SOLANA_RPC_URL

# Check Program ID
railway variables get PROGRAM_ID

# Test RPC connection
curl $SOLANA_RPC_URL -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Restart to reconnect
railway restart
```

## GitHub Actions CI/CD

### Setup

1. Generate Railway token:
   ```bash
   railway tokens create
   ```

2. Add GitHub secrets (Settings > Secrets and variables > Actions):
   - `RAILWAY_TOKEN`: Token from step 1
   - `RAILWAY_PROJECT_ID`: From Railway dashboard
   - `RAILWAY_SERVICE_URL`: Your service URL
   - `SLACK_WEBHOOK_URL`: (Optional) For notifications

3. Push to main branch - automatic deployment!

### Manual Trigger

Go to Actions tab > Deploy to Railway > Run workflow

## Emergency Procedures

### Quick Rollback
```bash
railway rollback
```

### Emergency Disable Features
```bash
# Disable event listener
./scripts/emergency-disable.sh event-listener

# Disable webhooks
./scripts/emergency-disable.sh webhooks

# Disable all non-essential features
./scripts/emergency-disable.sh all
```

### Check Service Health
```bash
curl https://your-app.up.railway.app/api/health
```

## Cost Estimates

**Railway Pricing:**
- Starter: $5/month + usage
- Pro: $20/month + usage

**Expected monthly cost:**
- Small deployment: $15-20/month
- Medium deployment: $30-50/month
- Large deployment: $100+/month

**Cost optimization:**
```bash
# Reduce log verbosity
railway variables --set LOG_LEVEL=warn

# Monitor usage in Railway dashboard
# Consider connection pooling optimization
```

## File Structure

```
aegis-guardian/
├── scripts/
│   ├── railway-setup.sh        # Initial Railway setup
│   ├── deploy-railway.sh       # Deploy to Railway
│   ├── verify-deployment.sh    # Verify deployment health
│   ├── setup-monitoring.sh     # Configure monitoring
│   ├── rollback.sh             # Rollback procedure
│   ├── emergency-disable.sh    # Emergency feature disable
│   └── manage-env.sh           # Environment variable management
├── .github/workflows/
│   ├── deploy-railway.yml      # Automated deployment
│   └── pr-checks.yml           # PR validation
├── Dockerfile                   # Production Docker image
├── railway.json                 # Railway configuration
├── DEPLOYMENT.md                # Detailed deployment guide
├── RUNBOOK.md                   # Operations runbook
└── QUICK_START.md               # This file
```

## Support

### Documentation
- [DEPLOYMENT.md](DEPLOYMENT.md) - Detailed deployment guide
- [RUNBOOK.md](RUNBOOK.md) - Operations and incident response
- [Railway Docs](https://docs.railway.app)

### Railway Support
- Discord: https://discord.gg/railway
- Email: support@railway.app

### Check Railway Status
- https://railway.statuspage.io

## Next Steps After Deployment

1. **Set up monitoring** (UptimeRobot, Sentry)
2. **Configure custom domain** (optional)
3. **Set up Stripe** (if using subscriptions)
4. **Configure notifications** (Telegram, SendGrid)
5. **Review security checklist** in DEPLOYMENT.md
6. **Set up backup monitoring**
7. **Document team runbook procedures**
8. **Test rollback procedure** in staging

## Maintenance

### Weekly
- Review error logs
- Check resource usage
- Monitor costs

### Monthly
- Review and optimize queries
- Update dependencies
- Rotate secrets (optional)
- Review incident history

### Quarterly
- Full security audit
- Disaster recovery test
- Performance optimization review

---

**Need help?** Check [DEPLOYMENT.md](DEPLOYMENT.md) for detailed information or [RUNBOOK.md](RUNBOOK.md) for troubleshooting procedures.
