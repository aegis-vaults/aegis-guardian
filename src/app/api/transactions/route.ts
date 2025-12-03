import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { ApiResponse, PaginatedResponse, ValidationError } from '@/types'
import { getAuthContext, hasVaultAccess } from '@/lib/auth'

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
 * - myTransactions: If authenticated, filter to only user's vault transactions (default: false)
 */
export async function GET(request: NextRequest) {
  try {
    // Get authenticated user (optional for this endpoint)
    const authContext = await getAuthContext(request)

    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')))

    // Filters
    const vaultId = searchParams.get('vaultId') || undefined
    const status = searchParams.get('status') || undefined
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    const myTransactions = searchParams.get('myTransactions') === 'true'
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

    // If myTransactions is requested, user must be authenticated
    if (myTransactions && !authContext) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required to filter by your transactions',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    // If vaultId is specified and user is authenticated with vault-scoped API key, verify access
    if (vaultId && authContext && !hasVaultAccess(authContext, vaultId)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'API key is not authorized for this vault',
          },
        } as ApiResponse<never>,
        { status: 403 }
      )
    }

    // Validate status if provided
    const validStatuses = ['PENDING', 'EXECUTED', 'BLOCKED', 'FAILED'] as const
    if (status && !validStatuses.includes(status as any)) {
      throw new ValidationError('Invalid status value', [{
        code: 'invalid_enum_value',
        message: 'Status must be one of: PENDING, EXECUTED, BLOCKED, FAILED',
        path: ['status'],
      }])
    }

    // If myTransactions is true, get user's vault IDs
    let userVaultIds: string[] | undefined
    if (myTransactions && authContext) {
      const userVaults = await prisma.vault.findMany({
        where: { userId: authContext.user.id },
        select: { id: true },
      })
      userVaultIds = userVaults.map(v => v.id)

      // If user has no vaults, return empty result
      if (userVaultIds.length === 0) {
        return NextResponse.json({
          success: true,
          data: {
            items: [],
            pagination: { total: 0, page, pageSize, hasNext: false },
          },
        } as ApiResponse<PaginatedResponse<unknown>>)
      }
    }

    // Build cache key
    const cacheKey = `transactions:list:${page}:${pageSize}:${vaultId || ''}:${status || ''}:${from || ''}:${to || ''}:${startDate?.toISOString() || ''}:${endDate?.toISOString() || ''}:${authContext?.user.id || ''}`

    // Try cache first
    const cached = await cache.get<PaginatedResponse<unknown>>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Build where clause
    const where: any = {
      ...(vaultId && { vaultId }),
      ...(userVaultIds && { vaultId: { in: userVaultIds } }),
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

/**
 * POST /api/transactions
 *
 * Record a transaction that was executed on-chain.
 * This is used by the SDK/frontend as a backup to the event listener.
 *
 * Body:
 * - signature: Transaction signature
 * - vaultPublicKey: Vault public key
 * - from: Sender address
 * - to: Recipient address
 * - amount: Amount in lamports (string)
 * - status: EXECUTED, BLOCKED, PENDING, FAILED
 * - blockReason: (optional) Reason if blocked
 */
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext(request)
    if (!authContext) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required to record transactions',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    const body = await request.json()
    const { signature, vaultPublicKey, from, to, amount, status, blockReason } = body

    if (!signature || !vaultPublicKey || !from || !to || !amount || !status) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required fields: signature, vaultPublicKey, from, to, amount, status',
          },
        } as ApiResponse<never>,
        { status: 400 }
      )
    }

    // Find vault by public key
    const vault = await prisma.vault.findUnique({
      where: { publicKey: vaultPublicKey },
    })

    if (!vault) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VAULT_NOT_FOUND',
            message: 'Vault not found',
          },
        } as ApiResponse<never>,
        { status: 404 }
      )
    }

    // Check if user owns the vault
    if (vault.userId !== authContext.user.id) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You do not have access to this vault',
          },
        } as ApiResponse<never>,
        { status: 403 }
      )
    }

    // Check if transaction already exists
    const existingTx = await prisma.transaction.findFirst({
      where: { signature },
    })

    if (existingTx) {
      return NextResponse.json({
        success: true,
        data: {
          ...existingTx,
          amount: existingTx.amount.toString(),
          slot: existingTx.slot?.toString() || null,
          blockTime: existingTx.blockTime?.toString() || null,
        },
        message: 'Transaction already exists',
      })
    }

    // Create transaction record
    const transaction = await prisma.transaction.create({
      data: {
        signature,
        vaultId: vault.id,
        from,
        to,
        amount: BigInt(amount),
        status: status as 'PENDING' | 'EXECUTED' | 'BLOCKED' | 'FAILED',
        blockReason,
        executedAt: status === 'EXECUTED' ? new Date() : null,
        blockedAt: status === 'BLOCKED' ? new Date() : null,
      },
    })

    // Update vault daily spent if executed
    if (status === 'EXECUTED') {
      await prisma.vault.update({
        where: { id: vault.id },
        data: {
          dailySpent: {
            increment: BigInt(amount),
          },
        },
      })
    }

    // Invalidate caches
    await cache.delete(`vault:${vaultPublicKey}`)
    await cache.deletePattern(`transactions:*`)

    logger.info({
      signature,
      vaultId: vault.id,
      status,
      amount,
    }, 'Transaction recorded via API')

    return NextResponse.json({
      success: true,
      data: {
        ...transaction,
        amount: transaction.amount.toString(),
        slot: transaction.slot?.toString() || null,
        blockTime: transaction.blockTime?.toString() || null,
      },
    }, { status: 201 })
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to record transaction')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to record transaction',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
