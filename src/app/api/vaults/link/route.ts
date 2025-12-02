import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { ApiResponse, SolanaPublicKeySchema, ValidationError } from '@/types'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'

const cache = new CacheService()

/**
 * POST /api/vaults/link
 *
 * Link an existing vault to the authenticated user
 * This is called after creating a vault on-chain to associate it with the user
 *
 * Body:
 * {
 *   "vaultPublicKey": "string",  // The on-chain vault address
 *   "name": "string"  // Optional user-friendly name
 * }
 */
const LinkVaultSchema = z.object({
  vaultPublicKey: SolanaPublicKeySchema,
  name: z.string().min(1).max(100).optional(),
})

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const user = await getAuthUser(request)

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required to link vaults',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    const body = await request.json()

    // Validate request body
    const validationResult = LinkVaultSchema.safeParse(body)
    if (!validationResult.success) {
      throw new ValidationError('Invalid request body', validationResult.error.issues)
    }

    const { vaultPublicKey, name } = validationResult.data

    // Find the vault
    const vault = await prisma.vault.findUnique({
      where: { publicKey: vaultPublicKey },
    })

    if (!vault) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VAULT_NOT_FOUND',
            message: 'Vault not found. Please wait a few seconds for the vault to sync from the blockchain.',
          },
        } as ApiResponse<never>,
        { status: 404 }
      )
    }

    // Verify the user is the owner
    if (vault.owner !== user.walletAddress) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'You are not the owner of this vault',
          },
        } as ApiResponse<never>,
        { status: 403 }
      )
    }

    // Check if vault is already linked to a different user
    if (vault.userId && vault.userId !== user.id) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VAULT_ALREADY_LINKED',
            message: 'This vault is already linked to a different user',
          },
        } as ApiResponse<never>,
        { status: 409 }
      )
    }

    // Link the vault to the user
    const updatedVault = await prisma.vault.update({
      where: { id: vault.id },
      data: {
        userId: user.id,
        ...(name && { name }),
      },
    })

    // Invalidate cache
    await cache.delete(`vault:${vaultPublicKey}`)
    await cache.deletePattern('vaults:list:*')

    logger.info({ vaultId: vault.id, userId: user.id, vaultPublicKey }, 'Vault linked to user')

    return NextResponse.json(
      {
        success: true,
        data: {
          ...updatedVault,
          dailyLimit: updatedVault.dailyLimit.toString(),
          dailySpent: updatedVault.dailySpent.toString(),
          lastResetTime: updatedVault.lastResetTime.toString(),
        },
      } as ApiResponse<unknown>,
      { status: 200 }
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

    logger.error({ error }, 'Failed to link vault')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to link vault',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
