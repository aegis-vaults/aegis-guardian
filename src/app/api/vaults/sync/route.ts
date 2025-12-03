import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Connection, PublicKey } from '@solana/web3.js'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { ApiResponse, SolanaPublicKeySchema, ValidationError } from '@/types'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'

const cache = new CacheService()

/**
 * POST /api/vaults/sync
 *
 * Manually sync a vault from the Solana blockchain to the database.
 * This is useful when the event listener misses a vault creation event.
 *
 * Body:
 * {
 *   "vaultPublicKey": "string"  // The on-chain vault address
 * }
 */
const SyncVaultSchema = z.object({
  vaultPublicKey: SolanaPublicKeySchema,
})

// VaultConfig account structure offsets
const VAULT_CONFIG_DISCRIMINATOR = [99, 86, 43, 216, 184, 102, 119, 77]

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
            message: 'Authentication required to sync vaults',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    const body = await request.json()

    // Validate request body
    const validationResult = SyncVaultSchema.safeParse(body)
    if (!validationResult.success) {
      throw new ValidationError('Invalid request body', validationResult.error.issues)
    }

    const { vaultPublicKey } = validationResult.data

    // Connect to Solana
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
    const connection = new Connection(rpcUrl, 'confirmed')

    // Fetch the vault account from chain
    let vaultPubkey: PublicKey
    try {
      vaultPubkey = new PublicKey(vaultPublicKey)
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_PUBLIC_KEY',
            message: 'Invalid vault public key format',
          },
        } as ApiResponse<never>,
        { status: 400 }
      )
    }

    logger.info({ vaultPublicKey, rpcUrl }, 'Fetching vault from Solana')
    const accountInfo = await connection.getAccountInfo(vaultPubkey)

    if (!accountInfo) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VAULT_NOT_FOUND_ON_CHAIN',
            message: 'Vault account not found on the Solana blockchain',
          },
        } as ApiResponse<never>,
        { status: 404 }
      )
    }

    // Parse the vault account data
    // VaultConfig structure from IDL:
    // - discriminator: 8 bytes
    // - authority: 32 bytes (pubkey)
    // - agent_signer: 32 bytes (pubkey)
    // - daily_limit: 8 bytes (u64)
    // - spent_today: 8 bytes (u64)
    // - last_reset: 8 bytes (i64)
    // - whitelist: 20 * 32 bytes (array of 20 pubkeys)
    // - whitelist_count: 1 byte (u8)
    // - tier: 1 byte (enum)
    // - fee_basis_points: 2 bytes (u16)
    // - name: 50 bytes (array)
    // - name_len: 1 byte (u8)
    // - paused: 1 byte (bool)
    // - override_nonce: 8 bytes (u64)
    // - bump: 1 byte (u8)

    const data = accountInfo.data

    // Verify discriminator
    const discriminator = Array.from(data.slice(0, 8))
    const isVaultConfig = discriminator.every((b, i) => b === VAULT_CONFIG_DISCRIMINATOR[i])

    if (!isVaultConfig) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_VAULT_ACCOUNT',
            message: 'Account is not a valid Aegis vault',
          },
        } as ApiResponse<never>,
        { status: 400 }
      )
    }

    // Parse fields
    let offset = 8 // Skip discriminator
    const authority = new PublicKey(data.slice(offset, offset + 32)).toBase58()
    offset += 32

    const agentSigner = new PublicKey(data.slice(offset, offset + 32)).toBase58()
    offset += 32

    const dailyLimit = data.readBigUInt64LE(offset)
    offset += 8

    const spentToday = data.readBigUInt64LE(offset)
    offset += 8

    const lastReset = data.readBigInt64LE(offset)
    offset += 8

    // Skip whitelist (20 * 32 = 640 bytes)
    offset += 640

    const whitelistCount = data.readUInt8(offset)
    offset += 1

    // Skip tier (1 byte)
    offset += 1

    // Skip fee_basis_points (2 bytes)
    offset += 2

    // Read name
    const nameBytes = data.slice(offset, offset + 50)
    offset += 50

    const nameLen = data.readUInt8(offset)
    offset += 1

    const name = nameLen > 0 ? Buffer.from(nameBytes.slice(0, nameLen)).toString('utf8') : undefined

    const paused = data.readUInt8(offset) === 1
    offset += 1

    logger.info({
      vaultPublicKey,
      authority,
      agentSigner,
      dailyLimit: dailyLimit.toString(),
      paused,
      nameLen,
      name,
      userWallet: user.walletAddress
    }, 'Parsed vault account data')

    // Verify the user is the owner
    if (authority !== user.walletAddress) {
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

    // Upsert the vault in database
    const vault = await prisma.vault.upsert({
      where: { publicKey: vaultPublicKey },
      create: {
        publicKey: vaultPublicKey,
        owner: authority,
        guardian: authority, // Use authority as guardian
        agentSigner,
        dailyLimit,
        dailySpent: spentToday,
        lastResetTime: lastReset,
        whitelistEnabled: whitelistCount > 0,
        whitelist: [],
        overrideDelay: 3600, // Default 1 hour
        pendingOverride: false,
        isActive: !paused, // paused vault = not active
        userId: user.id, // Link to user
        name,
      },
      update: {
        owner: authority,
        agentSigner,
        dailyLimit,
        dailySpent: spentToday,
        lastResetTime: lastReset,
        whitelistEnabled: whitelistCount > 0,
        isActive: !paused,
        userId: user.id, // Link to user
        ...(name && { name }),
      },
    })

    // Invalidate cache
    await cache.delete(`vault:${vaultPublicKey}`)
    await cache.deletePattern('vaults:list:*')

    logger.info(
      { vaultId: vault.id, vaultPublicKey, userId: user.id, authority, agentSigner },
      'Vault synced from blockchain'
    )

    return NextResponse.json(
      {
        success: true,
        data: {
          ...vault,
          dailyLimit: vault.dailyLimit.toString(),
          dailySpent: vault.dailySpent.toString(),
          lastResetTime: vault.lastResetTime.toString(),
          agentSigner, // Include from on-chain data
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

    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error({ error: errorMessage, stack: error instanceof Error ? error.stack : undefined }, 'Failed to sync vault')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: `Failed to sync vault from blockchain: ${errorMessage}`,
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}

