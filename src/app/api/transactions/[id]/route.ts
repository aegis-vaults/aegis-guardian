import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { NotFoundError } from '@/types'

const cache = new CacheService()

/**
 * GET /api/transactions/[id]
 *
 * Get a single transaction by ID with all related data
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {

    // Try cache first
    const cacheKey = `transaction:${id}`
    const cached = await cache.get<unknown>(cacheKey)
    if (cached) {
      return NextResponse.json({ success: true, data: cached })
    }

    // Fetch transaction with related data
    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: {
        vault: {
          select: {
            id: true,
            publicKey: true,
            owner: true,
            guardian: true,
            name: true,
            dailyLimit: true,
            dailySpent: true,
            whitelistEnabled: true,
            whitelist: true,
            isActive: true,
          },
        },
        blink: {
          select: {
            id: true,
            actionUrl: true,
            title: true,
            description: true,
            label: true,
            isActive: true,
            usedCount: true,
            createdAt: true,
            expiresAt: true,
          },
        },
        feeCollections: {
          select: {
            id: true,
            amount: true,
            timestamp: true,
          },
        },
      },
    })

    if (!transaction) {
      throw new NotFoundError('Transaction not found')
    }

    // Serialize BigInt fields
    const serializedTransaction = JSON.parse(
      JSON.stringify(transaction, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )

    // Cache for 60 seconds
    await cache.set(cacheKey, serializedTransaction, 60)

    return NextResponse.json({ success: true, data: serializedTransaction })
  } catch (error) {
    logger.error({ error, transactionId: id }, 'Failed to fetch transaction')

    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: error.message } },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
