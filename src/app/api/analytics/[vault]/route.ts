import { NextRequest, NextResponse } from 'next/server'
import { AnalyticsService } from '@/lib/services/analytics'
import { getAuthUser } from '@/lib/auth'
import { rateLimiter } from '@/lib/rate-limit'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ service: 'api-analytics-vault' })
const analyticsService = new AnalyticsService()

export const GET = async (
    req: NextRequest,
    { params }: { params: Promise<{ vault: string }> }
) => {
    const { vault: vaultId } = await params
    const searchParams = req.nextUrl.searchParams
    const range = searchParams.get('range') || '7d'

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

        // 3. Validate Vault Ownership
        const vault = await prisma.vault.findUnique({
            where: { id: vaultId },
            select: { userId: true },
        })

        if (!vault) {
            return NextResponse.json({ error: 'Vault not found' }, { status: 404 })
        }

        if (vault.userId !== user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        // 4. Fetch Analytics
        const data = await analyticsService.getVaultAnalytics(vaultId, range)

        return NextResponse.json(data, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
        })
    } catch (error) {
        logger.error({ error, vaultId }, 'Failed to get vault analytics')
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
