import { NextResponse } from 'next/server'
import { checkDatabaseHealth } from '@/lib/db'
import { getRedisClient } from '@/lib/redis'
import logger from '@/lib/logger'

/**
 * Health check endpoint
 *
 * Returns:
 * - HTTP 200 if all services are healthy
 * - HTTP 503 if any service is unhealthy
 *
 * Checks:
 * - Database connectivity
 * - Redis connectivity
 * - Service uptime
 *
 * @route GET /api/health
 */
export async function GET() {
  const startTime = Date.now()

  try {
    // Check database
    const dbHealthy = await checkDatabaseHealth()

    // Check Redis
    let redisHealthy = false
    try {
      const redis = getRedisClient()
      const pong = await redis.ping()
      redisHealthy = pong === 'PONG'
    } catch (error) {
      logger.error({ error }, 'Redis health check failed')
    }

    const responseTime = Date.now() - startTime
    const allHealthy = dbHealthy && redisHealthy

    const response = {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime,
      services: {
        database: {
          status: dbHealthy ? 'healthy' : 'unhealthy',
        },
        redis: {
          status: redisHealthy ? 'healthy' : 'unhealthy',
        },
      },
      version: process.env.APP_VERSION || '1.0.0',
    }

    logger.info({ ...response, endpoint: '/api/health' }, 'Health check')

    return NextResponse.json(response, {
      status: allHealthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    logger.error({ error }, 'Health check failed')

    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      },
      { status: 503 }
    )
  }
}
