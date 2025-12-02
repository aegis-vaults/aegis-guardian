import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import logger from '@/lib/logger'
import { ApiResponse, PaginatedResponse } from '@/types'
import { generateApiKey, hashApiKey, getApiKeyPrefix } from '@/lib/api-keys'
import { getAuthUser } from '@/lib/auth'

/**
 * GET /api/api-keys
 *
 * List all API keys for the authenticated user
 *
 * Query parameters:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 20, max: 100)
 * - vaultId: Filter by vault ID
 * - isActive: Filter by active status
 */
export async function GET(request: NextRequest) {
  try {
    // Get authenticated user
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')))
    const vaultId = searchParams.get('vaultId') || undefined
    const isActive = searchParams.get('isActive')
      ? searchParams.get('isActive') === 'true'
      : undefined

    // Build where clause
    const where = {
      userId: user.id,
      ...(vaultId && { vaultId }),
      ...(isActive !== undefined && { isActive }),
    }

    // Execute queries in parallel
    const [apiKeys, total] = await Promise.all([
      prisma.apiKey.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          prefix: true,
          vaultId: true,
          permissions: true,
          isActive: true,
          lastUsedAt: true,
          rateLimit: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      prisma.apiKey.count({ where }),
    ])

    const response: ApiResponse<PaginatedResponse<unknown>> = {
      success: true,
      data: {
        items: apiKeys,
        pagination: {
          total,
          page,
          pageSize,
          hasNext: page * pageSize < total,
        },
      },
    }

    return NextResponse.json(response)
  } catch (error: any) {
    logger.error('Error listing API keys:', error)
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list API keys' } },
      { status: 500 }
    )
  }
}

/**
 * POST /api/api-keys
 *
 * Create a new API key
 *
 * Body:
 * - name: User-friendly name for the key
 * - vaultId: (optional) Scope key to a specific vault
 * - permissions: Array of permissions
 * - expiresAt: (optional) Expiration date
 */
const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  vaultId: z.string().optional(),
  permissions: z.array(z.string()).default(['vault:read']),
  expiresAt: z.string().datetime().optional(),
  environment: z.enum(['live', 'test']).default('live'),
})

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validated = CreateApiKeySchema.parse(body)

    // If vaultId is provided, verify the user owns the vault
    if (validated.vaultId) {
      const vault = await prisma.vault.findFirst({
        where: {
          id: validated.vaultId,
          userId: user.id,
        },
      })

      if (!vault) {
        return NextResponse.json<ApiResponse<null>>(
          { success: false, error: { code: 'NOT_FOUND', message: 'Vault not found or access denied' } },
          { status: 404 }
        )
      }
    }

    // Generate a new API key
    const apiKey = generateApiKey(validated.environment)
    const hashedKey = hashApiKey(apiKey)
    const prefix = getApiKeyPrefix(apiKey)

    // Create the API key record
    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        name: validated.name,
        key: hashedKey,
        prefix,
        userId: user.id,
        vaultId: validated.vaultId,
        permissions: validated.permissions,
        expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : null,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        vaultId: true,
        permissions: true,
        isActive: true,
        rateLimit: true,
        expiresAt: true,
        createdAt: true,
      },
    })

    logger.info(`API key created: ${apiKeyRecord.id} for user ${user.id}`)

    const response: ApiResponse<{ apiKey: typeof apiKeyRecord; key: string }> = {
      success: true,
      data: {
        apiKey: apiKeyRecord,
        key: apiKey, // Only return the plaintext key on creation!
      },
    }

    return NextResponse.json(response, { status: 201 })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: error.issues } },
        { status: 400 }
      )
    }

    logger.error('Error creating API key:', error)
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create API key' } },
      { status: 500 }
    )
  }
}
