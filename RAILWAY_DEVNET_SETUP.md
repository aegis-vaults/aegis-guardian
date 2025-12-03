# Railway Devnet Configuration Checklist

This document helps you verify that all Railway environment variables are set correctly for devnet.

## Quick Setup

Run this script to set all variables automatically:
```bash
cd aegis-guardian
./scripts/set-railway-devnet.sh aegis-guardian
```

Or set them manually in the Railway dashboard.

## Required Environment Variables

### ✅ Solana Configuration (DEVNET)

| Variable | Value | Required |
|----------|-------|----------|
| `SOLANA_RPC_URL` | `https://devnet.helius-rpc.com/?api-key=d0bb1f98-b8e3-4f52-9108-778ff3d7dcf1` | ✅ Yes |
| `SOLANA_WS_URL` | `wss://devnet.helius-rpc.com/?api-key=d0bb1f98-b8e3-4f52-9108-778ff3d7dcf1` | ✅ Yes |
| `SOLANA_CLUSTER` | `devnet` | ✅ Yes |
| `PROGRAM_ID` | `ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ` | ✅ Yes |
| `AEGIS_PROGRAM_ID` | `ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ` | ✅ Yes |

### ✅ Application URLs

| Variable | Value | Required |
|----------|-------|----------|
| `BASE_URL` | `https://aegis-guardian-production.up.railway.app` | ✅ Yes |
| `ACTIONS_BASE_URL` | `https://aegis-guardian-production.up.railway.app/api/actions` | ✅ Yes |
| `NEXT_PUBLIC_API_URL` | `https://aegis-guardian-production.up.railway.app` | ✅ Yes |
| `NEXT_PUBLIC_GUARDIAN_URL` | `https://aegis-guardian-production.up.railway.app` | ✅ Yes |

### ✅ Event Listener Configuration

| Variable | Value | Required |
|----------|-------|----------|
| `EVENT_LISTENER_ENABLED` | `true` | ✅ Yes |
| `EVENT_LISTENER_RESTART_DELAY` | `5000` | ✅ Yes |
| `EVENT_LISTENER_MAX_RECONNECT_ATTEMPTS` | `10` | ✅ Yes |

### ✅ Feature Flags

| Variable | Value | Required |
|----------|-------|----------|
| `BLINK_GENERATION_ENABLED` | `true` | ✅ Yes |
| `ANALYTICS_ENABLED` | `true` | ✅ Yes |
| `WEBHOOKS_ENABLED` | `true` | ✅ Yes |

### ✅ Security & Authentication

| Variable | Value | Required |
|----------|-------|----------|
| `JWT_SECRET` | (Generated secret) | ✅ Yes |
| `WEBHOOK_HMAC_SECRET` | (Generated secret) | ✅ Yes |

### ✅ Database & Redis

| Variable | Value | Required |
|----------|-------|----------|
| `DATABASE_URL` | (Railway PostgreSQL connection string) | ✅ Yes |
| `REDIS_URL` | (Railway Redis connection string) | ✅ Yes |

## How to Set Variables in Railway Dashboard

1. Go to your Railway project: https://railway.app/project
2. Click on the `aegis-guardian` service
3. Go to the **Variables** tab
4. Add or update each variable from the table above
5. Railway will automatically redeploy when variables change

## Verification Steps

### 1. Check Event Listener is Running

After deployment, check the logs:
```bash
railway logs --service aegis-guardian | grep -i "event listener"
```

You should see:
```
✅ Event listener started (polling mode, devnet)
```

### 2. Test RPC Connection

```bash
curl "https://aegis-guardian-production.up.railway.app/api/health"
```

Should return:
```json
{
  "status": "healthy",
  "services": {
    "database": { "status": "healthy" },
    "redis": { "status": "healthy" }
  }
}
```

### 3. Test Blink Endpoint

```bash
curl "https://aegis-guardian-production.up.railway.app/api/blinks/override?vault=3DK1x5h8ivW93f4Xc1aiVyvyNDQ5xcwgt6rJaddRegja&destination=HMrBkPPnedC5qzeZfXcyaWxiBk74utEqGPGGJSos4MzA&amount=250000000&reason=exceeded_daily_limit"
```

Should return Solana Actions metadata.

### 4. Check Event Listener Logs

```bash
railway logs --service aegis-guardian --tail
```

Look for:
- ✅ "Event listener started"
- ✅ "Connected to Solana devnet"
- ✅ "Monitoring program: ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ"
- ✅ "Polling mode enabled" (for devnet)

## Common Issues

### ❌ Event Listener Not Starting

**Symptoms:**
- Logs show "Event listener failed to start"
- No transaction events being recorded

**Fix:**
1. Verify `SOLANA_RPC_URL` is set to devnet Helius URL
2. Verify `SOLANA_CLUSTER=devnet`
3. Check `EVENT_LISTENER_ENABLED=true`
4. Restart the service: Railway will auto-restart on variable change

### ❌ Wrong Network (Localnet)

**Symptoms:**
- Logs show "Connected to localnet"
- Can't find vaults on-chain

**Fix:**
1. Set `SOLANA_CLUSTER=devnet`
2. Set `SOLANA_RPC_URL` to devnet URL (not localhost)
3. Redeploy

### ❌ Blink URLs Not Working

**Symptoms:**
- Blink URLs return 404 or CORS errors

**Fix:**
1. Verify `BASE_URL` is set to Railway URL
2. Verify `ACTIONS_BASE_URL` includes `/api/actions`
3. Check CORS settings in middleware

## Manual Railway CLI Commands

If you prefer using Railway CLI:

```bash
# Set Solana to devnet
railway variables --service aegis-guardian --set SOLANA_CLUSTER=devnet
railway variables --service aegis-guardian --set SOLANA_RPC_URL="https://devnet.helius-rpc.com/?api-key=d0bb1f98-b8e3-4f52-9108-778ff3d7dcf1"
railway variables --service aegis-guardian --set SOLANA_WS_URL="wss://devnet.helius-rpc.com/?api-key=d0bb1f98-b8e3-4f52-9108-778ff3d7dcf1"

# Set Program ID
railway variables --service aegis-guardian --set PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
railway variables --service aegis-guardian --set AEGIS_PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

# Set Application URLs
railway variables --service aegis-guardian --set BASE_URL="https://aegis-guardian-production.up.railway.app"
railway variables --service aegis-guardian --set ACTIONS_BASE_URL="https://aegis-guardian-production.up.railway.app/api/actions"
railway variables --service aegis-guardian --set NEXT_PUBLIC_API_URL="https://aegis-guardian-production.up.railway.app"
railway variables --service aegis-guardian --set NEXT_PUBLIC_GUARDIAN_URL="https://aegis-guardian-production.up.railway.app"

# Enable Event Listener
railway variables --service aegis-guardian --set EVENT_LISTENER_ENABLED=true
railway variables --service aegis-guardian --set BLINK_GENERATION_ENABLED=true
```

## After Configuration

1. ✅ Railway will automatically redeploy
2. ✅ Wait 2-3 minutes for deployment
3. ✅ Check logs to verify event listener started
4. ✅ Test a transaction to see if it's recorded
5. ✅ Test Blink URL generation

## Support

If you encounter issues:
1. Check Railway logs: `railway logs --service aegis-guardian`
2. Verify all variables are set correctly
3. Ensure Railway service is running
4. Check Railway status page for outages

