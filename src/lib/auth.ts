import { NextRequest } from 'next/server'
import prisma from './db'
import { User } from '@prisma/client'
import { createLogger } from './logger'

const logger = createLogger({ service: 'auth' })

/**
 * Get authenticated user from request
 * Expects 'x-user-id' header (simulating gateway/session auth)
 */
export async function getAuthUser(req: NextRequest): Promise<User | null> {
    const userId = req.headers.get('x-user-id')

    if (!userId) {
        return null
    }

    try {
        // Cast prisma to any to avoid stale type error if User model is not yet picked up by IDE
        const user = await (prisma as any).user.findUnique({
            where: { id: userId },
        })

        return user as User
    } catch (error) {
        logger.error({ error, userId }, 'Failed to fetch auth user')
        return null
    }
}
