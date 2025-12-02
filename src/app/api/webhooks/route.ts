import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { ApiResponse, PaginatedResponse, ValidationError } from '@/types'

const cache = new CacheService()

/**
 * GET /api/webhooks
 *
 * List webhook subscriptions with pagination and filtering
 *
 * Query parameters:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 20, max: 100)
 * - vaultId: Filter by vault ID
 * - isActive: Filter by active status
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')))

    // Filters
    const vaultId = searchParams.get('vaultId') || undefined
    const isActive = searchParams.get('isActive')
      ? searchParams.get('isActive') === 'true'
      : undefined

    // Build cache key
    const cacheKey = `webhooks:list:${page}:${pageSize}:${vaultId || ''}:${isActive}`

    // Try cache first
    const cached = await cache.get<PaginatedResponse<unknown>>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Build where clause
    const where = {
      ...(vaultId && { vaultId }),
      ...(isActive !== undefined && { isActive }),
    }

    // Execute queries in parallel
    const [webhooks, total] = await Promise.all([
      prisma.webhook.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          url: true,
          // DO NOT expose secret in list view
          vaultId: true,
          events: true,
          isActive: true,
          failureCount: true,
          lastSuccess: true,
          lastFailure: true,
          maxRetries: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.webhook.count({ where }),
    ])

    const response: ApiResponse<PaginatedResponse<unknown>> = {
      success: true,
      data: {
        items: webhooks,
        pagination: {
          total,
          page,
          pageSize,
          hasNext: page * pageSize < total,
        },
      },
    }

    // Cache for 30 seconds
    await cache.set(cacheKey, response, 30)

    logger.info({
      page,
      pageSize,
      total,
      filters: { vaultId, isActive }
    }, 'Webhooks listed')

    return NextResponse.json(response)
  } catch (error) {
    logger.error({ error }, 'Failed to list webhooks')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list webhooks',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}

/**
 * POST /api/webhooks
 *
 * Create a new webhook subscription
 *
 * Request body:
 * {
 *   url: string (webhook URL)
 *   vaultId?: string (if null, subscribes to all vaults)
 *   events: string[] (array of WebhookEvent enum values)
 *   maxRetries?: number (default: 3)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input
    const CreateWebhookSchema = z.object({
      url: z.string().url().max(2048),
      vaultId: z.string().optional(),
      events: z.array(z.enum([
        'TRANSACTION_BLOCKED',
        'TRANSACTION_EXECUTED',
        'OVERRIDE_REQUESTED',
        'OVERRIDE_APPROVED',
        'OVERRIDE_EXECUTED',
        'VAULT_CREATED',
        'VAULT_UPDATED',
        'POLICY_UPDATED',
      ])).min(1).max(8),
      maxRetries: z.number().int().min(0).max(10).optional().default(3),
    })

    const validatedData = CreateWebhookSchema.parse(body)

    // If vaultId provided, verify it exists
    if (validatedData.vaultId) {
      const vault = await prisma.vault.findUnique({
        where: { id: validatedData.vaultId },
      })

      if (!vault) {
        throw new ValidationError('Vault not found', [{
          code: 'not_found',
          message: 'Vault with the specified ID does not exist',
          path: ['vaultId'],
        }])
      }
    }

    // Generate secure random secret for HMAC signing
    const secret = randomBytes(32).toString('hex')

    // Create webhook
    const webhook = await prisma.webhook.create({
      data: {
        url: validatedData.url,
        secret,
        vaultId: validatedData.vaultId || null,
        events: validatedData.events,
        maxRetries: validatedData.maxRetries,
        isActive: true,
        failureCount: 0,
      },
    })

    // Invalidate cache
    await cache.deletePattern('webhooks:list:*')

    logger.info({
      webhookId: webhook.id,
      vaultId: validatedData.vaultId,
      events: validatedData.events
    }, 'Webhook created')

    return NextResponse.json(
      {
        success: true,
        data: webhook,
        message: 'Webhook created successfully. Store the secret securely - it will not be shown again.',
      } as ApiResponse<unknown>,
      { status: 201 }
    )
  } catch (error) {
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

    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          details: error.details,
        },
        { status: error.statusCode }
      )
    }

    logger.error({ error }, 'Failed to create webhook')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create webhook',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
