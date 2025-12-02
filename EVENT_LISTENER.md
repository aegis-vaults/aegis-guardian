# Guardian Event Listener - Documentation

## Overview

The Guardian event listener automatically monitors on-chain events from the Aegis protocol and syncs them to the PostgreSQL database in real-time. It starts automatically when the Next.js server boots.

## How It Works

### Automatic Startup

The event listener starts automatically when the Guardian server starts via Next.js instrumentation hooks (`src/instrumentation.ts`). No separate process or script is needed.

### Connection Modes

The listener automatically chooses the best connection mode:

**Polling Mode (Default for Devnet):**
- Used for devnet and localnet
- Avoids WebSocket authentication issues
- Checks for new transactions every 2 seconds
- More reliable for free RPC endpoints

**WebSocket Mode:**
- Used for mainnet or custom RPC endpoints
- Real-time event streaming
- Falls back to polling if WebSocket fails

### Environment Variables

```bash
# Required
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
DATABASE_URL=postgresql://...

# Optional
START_EVENT_LISTENER=true  # Set to false to disable auto-start
FORCE_POLLING_MODE=true    # Force polling mode even for mainnet
```

## Events Processed

The listener processes these on-chain events:

1. **VaultInitialized** - New vault created
2. **TransactionExecuted** - Transaction approved and executed
3. **TransactionBlocked** - Transaction blocked by policy
4. **OverrideRequested** - Guardian override requested
5. **OverrideApproved** - Override approved by guardian
6. **PolicyUpdated** - Vault policy updated

## Local Development

### With Local Validator

```bash
# Terminal 1 - Start validator
solana-test-validator

# Terminal 2 - Deploy protocol (if needed)
cd aegis-protocol
anchor deploy

# Terminal 3 - Start Guardian (listener auto-starts)
cd aegis-guardian
npm run dev
```

The listener will automatically detect localnet and use polling mode.

### With Devnet

```bash
# Set environment
export SOLANA_RPC_URL=https://api.devnet.solana.com
export PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ

# Start Guardian (listener auto-starts)
npm run dev
```

## Production Deployment

On Railway, the listener starts automatically with the Next.js server:

1. Push code to GitHub
2. Railway builds and deploys
3. Event listener starts automatically
4. Check logs: `railway logs`

Look for:
```
Starting event listener on server startup...
Using polling mode for event listening { reason: 'devnet (avoiding WebSocket auth issues)' }
Polling event listener started { pollInterval: 2000 }
```

## Monitoring

### Check Listener Status

The listener logs important events:

```bash
# View logs
railway logs

# Check for listener startup
railway logs | grep "Event listener"

# Check for processed events
railway logs | grep "Vault initialized"
```

### Common Log Messages

**Success:**
```
Event listener started successfully
Vault initialized: { vaultPda: '...', owner: '...' }
Transaction executed: { signature: '...', amount: '...' }
```

**Warnings:**
```
WebSocket listener failed, falling back to polling mode
Using polling mode for event listening
```

## Troubleshooting

### Event Listener Not Starting

Check environment variables:
```bash
railway variables | grep -E "(SOLANA_RPC_URL|PROGRAM_ID|DATABASE_URL)"
```

All three must be set.

### Events Not Being Processed

1. **Check RPC connection:**
   ```bash
   curl -X POST $SOLANA_RPC_URL \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}'
   ```

2. **Verify program exists:**
   ```bash
   solana program show $PROGRAM_ID --url devnet
   ```

3. **Check database connection:**
   ```bash
   railway run npx prisma db pull
   ```

### WebSocket 401 Errors

This is normal for free devnet RPC endpoints. The listener automatically falls back to polling mode. To silence warnings, set:

```bash
FORCE_POLLING_MODE=true
```

### Database Connection Issues

On Railway, ensure the Guardian service is linked to your PostgreSQL service:

1. Go to Railway dashboard
2. Check Guardian service
3. Verify PostgreSQL is in "Connected Services"
4. DATABASE_URL should be automatically set

## Manual Control

### Disable Auto-Start

```bash
START_EVENT_LISTENER=false
```

### Standalone Script (Legacy)

If needed, you can still run the listener separately:

```bash
npm run listen
```

But this is **not recommended** for production. Use the auto-start functionality.

## Architecture

```
┌─────────────────────┐
│   Next.js Server    │
│   (instrumentation) │
└──────────┬──────────┘
           │
    ┌──────▼──────┐
    │   Event     │
    │  Listener   │
    │  Service    │
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Solana    │
    │   RPC/WS    │
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │ PostgreSQL  │
    │  Database   │
    └─────────────┘
```

## Performance

**Polling Mode:**
- Check interval: 2 seconds
- Processes up to 10 signatures per poll
- Suitable for devnet/testnet
- ~30 RPC requests/minute

**WebSocket Mode:**
- Real-time event streaming
- Suitable for mainnet with auth
- ~1-2 RPC requests/minute

## Best Practices

1. **Use polling for devnet** - More reliable
2. **Monitor Railway logs** - Check for errors
3. **Set proper RPC URL** - Use dedicated endpoint for production
4. **Keep database healthy** - Event processing depends on DB
5. **Don't run multiple instances** - Can cause duplicate processing

## Related Documentation

- [API Documentation](./API_DOCUMENTATION.md)
- [Database Migrations](./DATABASE_MIGRATIONS.md)
- [Production Checklist](./PRODUCTION_CHECKLIST.md)
- [Runbook](./RUNBOOK.md)
