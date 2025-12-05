import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { ApiResponse, PaginatedResponse, SolanaPublicKeySchema, ValidationError } from '@/types'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'

const cache = new CacheService()

/**
 * GET /api/vaults
 *
 * List all vaults with pagination and filtering
 *
 * Query parameters:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 20, max: 100)
 * - owner: Filter by owner address
 * - guardian: Filter by guardian address
 * - isActive: Filter by active status
 * - myVaults: If authenticated, filter to only user's vaults (default: false)
 */
export async function GET(request: NextRequest) {
  try {
    // Get authenticated user (optional for this endpoint)
    const user = await getAuthUser(request)

    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')))
    const owner = searchParams.get('owner') || undefined
    const guardian = searchParams.get('guardian') || undefined
    const isActive = searchParams.get('isActive')
      ? searchParams.get('isActive') === 'true'
      : undefined
    const myVaults = searchParams.get('myVaults') === 'true'

    // If myVaults is requested, user must be authenticated
    if (myVaults && !user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required to filter by your vaults',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    // Build cache key (include userId if filtering by user)
    const cacheKey = `vaults:list:${page}:${pageSize}:${owner || ''}:${guardian || ''}:${isActive}:${myVaults && user ? user.id : ''}`

    // Try cache first
    const cached = await cache.get<PaginatedResponse<unknown>>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Build where clause
    const where = {
      ...(owner && { owner }),
      ...(guardian && { guardian }),
      ...(isActive !== undefined && { isActive }),
      ...(myVaults && user && { userId: user.id }),
    }

    // Execute queries in parallel
    const [vaults, total] = await Promise.all([
      prisma.vault.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          publicKey: true,
          name: true,
          agentSigner: true,
          owner: true,
          guardian: true,
          dailyLimit: true,
          dailySpent: true,
          lastResetTime: true,
          whitelistEnabled: true,
          whitelist: true,
          overrideDelay: true,
          pendingOverride: true,
          isActive: true,
          vaultNonce: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              transactions: true,
              overrides: true,
            },
          },
        },
      }),
      prisma.vault.count({ where }),
    ])

    const response: ApiResponse<PaginatedResponse<unknown>> = {
      success: true,
      data: {
        items: vaults.map((vault) => ({
          ...vault,
          dailyLimit: vault.dailyLimit.toString(),
          dailySpent: vault.dailySpent.toString(),
          lastResetTime: vault.lastResetTime.toString(),
          vaultNonce: vault.vaultNonce.toString(),
          // Flatten _count for easier frontend consumption
          transactionCount: vault._count.transactions,
          overrideCount: vault._count.overrides,
        })),
        pagination: {
          total,
          page,
          pageSize,
          hasNext: page * pageSize < total,
        },
      },
    }

    // Cache for 60 seconds (cache failures are non-blocking)
    await cache.set(cacheKey, response, 60)

    logger.info({ page, pageSize, total, owner, guardian }, 'Vaults listed')

    return NextResponse.json(response)
  } catch (error) {
    // Handle database connection errors specifically
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientRustPanicError
    ) {
      logger.error({ error: error.message, code: 'code' in error ? error.code : 'UNKNOWN' }, 'Database connection error')

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database is temporarily unavailable. Please try again in a moment.',
          },
        } as ApiResponse<never>,
        { status: 503 }
      )
    }

    logger.error({ error }, 'Failed to list vaults')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list vaults',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}

/**
 * POST /api/vaults
 *
 * Create a new vault record (typically called by event listener)
 *
 * Body:
 * {
 *   "publicKey": "string",
 *   "owner": "string",
 *   "guardian": "string",
 *   "agentSigner": "string",
 *   "dailyLimit": "string",
 *   "overrideDelay": number
 * }
 */
const CreateVaultSchema = z.object({
  publicKey: SolanaPublicKeySchema,
  owner: SolanaPublicKeySchema,
  guardian: SolanaPublicKeySchema,
  agentSigner: SolanaPublicKeySchema,
  dailyLimit: z.string().regex(/^\d+$/, 'Daily limit must be a valid number'),
  overrideDelay: z.number().int().min(0).max(86400), // Max 24 hours
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate request body
    const validationResult = CreateVaultSchema.safeParse(body)
    if (!validationResult.success) {
      throw new ValidationError('Invalid request body', validationResult.error.issues)
    }

    const { publicKey, owner, guardian, agentSigner, dailyLimit, overrideDelay } = validationResult.data

    // Check if vault already exists
    const existing = await prisma.vault.findUnique({
      where: { publicKey },
    })

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VAULT_EXISTS',
            message: 'Vault with this public key already exists',
          },
        } as ApiResponse<never>,
        { status: 409 }
      )
    }

    // Create vault
    const vault = await prisma.vault.create({
      data: {
        publicKey,
        owner,
        guardian,
        agentSigner,
        dailyLimit: BigInt(dailyLimit),
        dailySpent: BigInt(0),
        lastResetTime: BigInt(Math.floor(Date.now() / 1000)),
        whitelistEnabled: false,
        whitelist: [],
        overrideDelay,
        pendingOverride: false,
        isActive: true,
      },
    })

    // Invalidate cache
    await cache.deletePattern('vaults:list:*')

    logger.info({ vaultId: vault.id, publicKey }, 'Vault created')

    return NextResponse.json(
      {
        success: true,
        data: {
          ...vault,
          dailyLimit: vault.dailyLimit.toString(),
          dailySpent: vault.dailySpent.toString(),
          lastResetTime: vault.lastResetTime.toString(),
          vaultNonce: vault.vaultNonce.toString(),
        },
      } as ApiResponse<unknown>,
      { status: 201 }
    )
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

    // Handle database connection errors specifically
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientRustPanicError
    ) {
      logger.error({ error: error.message, code: 'code' in error ? error.code : 'UNKNOWN' }, 'Database connection error')

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database is temporarily unavailable. Please try again in a moment.',
          },
        } as ApiResponse<never>,
        { status: 503 }
      )
    }

    logger.error({ error }, 'Failed to create vault')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create vault',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
