# Aegis Guardian

Backend service for the Aegis on-chain operating system. This Next.js application provides REST APIs, WebSocket connections, event monitoring, and analytics for the Aegis protocol.

## Overview

Aegis Guardian is the backend infrastructure that:
- Listens to Solana blockchain events via WebSocket from aegis-protocol
- Stores transaction and vault data in PostgreSQL
- Exposes REST APIs and WebSocket connections for the frontend
- Generates Blinks (Solana Actions) for social sharing
- Sends notifications via webhooks
- Provides analytics and monitoring capabilities

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript (strict mode)
- **Database**: PostgreSQL 15+ with Prisma ORM
- **Cache**: Redis 7+
- **Blockchain**: Solana Web3.js
- **Background Jobs**: Bull/BullMQ
- **Logging**: Pino
- **Validation**: Zod

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Solana CLI 1.18+ (for testing)
- Deployed aegis-protocol program

## Environment Setup

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Configure required environment variables in `.env`:
```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/aegis_guardian

# Redis
REDIS_URL=redis://localhost:6379

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=<your-deployed-program-id>

# Security (generate with: openssl rand -base64 32)
JWT_SECRET=<your-jwt-secret>
WEBHOOK_HMAC_SECRET=<your-hmac-secret>
```

## Installation

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# (Optional) Seed the database
npm run db:seed
```

## Development

```bash
# Start development server
npm run dev

# Run Prisma Studio (database GUI)
npm run prisma:studio

# Type check
npm run type-check

# Lint
npm run lint

# Format code
npm run format
```

The development server will start at `http://localhost:3000`.

## Production

```bash
# Build for production
npm run build

# Start production server
npm start
```

## Project Structure

```
aegis-guardian/
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── migrations/            # Database migrations
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── health/        # Health check endpoint
│   │   │   └── vaults/        # Vault CRUD endpoints
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── lib/
│   │   ├── services/
│   │   │   ├── event-listener.ts    # Solana event monitoring
│   │   │   ├── blink-generator.ts   # Blink/Actions generation
│   │   │   └── analytics.ts         # Analytics aggregation
│   │   ├── db.ts              # Prisma client singleton
│   │   ├── redis.ts           # Redis client & caching
│   │   └── logger.ts          # Structured logging
│   └── types/
│       └── index.ts           # Shared TypeScript types
├── .env.example               # Environment variables template
├── next.config.js             # Next.js configuration
├── tsconfig.json              # TypeScript configuration
└── package.json
```

## API Endpoints

### Health Check
- `GET /api/health` - Service health status

### Vaults
- `GET /api/vaults` - List all vaults (paginated)
- `POST /api/vaults` - Create a new vault
- `GET /api/vaults/:id` - Get vault details
- `PATCH /api/vaults/:id` - Update vault configuration

### Transactions
- `GET /api/transactions` - List transactions (paginated)
- `GET /api/transactions/:id` - Get transaction details

### Analytics
- `GET /api/analytics` - Get aggregated metrics
- `GET /api/analytics/realtime` - Real-time metrics

### Actions (Blinks)
- `GET /api/actions/:vault/:nonce` - Get Blink metadata
- `POST /api/actions/:vault/:nonce/approve` - Approve override
- `POST /api/actions/:vault/:nonce/reject` - Reject override

## Key Features

### Event Listener
Monitors Solana program logs for:
- Vault initialization
- Transaction execution
- Transaction blocking
- Override requests
- Policy updates

### Caching Strategy
- Vault data: 5 minutes TTL
- Transaction lists: 30 seconds TTL
- Analytics: 5 minutes TTL
- Real-time metrics: No cache

### Background Jobs
- Daily metrics aggregation
- Webhook delivery with retry
- Cache cleanup
- Analytics computation

### Security
- Input validation with Zod schemas
- Rate limiting on all endpoints
- HMAC signatures for webhooks
- JWT authentication for protected routes

## Database Schema

Key models:
- **Vault**: On-chain vault configuration
- **Transaction**: Executed and blocked transactions
- **Override**: Override requests and approvals
- **Blink**: Generated action URLs
- **Webhook**: Notification subscriptions
- **DailyMetrics**: Aggregated analytics

See `prisma/schema.prisma` for complete schema.

## Monitoring

### Logs
Structured JSON logs using Pino:
```bash
# View logs in development
npm run dev

# Production logs (JSON format)
npm start | pino-pretty
```

### Metrics
Available via `/api/health`:
- Database connectivity
- Redis connectivity
- Service uptime
- Response times

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Deployment

### Environment Variables
Ensure all required environment variables are set in production:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `SOLANA_RPC_URL` - Solana RPC endpoint
- `PROGRAM_ID` - Deployed program address
- `JWT_SECRET` - Authentication secret
- `WEBHOOK_HMAC_SECRET` - Webhook signature secret

### Database Migrations
```bash
# Run migrations in production
npm run prisma:migrate deploy
```

### Scaling Considerations
- Use connection pooling for PostgreSQL (PgBouncer recommended)
- Deploy Redis in cluster mode for high availability
- Use multiple instances with load balancer
- Enable Redis pub/sub for WebSocket broadcasting

## Troubleshooting

### Database Connection Issues
```bash
# Test database connection
npx prisma db pull

# Reset database (development only!)
npx prisma migrate reset
```

### Redis Connection Issues
```bash
# Test Redis connection
redis-cli -u $REDIS_URL ping
```

### Event Listener Not Working
- Verify `PROGRAM_ID` is correct
- Check `SOLANA_RPC_URL` is accessible
- Ensure WebSocket endpoint is available
- Check logs for connection errors

## Contributing

1. Follow TypeScript strict mode guidelines
2. Use Prettier for code formatting
3. Add JSDoc comments for exported functions
4. Write tests for new features
5. Update documentation

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
