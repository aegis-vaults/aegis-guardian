import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { ApiResponse, PaginatedResponse, ValidationError } from '@/types'

const cache = new CacheService()

/**
 * GET /api/transactions
 *
 * List transactions with pagination and filtering
 *
 * Query parameters:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 20, max: 100)
 * - vaultId: Filter by vault ID
 * - status: Filter by status (PENDING, EXECUTED, BLOCKED, FAILED)
 * - from: Filter by sender address
 * - to: Filter by recipient address
 * - startDate: Filter by date range (ISO string)
 * - endDate: Filter by date range (ISO string)
 * - minAmount: Minimum transaction amount in lamports
 * - maxAmount: Maximum transaction amount in lamports
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')))

    // Filters
    const vaultId = searchParams.get('vaultId') || undefined
    const status = searchParams.get('status') || undefined
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    const startDate = searchParams.get('startDate')
      ? new Date(searchParams.get('startDate')!)
      : undefined
    const endDate = searchParams.get('endDate')
      ? new Date(searchParams.get('endDate')!)
      : undefined
    const minAmount = searchParams.get('minAmount')
      ? BigInt(searchParams.get('minAmount')!)
      : undefined
    const maxAmount = searchParams.get('maxAmount')
      ? BigInt(searchParams.get('maxAmount')!)
      : undefined

    // Validate status if provided
    const validStatuses = ['PENDING', 'EXECUTED', 'BLOCKED', 'FAILED'] as const
    if (status && !validStatuses.includes(status as any)) {
      throw new ValidationError('Invalid status value', [{
        code: 'invalid_enum_value',
        message: 'Status must be one of: PENDING, EXECUTED, BLOCKED, FAILED',
        path: ['status'],
      }])
    }

    // Build cache key
    const cacheKey = `transactions:list:${page}:${pageSize}:${vaultId || ''}:${status || ''}:${from || ''}:${to || ''}:${startDate?.toISOString() || ''}:${endDate?.toISOString() || ''}`

    // Try cache first
    const cached = await cache.get<PaginatedResponse<unknown>>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Build where clause
    const where: any = {
      ...(vaultId && { vaultId }),
      ...(status && { status: status as 'PENDING' | 'EXECUTED' | 'BLOCKED' | 'FAILED' }),
      ...(from && { from }),
      ...(to && { to }),
      ...(startDate || endDate) && {
        createdAt: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      },
      ...(minAmount || maxAmount) && {
        amount: {
          ...(minAmount && { gte: minAmount }),
          ...(maxAmount && { lte: maxAmount }),
        },
      },
    }

    // Execute queries in parallel
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          signature: true,
          vaultId: true,
          from: true,
          to: true,
          amount: true,
          status: true,
          blockReason: true,
          executedAt: true,
          blockedAt: true,
          slot: true,
          blockTime: true,
          createdAt: true,
          vault: {
            select: {
              id: true,
              publicKey: true,
              owner: true,
            },
          },
        },
      }),
      prisma.transaction.count({ where }),
    ])

    const response: ApiResponse<PaginatedResponse<unknown>> = {
      success: true,
      data: {
        items: transactions.map((tx) => ({
          ...tx,
          amount: tx.amount.toString(),
          slot: tx.slot?.toString() || null,
          blockTime: tx.blockTime?.toString() || null,
        })),
        pagination: {
          total,
          page,
          pageSize,
          hasNext: page * pageSize < total,
        },
      },
    }

    // Cache for 15 seconds (shorter TTL since transactions are frequently updated)
    await cache.set(cacheKey, response, 15)

    logger.info({
      page,
      pageSize,
      total,
      filters: { vaultId, status, from, to, startDate, endDate }
    }, 'Transactions listed')

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        } as ApiResponse<never>,
        { status: error.statusCode }
      )
    }

    logger.error({ error }, 'Failed to list transactions')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list transactions',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
