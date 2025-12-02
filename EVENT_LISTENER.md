# Guardian Event Listener - Setup Guide

## Overview

The Guardian event listener monitors on-chain events from the Aegis protocol and syncs them to the PostgreSQL database in real-time.

## Quick Start

### 1. Configure Environment

Copy the example environment file and update it:
```bash
cd aegis-guardian
cp .env.example .env
```

Ensure these variables are set in your `.env`:
```bash
# Solana Configuration
SOLANA_RPC_URL=http://127.0.0.1:8899  # For localnet
PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
SOLANA_CLUSTER=localnet

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aegis_guardian?schema=public

# Redis (optional for caching)
REDIS_URL=redis://localhost:6379
```

### 2. Start Components

You need to run these in separate terminals:

**Terminal 1 - Local Validator:**
```bash
solana-test-validator
```

**Terminal 2 - Protocol Deployment:**
```bash
cd aegis-protocol
anchor deploy --provider.cluster localnet
```

**Terminal 3 - Event Listener:**
```bash
cd aegis-guardian
npm run listen
```

**Terminal 4 - Guardian API (optional):**
```bash
cd aegis-guardian
npm run dev
```

### 3. Generate Test Transactions

**Terminal 5 - Create a vault:**
```bash
cd aegis-protocol
yarn generate-tx
```

The event listener (Terminal 3) should immediately show logs like:
```
[INFO] Event listener started successfully
[INFO] Vault initialized { event: { vaultPda: '...', owner: '...', ... } }
```

### 4. Verify Database Sync

```bash
cd aegis-guardian
npm run test:integration
```

Expected output:
```
✅ Found 1 recent transactions in Guardian DB
```

---

## Architecture

### Event Flow

```
Protocol (On-Chain)
    ↓ Emits events
Solana RPC WebSocket
    ↓ Streams logs
Event Listener Service
    ↓ Parse & validate
PostgreSQL Database
    ↓ Query
Guardian API / Tests
```

### Event Types Supported

1. **VaultInitialized** - When a new vault is created
2. **TransactionExecuted** - When a guarded transaction succeeds
3. **TransactionBlocked** - When a transaction is blocked by policy
4. **OverrideRequested** - When an override is requested
5. **OverrideApproved** - When an override is approved
6. **PolicyUpdated** - When vault policy changes

---

## Troubleshooting

### Event Listener Won't Start

**Problem**: `Missing required environment variables`
**Solution**: Ensure `PROGRAM_ID`, `SOLANA_RPC_URL`, and `DATABASE_URL` are set in `.env`

**Problem**: `Failed to connect to RPC`
**Solution**: Verify `solana-test-validator` is running on port 8899

**Problem**: `Database connection failed`
**Solution**: Ensure PostgreSQL is running and DATABASE_URL is correct

### Events Not Being Captured

**Problem**: Listener is running but no events show up
**Solution**: 
1. Verify PROGRAM_ID matches deployed program
2. Check that transactions are actually being created on-chain
3. Look for error logs in the listener output

**Problem**: `Failed to parse event data`
**Solution**: Event structure may have changed. Check that protocol event definitions match Guardian types.

---

## Development

### Running Tests

```bash
# Run integration tests
npm run test:integration

# Check database directly
npm run prisma:studio
```

### Monitoring Logs

The event listener uses structured logging:
```typescript
[INFO] Event listener started
[INFO] Vault initialized { vaultPda: '...', owner: '...', dailyLimit: 10000000000 }
[DEBUG] Processing event { discriminator: '0x...', signature: '...' }
[ERROR] Failed to process event { error: '...', signature: '...' }
```

### Adding New Event Types

1. Define event type in `src/types/index.ts`
2. Add discriminator to `EventDiscriminator` enum
3. Implement parsing method in `event-listener.ts`
4. Add handler method for database operations
5. Update switch statement in `processEventData()`

---

## Production Deployment

### Environment Variables

For production, update:
```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
PROGRAM_ID=<your-deployed-program-id>
SOLANA_CLUSTER=mainnet-beta
EVENT_LISTENER_ENABLED=true
EVENT_LISTENER_RESTART_DELAY=5000
```

### Process Management

Use PM2 or similar for production:
```bash
# Install PM2
npm install -g pm2

# Start listener
pm2 start npm --name "aegis-listener" -- run listen

# Start API
pm2 start npm --name "aegis-api" -- run start

# Monitor
pm2 logs
pm2 monit
```

### Error Handling

The listener automatically:
- Reconnects on WebSocket disconnection
- Logs all parsing errors without crashing
- Validates event data structure before processing
- Uses database transactions for atomic writes

---

## Implementation Details

### Event Parsing

Events are emitted by Anchor as base64-encoded binary data:
1. First 8 bytes: Event discriminator (identifies event type)
2. Remaining bytes: Event data (borsh-serialized struct)

The listener:
1. Subscribes to program logs via WebSocket
2. Filters for "Program data:" lines
3. Base64 decodes the data
4. Matches discriminator to event type
5. Parses event data according to IDL structure
6. Stores in database

### Database Schema

Events are normalized into:
- `Vault` table - Vault configurations
- `Transaction` table - All vault transactions
- `Override` table - Override requests/approvals
- `FeeCollection` table - Fee tracking

---

## Next Steps

- [ ] Add support for event replay (historical sync)
- [ ] Implement event batching for high throughput
- [ ] Add Prometheus metrics
- [ ] Create admin dashboard for monitoring
- [ ] Add alerting for critical events
