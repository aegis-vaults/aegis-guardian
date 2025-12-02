# Aegis Guardian - Database Migration Guide

**Database:** PostgreSQL 15+
**ORM:** Prisma 5.22.0
**Location:** `/prisma/schema.prisma`

---

## Table of Contents

1. [Overview](#overview)
2. [Existing Migrations](#existing-migrations)
3. [Running Migrations on Railway](#running-migrations-on-railway)
4. [Creating New Migrations](#creating-new-migrations)
5. [Migration Troubleshooting](#migration-troubleshooting)
6. [Seed Data](#seed-data)

---

## Overview

The Aegis Guardian backend uses Prisma ORM for database management. All schema changes are tracked via migrations in `/prisma/migrations/`.

### Migration Strategy

- **Development:** Use `prisma migrate dev` to create and apply migrations
- **Production:** Use `prisma migrate deploy` to apply migrations
- **Never:** Use `prisma db push` in production (bypasses migration history)

---

## Existing Migrations

### Migration 1: Initial Schema (20251202032036_init)

**Created:** 2025-12-02 03:20:36

**Tables Created:**
- `User` - User accounts linked to Solana wallets
- `Vault` - Vault configurations (mirrors on-chain state)
- `Transaction` - Transaction records (executed and blocked)
- `Override` - Override approval requests
- `Blink` - Blink/Actions metadata
- `Webhook` - Webhook subscriptions
- `DailyMetrics` - Analytics aggregation
- `TeamMember` - Team access control
- `FeeCollection` - Protocol fee tracking

**Key Features:**
- Full-text search support (`previewFeatures = ["fullTextSearch", "fullTextIndex"]`)
- Proper indexes on frequently queried fields
- Foreign key constraints with cascade deletes
- Enum types for status fields

**Schema Highlights:**

```prisma
model Vault {
  id          String   @id @default(cuid())
  publicKey   String   @unique
  owner       String   @db.VarChar(44)
  guardian    String   @db.VarChar(44)
  dailyLimit  BigInt
  dailySpent  BigInt   @default(0)
  // ... more fields

  @@index([owner])
  @@index([guardian])
  @@index([isActive])
}

model Transaction {
  id          String            @id @default(cuid())
  signature   String            @unique @db.VarChar(88)
  vaultId     String
  status      TransactionStatus @default(PENDING)
  // ... more fields

  @@index([vaultId])
  @@index([status])
  @@index([createdAt])
}
```

### Migration 2: Add Override Fields (20251202065256_add_override_fields)

**Created:** 2025-12-02 06:52:56

**Changes:**
- Added `requestedAmount` field to `Override` table (nullable BigInt)
- Added `destination` field to `Override` table (nullable VarChar(44))
- Added `blinkUrl` field to `Override` table (nullable VarChar(512))

**Purpose:**
- Store blocked transaction details with override requests
- Link Blink URLs to override records for notifications

---

## Running Migrations on Railway

### Prerequisites

1. PostgreSQL service added to Railway project
2. `DATABASE_URL` environment variable automatically set
3. Railway CLI installed (optional)

### Option A: Railway CLI (Recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Link to your project
railway link

# Run migrations
railway run npx prisma migrate deploy
```

**Expected Output:**
```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "railway", schema "public"

2 migrations found in prisma/migrations

Applying migration `20251202032036_init`
Applying migration `20251202065256_add_override_fields`

The following migration(s) have been applied:

migrations/
  └─ 20251202032036_init/
      └─ migration.sql
  └─ 20251202065256_add_override_fields/
      └─ migration.sql

All migrations have been successfully applied.
```

### Option B: Railway Dashboard

1. Go to your Railway project
2. Click on your service
3. Click "Settings" → "Deploy"
4. Under "Deploy Command", enter:
   ```bash
   npx prisma migrate deploy
   ```
5. Click "Run Command"
6. View logs to confirm success

### Option C: Post-Build Script

Add to `package.json`:

```json
{
  "scripts": {
    "build": "prisma generate && next build",
    "postbuild": "prisma migrate deploy"
  }
}
```

**Note:** This automatically runs migrations after each build. Use with caution - ensure migrations are tested before pushing.

---

## Creating New Migrations

### Development Workflow

1. **Update Schema**

Edit `/prisma/schema.prisma`:

```prisma
model Vault {
  // Add new field
  description String? @db.VarChar(500)
}
```

2. **Create Migration**

```bash
npx prisma migrate dev --name add_vault_description
```

This will:
- Generate SQL migration file
- Apply migration to development database
- Regenerate Prisma Client

3. **Review Migration**

Check the generated SQL in `prisma/migrations/<timestamp>_add_vault_description/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Vault" ADD COLUMN "description" VARCHAR(500);
```

4. **Test Migration**

```bash
# Run tests
npm test

# Test rollback (if migration has down.sql)
npx prisma migrate reset
```

5. **Commit Migration**

```bash
git add prisma/migrations
git commit -m "Add description field to Vault model"
git push
```

### Production Deployment

1. **Review Migration on Staging**

Deploy to staging environment first:

```bash
railway run --environment=staging npx prisma migrate deploy
```

2. **Backup Production Database**

```bash
# Railway automatically backs up, but verify:
railway backup create --environment=production
```

3. **Deploy to Production**

```bash
# Deploy migrations
railway run --environment=production npx prisma migrate deploy

# Or trigger via Railway dashboard
```

4. **Verify Migration**

```bash
railway run --environment=production npx prisma migrate status
```

Expected output:
```
Database schema is up to date!
```

---

## Migration Commands Reference

### Check Migration Status

```bash
# Local
npx prisma migrate status

# Railway
railway run npx prisma migrate status
```

### Apply Pending Migrations

```bash
# Production (safe)
npx prisma migrate deploy

# Development (interactive)
npx prisma migrate dev
```

### Reset Database (CAUTION: Deletes all data)

```bash
# Local only - never in production!
npx prisma migrate reset
```

### Resolve Migration Conflicts

If migrations are out of sync:

```bash
# Mark migrations as applied (use with caution)
npx prisma migrate resolve --applied "20251202032036_init"

# Mark migration as rolled back
npx prisma migrate resolve --rolled-back "20251202065256_add_override_fields"
```

### Generate Prisma Client Only

```bash
npx prisma generate
```

---

## Migration Troubleshooting

### Issue: Migration Already Applied

**Error:**
```
Migration `20251202032036_init` has already been applied to the database
```

**Solution:**
This is normal if migrations were previously applied. The error is informational.

If migration table is corrupted:

```bash
# Check migration history
railway run psql $DATABASE_URL -c "SELECT * FROM _prisma_migrations;"

# Manually mark as applied (if needed)
npx prisma migrate resolve --applied "20251202032036_init"
```

### Issue: Migration Failed Mid-Execution

**Error:**
```
Migration `<name>` failed to apply cleanly to the shadow database
```

**Solution:**

1. Check what went wrong:
```bash
railway run psql $DATABASE_URL
\dt
\d "TableName"
```

2. If table/column exists, mark migration as applied:
```bash
npx prisma migrate resolve --applied "<migration-name>"
```

3. If partially applied, manually fix and mark as applied:
```sql
-- Complete the migration manually
ALTER TABLE "Vault" ADD COLUMN IF NOT EXISTS "description" VARCHAR(500);
```

### Issue: Database Schema Drift

**Error:**
```
Your database schema is not in sync with your migration history
```

**Solution:**

Option A: Reset and reapply (development only):
```bash
npx prisma migrate reset
```

Option B: Create baseline migration (production):
```bash
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma \
  --script > fix.sql

# Review fix.sql, then apply manually:
railway run psql $DATABASE_URL < fix.sql
```

### Issue: Connection Timeout

**Error:**
```
Can't reach database server at `<host>`:`5432`
```

**Solution:**

1. Verify `DATABASE_URL` is set:
```bash
railway variables get DATABASE_URL
```

2. Test connection:
```bash
railway run psql $DATABASE_URL -c "SELECT 1"
```

3. Check PostgreSQL service is running in Railway dashboard

### Issue: Lock Timeout

**Error:**
```
Timeout waiting for the database connection pool
```

**Solution:**

1. Increase connection pool:
```env
DATABASE_POOL_MAX=20
```

2. Close idle connections:
```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle' AND state_change < NOW() - INTERVAL '5 minutes';
```

---

## Seed Data

### Creating a Seed Script

Create `prisma/seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting database seed...')

  // Example: Create test user
  const user = await prisma.user.upsert({
    where: { walletAddress: 'TestWallet1111111111111111111111111111111' },
    update: {},
    create: {
      walletAddress: 'TestWallet1111111111111111111111111111111',
      email: 'test@aegis.finance',
      tier: 'PERSONAL',
    },
  })

  console.log('Created user:', user)

  // Add more seed data here...

  console.log('Database seed completed!')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

### Add Seed Script to package.json

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "scripts": {
    "db:seed": "npx prisma db seed"
  }
}
```

### Run Seed Script

```bash
# Local
npm run db:seed

# Railway
railway run npm run db:seed
```

### Seed Data for Testing

Consider seeding:
- Test vaults with known addresses
- Sample transactions
- Webhook configurations
- Analytics baseline data

**Important:** Never seed sensitive data or production secrets!

---

## Database Indexes

Current indexes (automatically created by migrations):

### Vault Indexes
- `Vault_publicKey_key` (UNIQUE)
- `Vault_owner_idx`
- `Vault_guardian_idx`
- `Vault_isActive_idx`
- `Vault_createdAt_idx`
- `Vault_userId_idx`

### Transaction Indexes
- `Transaction_signature_key` (UNIQUE)
- `Transaction_vaultId_idx`
- `Transaction_status_idx`
- `Transaction_from_idx`
- `Transaction_to_idx`
- `Transaction_createdAt_idx`
- `Transaction_executedAt_idx`

### Override Indexes
- `Override_transactionId_key` (UNIQUE)
- `Override_vaultId_idx`
- `Override_status_idx`
- `Override_nonce_idx`
- `Override_canExecuteAfter_idx`
- `Override_createdAt_idx`

### Monitoring Indexes

To check index usage:

```sql
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

To find missing indexes:

```sql
SELECT schemaname, tablename, attname, n_distinct, correlation
FROM pg_stats
WHERE schemaname = 'public' AND n_distinct > 100
ORDER BY abs(correlation) DESC;
```

---

## Performance Considerations

### Connection Pooling

Prisma manages connections automatically. Configure via environment variables:

```env
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
```

Railway limits:
- Free tier: 20 connections
- Hobby tier: 20 connections
- Pro tier: 100 connections

### Query Optimization

Always use `select` to limit fields:

```typescript
// Bad (returns all fields)
await prisma.vault.findMany()

// Good (returns only needed fields)
await prisma.vault.findMany({
  select: {
    id: true,
    publicKey: true,
    dailyLimit: true,
  }
})
```

### Pagination

Always paginate large result sets:

```typescript
await prisma.transaction.findMany({
  skip: (page - 1) * pageSize,
  take: pageSize,
  orderBy: { createdAt: 'desc' },
})
```

### Transactions

Use transactions for multi-step operations:

```typescript
await prisma.$transaction(async (tx) => {
  const vault = await tx.vault.update({ ... })
  const transaction = await tx.transaction.create({ ... })
  return { vault, transaction }
})
```

---

## Backup and Recovery

### Automated Backups

Railway automatically backs up PostgreSQL databases:
- Free tier: 7-day retention
- Pro tier: 30-day retention

### Manual Backup

```bash
# Backup database
railway run pg_dump $DATABASE_URL > backup.sql

# Restore database
railway run psql $DATABASE_URL < backup.sql
```

### Point-in-Time Recovery

Available on Railway Pro plan. Contact Railway support for details.

---

## Schema Versioning

The schema is tracked in Git. Always:

1. Create migrations for schema changes
2. Test migrations in development
3. Review generated SQL
4. Deploy to staging before production
5. Monitor migration application in production logs

**Never:**
- Manually edit migration files after they've been applied
- Skip migrations
- Use `db push` in production
- Delete the `_prisma_migrations` table

---

## Contact

For database issues:
- Check Railway logs first
- Review Prisma documentation: https://www.prisma.io/docs
- Railway support: https://railway.app/help
- Prisma Discord: https://pris.ly/discord
