import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { ApiResponse, SolanaPublicKeySchema, ValidationError } from '@/types'
import { BlinkGeneratorService } from '@/lib/services/blink-generator'
import { NotificationService } from '@/lib/services/notifications'

const cache = new CacheService()
const blinkGenerator = new BlinkGeneratorService()
const notificationService = new NotificationService()

/**
 * POST /api/transactions/blocked
 *
 * Called by SDK when an agent transaction is blocked by policy.
 * Creates an override request notification for the vault owner.
 *
 * Body:
 * {
 *   "vaultPublicKey": "string",
 *   "destination": "string",
 *   "amount": "string",
 *   "reason": "DailyLimitExceeded" | "NotWhitelisted" | "VaultPaused"
 * }
 */
const BlockedTransactionSchema = z.object({
  vaultPublicKey: SolanaPublicKeySchema,
  destination: SolanaPublicKeySchema,
  amount: z.string().regex(/^\d+$/, 'Amount must be a valid number'),
  reason: z.enum(['DailyLimitExceeded', 'NotWhitelisted', 'VaultPaused']),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate request body
    const validationResult = BlockedTransactionSchema.safeParse(body)
    if (!validationResult.success) {
      throw new ValidationError('Invalid request body', validationResult.error.issues)
    }

    const { vaultPublicKey, destination, amount, reason } = validationResult.data

    logger.info(
      { vaultPublicKey, destination, amount, reason },
      'Blocked transaction notification received from SDK'
    )

    // Find the vault with user
    const vault = await prisma.vault.findUnique({
      where: { publicKey: vaultPublicKey },
      include: { user: true },
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

    if (!vault.user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'USER_NOT_LINKED',
            message: 'Vault is not linked to a user. Cannot send notifications.',
          },
        } as ApiResponse<never>,
        { status: 400 }
      )
    }

    // Create a transaction record
    const transaction = await prisma.transaction.create({
      data: {
        signature: `sdk-${Date.now()}-${Math.random().toString(36).substring(7)}`, // Temporary signature
        vaultId: vault.id,
        from: vault.owner,
        to: destination,
        amount: BigInt(amount),
        status: 'BLOCKED',
        blockReason: reason,
        blockedAt: new Date(),
        blockTime: BigInt(Math.floor(Date.now() / 1000)),
      },
    })

    logger.info({ transactionId: transaction.id, vaultId: vault.id }, 'Blocked transaction recorded')

    // Generate Blink URL - this creates both the raw action URL and the shareable dial.to URL
    const { actionUrl, blinkUrl } = await blinkGenerator.generateBlockedTransactionBlink(
      vault.id,
      transaction.id
    )

    logger.info({ 
      actionUrl, 
      blinkUrl, 
      transactionId: transaction.id,
      baseUrl: blinkGenerator.getBaseUrl(),
    }, 'Blink URL generated')

    // Send notifications via all configured channels
    // The blinkUrl is the shareable dial.to URL that renders the Blink card
    await notificationService.sendOverrideNotification(
      {
        id: transaction.id,
        vaultId: vault.id,
        transactionId: transaction.signature,
        nonce: BigInt(0), // Not an actual override yet
        requestedBy: vault.owner,
        requestedAmount: BigInt(amount),
        destination,
        canExecuteAfter: BigInt(0),
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour expiry
        status: 'PENDING',
        approvedBy: null,
        approvedAt: null,
        executedAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        blinkUrl: blinkUrl, // Use the shareable dial.to URL for notifications
      } as any,
      vault as any,
      vault.user
    )

    logger.info(
      { vaultId: vault.id, transactionId: transaction.id, userId: vault.user.id, blinkUrl },
      'Notifications sent for blocked transaction'
    )

    // Invalidate caches
    await cache.deletePattern(`transactions:vault:${vaultPublicKey}:*`)

    return NextResponse.json(
      {
        success: true,
        data: {
          transactionId: transaction.id,
          actionUrl,      // Raw API URL for programmatic access
          blinkUrl,       // Shareable dial.to URL for users
          message: 'Override notification sent to vault owner',
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

    logger.error({ error }, 'Failed to process blocked transaction notification')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process blocked transaction notification',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
