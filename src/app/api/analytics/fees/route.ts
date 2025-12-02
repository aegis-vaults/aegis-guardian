import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { rateLimiter } from '@/lib/rate-limit'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ service: 'api-analytics-fees' })

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

        // 3. Fetch Fee Analytics
        // Total fees collected (all time)
        const totalFeesAgg = await prisma.feeCollection.aggregate({
            _sum: { amount: true },
        })
        const totalFees = (totalFeesAgg._sum.amount || BigInt(0)).toString()

        // Fees by vault (top 10)
        const feesByVaultRaw = await prisma.feeCollection.groupBy({
            by: ['vaultId'],
            _sum: { amount: true },
            orderBy: { _sum: { amount: 'desc' } },
            take: 10,
        })

        const feesByVault = await Promise.all(feesByVaultRaw.map(async (f) => {
            const vault = await prisma.vault.findUnique({
                where: { id: f.vaultId },
                select: { publicKey: true, owner: true },
            })
            return {
                vaultId: f.vaultId,
                publicKey: vault?.publicKey || 'Unknown',
                amount: (f._sum.amount || BigInt(0)).toString(),
            }
        }))

        // Fees by time period (last 30 days)
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

        const feesByTimeRaw = await prisma.feeCollection.groupBy({
            by: ['timestamp'], // Note: This groups by exact timestamp, might need date truncation in raw SQL for real daily grouping
            where: { timestamp: { gte: thirtyDaysAgo } },
            _sum: { amount: true },
        })

        // Group by day manually since Prisma doesn't support date_trunc easily in groupBy
        const feesByDayMap = new Map<string, bigint>()
        feesByTimeRaw.forEach(f => {
            const day = f.timestamp.toISOString().split('T')[0]
            const amount = f._sum.amount || BigInt(0)
            feesByDayMap.set(day, (feesByDayMap.get(day) || BigInt(0)) + amount)
        })

        const feesByTime = Array.from(feesByDayMap.entries()).map(([date, amount]) => ({
            date,
            amount: amount.toString(),
        })).sort((a, b) => a.date.localeCompare(b.date))

        // Fees by tier
        // This requires joining FeeCollection -> Vault -> User -> Tier
        // Prisma doesn't support deep groupBy, so we might need raw query or fetch and aggregate
        // For efficiency, let's use a raw query if possible, or just aggregate in code for now as volume is low
        // Actually, let's fetch all vaults with their tiers and aggregate fees
        const vaults = await (prisma as any).vault.findMany({
            select: {
                id: true,
                user: {
                    select: { tier: true }
                }
            }
        })

        const vaultTierMap = new Map<string, string>()
        vaults.forEach((v: any) => {
            if (v.user?.tier) {
                vaultTierMap.set(v.id, v.user.tier)
            }
        })

        const allFees = await prisma.feeCollection.findMany({
            select: { vaultId: true, amount: true }
        })

        const feesByTierMap = new Map<string, bigint>()
        allFees.forEach(f => {
            const tier = vaultTierMap.get(f.vaultId) || 'UNKNOWN'
            feesByTierMap.set(tier, (feesByTierMap.get(tier) || BigInt(0)) + f.amount)
        })

        const feesByTier = Object.fromEntries(
            Array.from(feesByTierMap.entries()).map(([tier, amount]) => [tier, amount.toString()])
        )

        return NextResponse.json({
            totalFees,
            feesByVault,
            feesByTime,
            feesByTier,
        }, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
        })

    } catch (error) {
        logger.error({ error }, 'Failed to get fee analytics')
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
