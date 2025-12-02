import { getRedisClient } from './redis'
import { createLogger } from './logger'

const logger = createLogger({ service: 'rate-limit' })

export class RateLimiter {
    private redis = getRedisClient()

    /**
     * Check if a key has exceeded the rate limit
     * @param key - Unique identifier (e.g., user ID or IP)
     * @param limit - Maximum number of requests
     * @param window - Time window in seconds
     * @returns true if allowed, false if limit exceeded
     */
    async check(key: string, limit: number, window: number): Promise<boolean> {
        const now = Date.now()
        const windowStart = now - window * 1000
        const redisKey = `ratelimit:${key}`

        try {
            const multi = this.redis.multi()

            // Remove old requests
            multi.zremrangebyscore(redisKey, 0, windowStart)

            // Add current request
            multi.zadd(redisKey, now, now.toString())

            // Count requests in window
            multi.zcard(redisKey)

            // Set expiry for the key
            multi.expire(redisKey, window)

            const results = await multi.exec()

            if (!results) {
                throw new Error('Redis transaction failed')
            }

            // results[2] is the result of zcard
            const count = results[2][1] as number

            return count <= limit
        } catch (error) {
            logger.error({ error, key }, 'Rate limit check failed')
            // Fail open to avoid blocking legitimate traffic on redis errors
            return true
        }
    }
}

export const rateLimiter = new RateLimiter()
