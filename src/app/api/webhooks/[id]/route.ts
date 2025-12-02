import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { NotFoundError } from '@/types'

const cache = new CacheService()

/**
 * GET /api/webhooks/[id]
 *
 * Get a single webhook by ID
 * Note: Secret is masked in response for security
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {

    // Try cache first
    const cacheKey = `webhook:${id}`
    const cached = await cache.get<unknown>(cacheKey)
    if (cached) {
      return NextResponse.json({ success: true, data: cached })
    }

    // Fetch webhook
    const webhook = await prisma.webhook.findUnique({
      where: { id },
    })

    if (!webhook) {
      throw new NotFoundError('Webhook not found')
    }

    // Mask secret for security
    const maskedWebhook = {
      ...webhook,
      secret: '***MASKED***',
    }

    // Cache for 60 seconds
    await cache.set(cacheKey, maskedWebhook, 60)

    return NextResponse.json({ success: true, data: maskedWebhook })
  } catch (error) {
    logger.error({ error, webhookId: id }, 'Failed to fetch webhook')

    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/webhooks/[id]
 *
 * Update webhook configuration
 *
 * Request body:
 * {
 *   url?: string
 *   events?: string[]
 *   isActive?: boolean
 *   maxRetries?: number
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const body = await request.json()

    // Validate input
    const UpdateWebhookSchema = z.object({
      url: z.string().url().max(2048).optional(),
      events: z.array(z.enum([
        'TRANSACTION_BLOCKED',
        'TRANSACTION_EXECUTED',
        'OVERRIDE_REQUESTED',
        'OVERRIDE_APPROVED',
        'OVERRIDE_EXECUTED',
        'VAULT_CREATED',
        'VAULT_UPDATED',
        'POLICY_UPDATED',
      ])).min(1).max(8).optional(),
      isActive: z.boolean().optional(),
      maxRetries: z.number().int().min(0).max(10).optional(),
    })

    const validatedData = UpdateWebhookSchema.parse(body)

    // Check webhook exists
    const existingWebhook = await prisma.webhook.findUnique({
      where: { id },
    })

    if (!existingWebhook) {
      throw new NotFoundError('Webhook not found')
    }

    // Update webhook
    const updatedWebhook = await prisma.webhook.update({
      where: { id },
      data: {
        ...(validatedData.url && { url: validatedData.url }),
        ...(validatedData.events && { events: validatedData.events }),
        ...(validatedData.isActive !== undefined && { isActive: validatedData.isActive }),
        ...(validatedData.maxRetries !== undefined && { maxRetries: validatedData.maxRetries }),
      },
    })

    // Mask secret in response
    const maskedWebhook = {
      ...updatedWebhook,
      secret: '***MASKED***',
    }

    // Invalidate caches
    await cache.delete(`webhook:${id}`)
    await cache.deletePattern('webhooks:list:*')

    logger.info({
      webhookId: id,
      updates: validatedData
    }, 'Webhook updated')

    return NextResponse.json({
      success: true,
      data: maskedWebhook,
    })
  } catch (error) {
    logger.error({ error, webhookId: id }, 'Failed to update webhook')

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          details: error.issues,
        },
        { status: 400 }
      )
    }

    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/webhooks/[id]
 *
 * Delete a webhook subscription
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {

    // Check webhook exists
    const existingWebhook = await prisma.webhook.findUnique({
      where: { id },
    })

    if (!existingWebhook) {
      throw new NotFoundError('Webhook not found')
    }

    // Delete webhook
    await prisma.webhook.delete({
      where: { id },
    })

    // Invalidate caches
    await cache.delete(`webhook:${id}`)
    await cache.deletePattern('webhooks:list:*')

    logger.info({ webhookId: id }, 'Webhook deleted')

    return NextResponse.json({
      success: true,
      message: 'Webhook deleted successfully',
    })
  } catch (error) {
    logger.error({ error, webhookId: id }, 'Failed to delete webhook')

    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
