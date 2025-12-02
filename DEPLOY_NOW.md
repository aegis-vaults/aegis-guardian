# Quick Deployment Guide - Aegis Guardian

## Current Status
✅ Railway project created: `aegis-guardian-prod`
✅ Project linked to CLI
✅ IDL file ready
✅ Prisma client generated
✅ Dependencies installed

## Next Steps (Complete via Railway Dashboard)

### Step 1: Create Service and Add Databases (5 minutes)

1. Open Railway Dashboard: https://railway.com/project/5cf56a4f-7a2f-416d-92a0-434e7e638883

2. **Add PostgreSQL Database:**
   - Click "+ New" → "Database" → "Add PostgreSQL"
   - Railway will auto-inject `DATABASE_URL`

3. **Add Redis:**
   - Click "+ New" → "Database" → "Add Redis"  
   - Railway will auto-inject `REDIS_URL`

4. **Create Application Service:**
   - Click "+ New" → "GitHub Repo" (or "Empty Service")
   - If using GitHub: Connect your repo and select `aegis-guardian`
   - If using Empty Service: Name it `aegis-guardian`
   - Railway will auto-detect Dockerfile

### Step 2: Set Environment Variables (via CLI)

After the service is created, run:

```bash
cd /Users/ryankaelle/dev/aegis/aegis-guardian

# Link to the service (replace 'aegis-guardian' with your actual service name)
railway service link aegis-guardian

# Set all environment variables
./scripts/set-env-vars.sh aegis-guardian
```

### Step 3: Deploy

```bash
# Deploy the application
railway up --service aegis-guardian

# Or use the deployment script
./scripts/deploy-railway.sh production
```

### Step 4: Get URL and Update BASE_URL

After deployment completes:

```bash
# Get the service URL
railway status

# Set BASE_URL (replace with your actual URL)
railway variables --service aegis-guardian --set BASE_URL=https://your-service.railway.app
railway variables --service aegis-guardian --set ACTIONS_BASE_URL=https://your-service.railway.app/api/actions
railway variables --service aegis-guardian --set NEXT_PUBLIC_API_URL=https://your-service.railway.app
railway variables --service aegis-guardian --set CORS_ORIGINS=https://your-frontend.com

# Restart to apply changes
railway restart --service aegis-guardian
```

### Step 5: Run Migrations

```bash
railway run --service aegis-guardian npx prisma migrate deploy
```

### Step 6: Verify Deployment

```bash
# Get your service URL
SERVICE_URL=$(railway status --json | jq -r '.url' || railway status | grep -o 'https://[^ ]*')

# Run verification
./scripts/verify-deployment.sh $SERVICE_URL

# Run smoke tests
./scripts/smoke-test.sh $SERVICE_URL
```

## Environment Variables Already Configured

The following critical variables are ready to be set (via `set-env-vars.sh`):

- ✅ JWT_SECRET
- ✅ WEBHOOK_HMAC_SECRET  
- ✅ SOLANA_RPC_URL (mainnet)
- ✅ SOLANA_WS_URL (mainnet)
- ✅ PROGRAM_ID
- ✅ All feature flags and configuration

## Troubleshooting

**Service not found:**
- Make sure you created the service in Railway dashboard first
- Use `railway service link <service-name>` to link

**Variables not setting:**
- Ensure service is linked: `railway service link <service-name>`
- Check service name matches: `railway status`

**Deployment fails:**
- Check logs: `railway logs --service aegis-guardian`
- Verify Dockerfile exists and is valid
- Check build logs in Railway dashboard

## Quick Commands Reference

```bash
# Link service
railway service link aegis-guardian

# Set variables
./scripts/set-env-vars.sh aegis-guardian

# Deploy
railway up --service aegis-guardian

# View logs
railway logs --service aegis-guardian --follow

# Check status
railway status

# Run migrations
railway run --service aegis-guardian npx prisma migrate deploy

# Restart
railway restart --service aegis-guardian
```

