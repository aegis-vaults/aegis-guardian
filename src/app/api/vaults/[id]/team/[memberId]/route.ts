import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { getAuthContext } from '@/lib/auth'

const cache = new CacheService()

const UpdateTeamMemberSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
})

/**
 * PATCH /api/vaults/[id]/team/[memberId]
 *
 * Update a team member's role
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const { id, memberId } = await params

  try {
    const authContext = await getAuthContext(request)
    if (!authContext) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user has OWNER or ADMIN role on this vault
    const userRole = await prisma.teamMember.findUnique({
      where: {
        userId_vaultId: {
          userId: authContext.userId,
          vaultId: id,
        },
      },
      select: { role: true },
    })

    if (!userRole || (userRole.role !== 'OWNER' && userRole.role !== 'ADMIN')) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Insufficient permissions' },
        { status: 403 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validatedData = UpdateTeamMemberSchema.parse(body)

    // Check if team member exists
    const teamMember = await prisma.teamMember.findUnique({
      where: { id: memberId },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
      },
    })

    if (!teamMember || teamMember.vaultId !== id) {
      return NextResponse.json(
        { success: false, error: 'Team member not found' },
        { status: 404 }
      )
    }

    // Prevent changing the only OWNER's role
    if (teamMember.role === 'OWNER' && validatedData.role !== 'OWNER') {
      const ownerCount = await prisma.teamMember.count({
        where: {
          vaultId: id,
          role: 'OWNER',
        },
      })

      if (ownerCount === 1) {
        return NextResponse.json(
          { success: false, error: 'Cannot change role of the only owner' },
          { status: 400 }
        )
      }
    }

    // Update team member
    const updatedMember = await prisma.teamMember.update({
      where: { id: memberId },
      data: {
        role: validatedData.role,
      },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            tier: true,
            email: true,
            telegramUsername: true,
          },
        },
      },
    })

    // Invalidate cache
    await cache.delete(`vault:${id}:team`)
    await cache.delete(`vault:${id}`)

    logger.info(
      { vaultId: id, memberId, newRole: validatedData.role },
      'Team member role updated'
    )

    return NextResponse.json({ success: true, data: updatedMember })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error({ error, vaultId: id, memberId }, 'Error updating team member')
    return NextResponse.json(
      { success: false, error: 'Failed to update team member' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/vaults/[id]/team/[memberId]
 *
 * Remove a team member from a vault
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const { id, memberId } = await params

  try {
    const authContext = await getAuthContext(request)
    if (!authContext) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user has OWNER or ADMIN role on this vault
    const userRole = await prisma.teamMember.findUnique({
      where: {
        userId_vaultId: {
          userId: authContext.userId,
          vaultId: id,
        },
      },
      select: { role: true },
    })

    if (!userRole || (userRole.role !== 'OWNER' && userRole.role !== 'ADMIN')) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Insufficient permissions' },
        { status: 403 }
      )
    }

    // Check if team member exists
    const teamMember = await prisma.teamMember.findUnique({
      where: { id: memberId },
    })

    if (!teamMember || teamMember.vaultId !== id) {
      return NextResponse.json(
        { success: false, error: 'Team member not found' },
        { status: 404 }
      )
    }

    // Prevent removing the only OWNER
    if (teamMember.role === 'OWNER') {
      const ownerCount = await prisma.teamMember.count({
        where: {
          vaultId: id,
          role: 'OWNER',
        },
      })

      if (ownerCount === 1) {
        return NextResponse.json(
          { success: false, error: 'Cannot remove the only owner' },
          { status: 400 }
        )
      }
    }

    // Delete team member
    await prisma.teamMember.delete({
      where: { id: memberId },
    })

    // Invalidate cache
    await cache.delete(`vault:${id}:team`)
    await cache.delete(`vault:${id}`)

    logger.info({ vaultId: id, memberId }, 'Team member removed')

    return NextResponse.json({
      success: true,
      message: 'Team member removed successfully',
    })
  } catch (error: any) {
    logger.error({ error, vaultId: id, memberId }, 'Error removing team member')
    return NextResponse.json(
      { success: false, error: 'Failed to remove team member' },
      { status: 500 }
    )
  }
}
