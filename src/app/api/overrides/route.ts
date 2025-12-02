import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { ApiResponse, PaginatedResponse, ValidationError } from '@/types'

const cache = new CacheService()

/**
 * GET /api/overrides
 *
 * List override requests with pagination and filtering
 *
 * Query parameters:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 20, max: 100)
 * - vaultId: Filter by vault ID
 * - status: Filter by status (PENDING, APPROVED, EXECUTED, CANCELLED, EXPIRED)
 * - requestedBy: Filter by requester address
 * - approvedBy: Filter by approver address
 * - startDate: Filter by creation date (ISO string)
 * - endDate: Filter by creation date (ISO string)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')))

    // Filters
    const vaultId = searchParams.get('vaultId') || undefined
    const status = searchParams.get('status') || undefined
    const requestedBy = searchParams.get('requestedBy') || undefined
    const approvedBy = searchParams.get('approvedBy') || undefined
    const startDate = searchParams.get('startDate')
      ? new Date(searchParams.get('startDate')!)
      : undefined
    const endDate = searchParams.get('endDate')
      ? new Date(searchParams.get('endDate')!)
      : undefined

    // Validate status if provided
    const validStatuses = ['PENDING', 'APPROVED', 'EXECUTED', 'CANCELLED', 'EXPIRED'] as const
    if (status && !validStatuses.includes(status as any)) {
      throw new ValidationError('Invalid status value', [{
        code: 'invalid_enum_value',
        message: 'Status must be one of: PENDING, APPROVED, EXECUTED, CANCELLED, EXPIRED',
        path: ['status'],
      }])
    }

    // Build cache key
    const cacheKey = `overrides:list:${page}:${pageSize}:${vaultId || ''}:${status || ''}:${requestedBy || ''}:${approvedBy || ''}:${startDate?.toISOString() || ''}:${endDate?.toISOString() || ''}`

    // Try cache first
    const cached = await cache.get<PaginatedResponse<unknown>>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Build where clause
    const where: any = {
      ...(vaultId && { vaultId }),
      ...(status && { status: status as 'PENDING' | 'APPROVED' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED' }),
      ...(requestedBy && { requestedBy }),
      ...(approvedBy && { approvedBy }),
      ...(startDate || endDate) && {
        createdAt: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      },
    }

    // Execute queries in parallel
    const [overrides, total] = await Promise.all([
      prisma.override.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          vaultId: true,
          transactionId: true,
          nonce: true,
          requestedBy: true,
          requestedAmount: true,
          destination: true,
          blinkUrl: true,
          canExecuteAfter: true,
          expiresAt: true,
          status: true,
          approvedBy: true,
          approvedAt: true,
          executedAt: true,
          cancelledAt: true,
          createdAt: true,
          vault: {
            select: {
              id: true,
              publicKey: true,
              owner: true,
              guardian: true,
              name: true,
            },
          },
        },
      }),
      prisma.override.count({ where }),
    ])

    const response: ApiResponse<PaginatedResponse<unknown>> = {
      success: true,
      data: {
        items: overrides.map((override) => ({
          ...override,
          nonce: override.nonce.toString(),
          requestedAmount: override.requestedAmount?.toString() || null,
          canExecuteAfter: override.canExecuteAfter.toString(),
          expiresAt: override.expiresAt.toString(),
        })),
        pagination: {
          total,
          page,
          pageSize,
          hasNext: page * pageSize < total,
        },
      },
    }

    // Cache for 10 seconds (short TTL for override status changes)
    await cache.set(cacheKey, response, 10)

    logger.info({
      page,
      pageSize,
      total,
      filters: { vaultId, status, requestedBy, approvedBy }
    }, 'Overrides listed')

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

    logger.error({ error }, 'Failed to list overrides')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list overrides',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
