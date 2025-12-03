import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { SolanaPublicKeySchema, NotFoundError } from '@/types'
import { getAuthContext, hasVaultAccess } from '@/lib/auth'

const cache = new CacheService()

/**
 * GET /api/vaults/[id]
 *
 * Get a single vault by ID with all related data
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {

    // Try cache first
    const cacheKey = `vault:${id}`
    const cached = await cache.get<unknown>(cacheKey)
    if (cached) {
      return NextResponse.json({ success: true, data: cached })
    }

    // Fetch vault with related data
    const vault = await prisma.vault.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            tier: true,
            email: true,
          },
        },
        transactions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            signature: true,
            from: true,
            to: true,
            amount: true,
            status: true,
            createdAt: true,
            executedAt: true,
            blockedAt: true,
          },
        },
        overrides: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            nonce: true,
            status: true,
            canExecuteAfter: true,
            expiresAt: true,
            createdAt: true,
          },
        },
        feeCollections: {
          take: 10,
          orderBy: { timestamp: 'desc' },
          select: {
            id: true,
            amount: true,
            timestamp: true,
          },
        },
        teamMembers: {
          include: {
            user: {
              select: {
                id: true,
                walletAddress: true,
                email: true,
              },
            },
          },
        },
      },
    })

    if (!vault) {
      throw new NotFoundError('Vault not found')
    }

    // Serialize BigInt fields
    const serializedVault = JSON.parse(
      JSON.stringify(vault, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )

    // Cache for 30 seconds
    await cache.set(cacheKey, serializedVault, 30)

    return NextResponse.json({ success: true, data: serializedVault })
  } catch (error: any) {
    logger.error({ 
      error: error?.message || error, 
      stack: error?.stack,
      vaultId: id 
    }, 'Failed to fetch vault')

    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: error.message } },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/vaults/[id]
 *
 * Update vault configuration (whitelist, daily limit, etc.)
 *
 * Request body:
 * {
 *   dailyLimit?: string (BigInt as string)
 *   whitelist?: string[] (array of Solana addresses)
 *   paused?: boolean
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Get authenticated user
    const authContext = await getAuthContext(request)
    if (!authContext) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      )
    }

    const body = await request.json()

    // Validate input
    const UpdateVaultSchema = z.object({
      name: z.string().min(1).max(100).optional(),
      dailyLimit: z.string().regex(/^\d+$/).optional(),
      whitelist: z.array(SolanaPublicKeySchema).max(20).optional(),
      paused: z.boolean().optional(),
      whitelistEnabled: z.boolean().optional(),
    })

    const validatedData = UpdateVaultSchema.parse(body)

    // Check vault exists and user has access
    const existingVault = await prisma.vault.findUnique({
      where: { id },
    })

    if (!existingVault) {
      throw new NotFoundError('Vault not found')
    }

    // Verify ownership
    if (existingVault.userId !== authContext.user.id) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } },
        { status: 403 }
      )
    }

    // If API key is vault-scoped, verify it matches
    if (!hasVaultAccess(authContext, id)) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'API key is not authorized for this vault' } },
        { status: 403 }
      )
    }

    // Update vault
    const updatedVault = await prisma.vault.update({
      where: { id },
      data: {
        ...(validatedData.name && {
          name: validatedData.name,
        }),
        ...(validatedData.dailyLimit && {
          dailyLimit: BigInt(validatedData.dailyLimit),
        }),
        ...(validatedData.whitelist && {
          whitelist: validatedData.whitelist,
        }),
        ...(validatedData.paused !== undefined && {
          paused: validatedData.paused,
          // Keep isActive in sync with paused (isActive = !paused)
          isActive: !validatedData.paused,
        }),
        ...(validatedData.whitelistEnabled !== undefined && {
          whitelistEnabled: validatedData.whitelistEnabled,
        }),
      },
    })

    // Invalidate caches
    await cache.delete(`vault:${id}`)
    await cache.deletePattern(`vaults:list:*`)
    await cache.deletePattern(`analytics:vault:${id}:*`)

    // Serialize BigInt fields
    const serializedVault = JSON.parse(
      JSON.stringify(updatedVault, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )

    logger.info({ vaultId: id, updates: validatedData }, 'Vault updated')

    return NextResponse.json({
      success: true,
      data: serializedVault,
    })
  } catch (error) {
    logger.error({ error, vaultId: id }, 'Failed to update vault')

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Validation error', details: error.issues },
        },
        { status: 400 }
      )
    }

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

/**
 * DELETE /api/vaults/[id]
 *
 * Soft delete a vault (sets isActive = false)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Get authenticated user
    const authContext = await getAuthContext(request)
    if (!authContext) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      )
    }

    // Check vault exists
    const existingVault = await prisma.vault.findUnique({
      where: { id },
    })

    if (!existingVault) {
      throw new NotFoundError('Vault not found')
    }

    // Verify ownership
    if (existingVault.userId !== authContext.user.id) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } },
        { status: 403 }
      )
    }

    // If API key is vault-scoped, verify it matches
    if (!hasVaultAccess(authContext, id)) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'API key is not authorized for this vault' } },
        { status: 403 }
      )
    }

    // Soft delete (set isActive = false)
    const deletedVault = await prisma.vault.update({
      where: { id },
      data: {
        isActive: false,
      },
    })

    // Invalidate caches
    await cache.delete(`vault:${id}`)
    await cache.deletePattern(`vaults:list:*`)

    // Serialize BigInt fields
    const serializedVault = JSON.parse(
      JSON.stringify(deletedVault, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )

    logger.info({ vaultId: id }, 'Vault soft deleted')

    return NextResponse.json({
      success: true,
      data: serializedVault,
      message: 'Vault deactivated successfully',
    })
  } catch (error) {
    logger.error({ error, vaultId: id }, 'Failed to delete vault')

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
