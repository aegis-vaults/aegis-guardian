import { NextRequest, NextResponse } from 'next/server'
import { AnalyticsService } from '@/lib/services/analytics'
import { getAuthUser } from '@/lib/auth'
import { rateLimiter } from '@/lib/rate-limit'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ service: 'api-analytics-global' })
const analyticsService = new AnalyticsService()

export const GET = async (req: NextRequest) => {
    try {
        // 1. Auth Check
        const user = await getAuthUser(req)
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // 2. Rate Limit (100 req/hour)
        const allowed = await rateLimiter.check(user.id, 100, 3600)
        if (!allowed) {
            return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
        }

        // 3. Fetch Global Analytics
        const data = await analyticsService.getGlobalAnalytics()

        return NextResponse.json(data, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
        })
    } catch (error) {
        logger.error({ error }, 'Failed to get global analytics')
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

export const OPTIONS = async () => {
    return new NextResponse(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
        },
    })
}
