import { PrismaClient } from '@prisma/client'
import logger from './logger'

/**
 * Prisma client singleton with proper connection pooling
 *
 * Best practices:
 * - Single instance prevents connection pool exhaustion
 * - Development mode uses global to persist across hot reloads
 * - Production mode creates single instance
 * - Logging enabled for query monitoring in development
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
    errorFormat: 'minimal',
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// Log connection events
prisma.$connect().then(() => {
  logger.info('Prisma client connected to database')
}).catch((error) => {
  logger.error({ error }, 'Failed to connect to database')
  process.exit(1)
})

/**
 * Graceful shutdown handler for Prisma client
 * Call this during application shutdown
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect()
  logger.info('Prisma client disconnected')
}

/**
 * Database health check utility
 *
 * @returns true if database is accessible, false otherwise
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch (error) {
    logger.error({ error }, 'Database health check failed')
    return false
  }
}

/**
 * Transaction helper with automatic retry logic
 *
 * @param fn - Transaction function to execute
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns Result of the transaction function
 *
 * @example
 * const result = await withTransaction(async (tx) => {
 *   const vault = await tx.vault.create({ data: {...} })
 *   const transaction = await tx.transaction.create({ data: {...} })
 *   return { vault, transaction }
 * })
 */
export async function withTransaction<T>(
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        maxWait: 5000, // 5 seconds
        timeout: 10000, // 10 seconds
      })
    } catch (error) {
      lastError = error
      logger.warn({ attempt, maxRetries, error }, 'Transaction failed, retrying')

      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  logger.error({ error: lastError, maxRetries }, 'Transaction failed after all retries')
  throw lastError
}

export default prisma
