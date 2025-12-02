import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import logger from '@/lib/logger'
import { ApiResponse } from '@/types'
import { getAuthUser } from '@/lib/auth'

/**
 * DELETE /api/api-keys/[id]
 *
 * Revoke (deactivate) an API key
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Get authenticated user
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Verify the API key belongs to the user
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!apiKey) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'API key not found' },
        { status: 404 }
      )
    }

    // Deactivate the API key (soft delete)
    await prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    })

    logger.info(`API key revoked: ${id} by user ${user.id}`)

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'API key revoked successfully' },
    }

    return NextResponse.json(response)
  } catch (error: any) {
    logger.error('Error revoking API key:', error)
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to revoke API key' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/api-keys/[id]
 *
 * Get details of a specific API key
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Get authenticated user
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
    }

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id,
        userId: user.id,
      },
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
    })

    if (!apiKey) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'API key not found' },
        { status: 404 }
      )
    }

    const response: ApiResponse<typeof apiKey> = {
      success: true,
      data: apiKey,
    }

    return NextResponse.json(response)
  } catch (error: any) {
    logger.error('Error fetching API key:', error)
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch API key' },
      { status: 500 }
    )
  }
}
