import Redis from 'ioredis'
import logger from './logger'

/**
 * Redis client singleton for caching and pub/sub
 *
 * Configuration:
 * - Connection pooling for high performance
 * - Automatic reconnection with exponential backoff
 * - Lazy retry strategy to prevent connection storms
 */
class RedisClient {
  private static instance: Redis | null = null
  private static pubClient: Redis | null = null
  private static subClient: Redis | null = null

  /**
   * Get the main Redis client instance (singleton)
   * Uses lazyConnect to prevent connections during build phase
   */
  public static getInstance(): Redis {
    if (!RedisClient.instance) {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

      RedisClient.instance = new Redis(redisUrl, {
        lazyConnect: true, // Don't connect immediately - connect on first command
        // This prevents connection attempts during Next.js build phase
        maxRetriesPerRequest: 3,
        retryStrategy(times: number) {
          const delay = Math.min(times * 50, 2000)
          logger.warn({ attempt: times, delay }, 'Retrying Redis connection')
          return delay
        },
        reconnectOnError(err: Error) {
          const targetErrors = ['READONLY', 'ECONNREFUSED']
          if (targetErrors.some((targetError) => err.message.includes(targetError))) {
            logger.error({ error: err.message }, 'Redis reconnecting due to error')
            return true
          }
          return false
        },
      })

      RedisClient.instance.on('connect', () => {
        logger.info('Redis client connected')
      })

      RedisClient.instance.on('error', (err) => {
        logger.error({ error: err.message }, 'Redis client error')
      })

      RedisClient.instance.on('close', () => {
        logger.warn('Redis client connection closed')
      })
    }

    return RedisClient.instance
  }

  /**
   * Get Redis publisher client for pub/sub
   * Separate from main client to avoid blocking operations
   */
  public static getPubClient(): Redis {
    if (!RedisClient.pubClient) {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
      RedisClient.pubClient = new Redis(redisUrl, {
        lazyConnect: true, // Don't connect immediately
      })
      logger.info('Redis publisher client created')
    }
    return RedisClient.pubClient
  }

  /**
   * Get Redis subscriber client for pub/sub
   * Separate from main client as subscribers cannot execute other commands
   */
  public static getSubClient(): Redis {
    if (!RedisClient.subClient) {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
      RedisClient.subClient = new Redis(redisUrl, {
        lazyConnect: true, // Don't connect immediately
      })
      logger.info('Redis subscriber client created')
    }
    return RedisClient.subClient
  }

  /**
   * Close all Redis connections
   * Call this during graceful shutdown
   */
  public static async disconnect(): Promise<void> {
    const promises: Promise<unknown>[] = []

    if (RedisClient.instance) {
      promises.push(RedisClient.instance.quit())
      RedisClient.instance = null
    }

    if (RedisClient.pubClient) {
      promises.push(RedisClient.pubClient.quit())
      RedisClient.pubClient = null
    }

    if (RedisClient.subClient) {
      promises.push(RedisClient.subClient.quit())
      RedisClient.subClient = null
    }

    await Promise.all(promises)
    logger.info('All Redis connections closed')
  }
}

/**
 * Cache helper with automatic TTL and JSON serialization
 */
export class CacheService {
  private redis: Redis

  constructor() {
    this.redis = RedisClient.getInstance()
  }

  /**
   * Set a value in cache with automatic JSON serialization
   *
   * @param key - Cache key
   * @param value - Value to cache (will be JSON stringified)
   * @param ttl - Time to live in seconds (default: 300)
   */
  async set<T>(key: string, value: T, ttl: number = 300): Promise<void> {
    try {
      const serialized = JSON.stringify(value)
      await this.redis.setex(key, ttl, serialized)
      logger.debug({ key, ttl }, 'Cache set')
    } catch (error) {
      // Log error but don't throw - cache failures should not break the application
      logger.warn({ error, key }, 'Failed to set cache - continuing without cache')
    }
  }

  /**
   * Get a value from cache with automatic JSON parsing
   *
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key)
      if (!cached) {
        return null
      }
      return JSON.parse(cached) as T
    } catch (error) {
      logger.error({ error, key }, 'Failed to get cache')
      return null
    }
  }

  /**
   * Delete a key from cache
   */
  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key)
      logger.debug({ key }, 'Cache deleted')
    } catch (error) {
      // Log error but don't throw - cache failures should not break the application
      logger.warn({ error, key }, 'Failed to delete cache - continuing without cache')
    }
  }

  /**
   * Delete multiple keys matching a pattern
   * Use with caution in production
   */
  async deletePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern)
      if (keys.length > 0) {
        await this.redis.del(...keys)
        logger.debug({ pattern, count: keys.length }, 'Cache pattern deleted')
      }
    } catch (error) {
      // Log error but don't throw - cache failures should not break the application
      logger.warn({ error, pattern }, 'Failed to delete cache pattern - continuing without cache')
    }
  }
}

// Export the main client getter
export const getRedisClient = RedisClient.getInstance.bind(RedisClient)
export const getPubClient = RedisClient.getPubClient.bind(RedisClient)
export const getSubClient = RedisClient.getSubClient.bind(RedisClient)
export const disconnectRedis = RedisClient.disconnect.bind(RedisClient)

export default RedisClient
