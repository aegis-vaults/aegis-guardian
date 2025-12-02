import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { NotFoundError, ValidationError, SolanaPublicKeySchema } from '@/types'

const cache = new CacheService()

/**
 * GET /api/overrides/[id]
 *
 * Get a single override by ID with all related data
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {

    // Try cache first
    const cacheKey = `override:${id}`
    const cached = await cache.get<unknown>(cacheKey)
    if (cached) {
      return NextResponse.json({ success: true, data: cached })
    }

    // Fetch override with related data
    const override = await prisma.override.findUnique({
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
            overrideDelay: true,
            isActive: true,
          },
        },
      },
    })

    if (!override) {
      throw new NotFoundError('Override not found')
    }

    // Serialize BigInt fields
    const serializedOverride = JSON.parse(
      JSON.stringify(override, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )

    // Cache for 30 seconds
    await cache.set(cacheKey, serializedOverride, 30)

    return NextResponse.json({ success: true, data: serializedOverride })
  } catch (error) {
    logger.error({ error, overrideId: id }, 'Failed to fetch override')

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
 * POST /api/overrides/[id]
 *
 * Manually approve an override (for guardian)
 *
 * Request body:
 * {
 *   approvedBy: string (guardian wallet address)
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const body = await request.json()

    // Validate input
    const ApproveOverrideSchema = z.object({
      approvedBy: SolanaPublicKeySchema,
    })

    const validatedData = ApproveOverrideSchema.parse(body)

    // Check override exists and is pending
    const existingOverride = await prisma.override.findUnique({
      where: { id },
      include: {
        vault: {
          select: {
            guardian: true,
          },
        },
      },
    })

    if (!existingOverride) {
      throw new NotFoundError('Override not found')
    }

    if (existingOverride.status !== 'PENDING') {
      throw new ValidationError('Override is not pending', [{
        code: 'invalid_state',
        message: `Override is already ${existingOverride.status.toLowerCase()}`,
        path: ['status'],
      }])
    }

    // Verify approver is the guardian
    if (existingOverride.vault.guardian !== validatedData.approvedBy) {
      throw new ValidationError('Unauthorized', [{
        code: 'unauthorized',
        message: 'Only the vault guardian can approve overrides',
        path: ['approvedBy'],
      }])
    }

    // Check if override has expired
    const now = Math.floor(Date.now() / 1000)
    if (BigInt(now) > existingOverride.expiresAt) {
      // Update status to expired
      await prisma.override.update({
        where: { id },
        data: { status: 'EXPIRED' },
      })

      throw new ValidationError('Override has expired', [{
        code: 'expired',
        message: 'This override request has expired',
        path: ['expiresAt'],
      }])
    }

    // Approve override
    const updatedOverride = await prisma.override.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: validatedData.approvedBy,
        approvedAt: new Date(),
      },
    })

    // Invalidate caches
    await cache.delete(`override:${id}`)
    await cache.deletePattern(`overrides:list:*`)
    await cache.deletePattern(`analytics:vault:${existingOverride.vaultId}:*`)

    // Serialize BigInt fields
    const serializedOverride = JSON.parse(
      JSON.stringify(updatedOverride, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )

    logger.info({
      overrideId: id,
      vaultId: existingOverride.vaultId,
      approvedBy: validatedData.approvedBy
    }, 'Override approved')

    return NextResponse.json({
      success: true,
      data: serializedOverride,
      message: 'Override approved successfully',
    })
  } catch (error) {
    logger.error({ error, overrideId: id }, 'Failed to approve override')

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Validation error', details: error.issues },
        },
        { status: 400 }
      )
    }

    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: { code: error.code, message: error.message, details: error.details },
        },
        { status: error.statusCode }
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
 * DELETE /api/overrides/[id]
 *
 * Cancel/reject an override request
 *
 * Can be called by either owner (to cancel their request)
 * or guardian (to reject the request)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {

    // Check override exists and can be cancelled
    const existingOverride = await prisma.override.findUnique({
      where: { id },
      include: {
        vault: {
          select: {
            owner: true,
            guardian: true,
          },
        },
      },
    })

    if (!existingOverride) {
      throw new NotFoundError('Override not found')
    }

    if (!['PENDING', 'APPROVED'].includes(existingOverride.status)) {
      throw new ValidationError('Cannot cancel override', [{
        code: 'invalid_state',
        message: `Override is ${existingOverride.status.toLowerCase()} and cannot be cancelled`,
        path: ['status'],
      }])
    }

    // Cancel override
    const cancelledOverride = await prisma.override.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    })

    // Invalidate caches
    await cache.delete(`override:${id}`)
    await cache.deletePattern(`overrides:list:*`)
    await cache.deletePattern(`analytics:vault:${existingOverride.vaultId}:*`)

    // Serialize BigInt fields
    const serializedOverride = JSON.parse(
      JSON.stringify(cancelledOverride, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )

    logger.info({
      overrideId: id,
      vaultId: existingOverride.vaultId
    }, 'Override cancelled')

    return NextResponse.json({
      success: true,
      data: serializedOverride,
      message: 'Override cancelled successfully',
    })
  } catch (error) {
    logger.error({ error, overrideId: id }, 'Failed to cancel override')

    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: { code: error.code, message: error.message, details: error.details },
        },
        { status: error.statusCode }
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
