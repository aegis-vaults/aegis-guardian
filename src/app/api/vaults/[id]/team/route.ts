import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { CacheService } from '@/lib/redis'
import logger from '@/lib/logger'
import { getAuthContext } from '@/lib/auth'

const cache = new CacheService()

const AddTeamMemberSchema = z.object({
  userWalletAddress: z.string().min(32).max(44), // Solana wallet address
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
})

/**
 * GET /api/vaults/[id]/team
 *
 * Get all team members for a vault
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const authContext = await getAuthContext(request)
    if (!authContext) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user has access to this vault (either owner or team member)
    const vault = await prisma.vault.findUnique({
      where: { id },
      select: { userId: true },
    })

    if (!vault) {
      return NextResponse.json(
        { success: false, error: 'Vault not found' },
        { status: 404 }
      )
    }

    // Allow vault owner OR team members to access
    const isOwner = vault.userId === authContext.user.id
    const teamMember = await prisma.teamMember.findUnique({
      where: {
        userId_vaultId: {
          userId: authContext.user.id,
          vaultId: id,
        },
      },
    })

    if (!isOwner && !teamMember) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Not authorized for this vault' },
        { status: 403 }
      )
    }

    // Try cache first
    const cacheKey = `vault:${id}:team`
    const cached = await cache.get<unknown>(cacheKey)
    if (cached) {
      return NextResponse.json({ success: true, data: cached })
    }

    // Fetch team members
    const teamMembers = await prisma.teamMember.findMany({
      where: { vaultId: id },
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
      orderBy: [
        { role: 'asc' }, // OWNER first, then ADMIN, etc.
        { createdAt: 'asc' },
      ],
    })

    // Cache for 5 minutes
    await cache.set(cacheKey, teamMembers, 300)

    return NextResponse.json({ success: true, data: teamMembers })
  } catch (error: any) {
    logger.error({ error, vaultId: id }, 'Error fetching vault team members')
    return NextResponse.json(
      { success: false, error: 'Failed to fetch team members' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/vaults/[id]/team
 *
 * Add a team member to a vault
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const authContext = await getAuthContext(request)
    if (!authContext) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user is vault owner or has OWNER/ADMIN role
    const vault = await prisma.vault.findUnique({
      where: { id },
      select: { userId: true },
    })

    if (!vault) {
      return NextResponse.json(
        { success: false, error: 'Vault not found' },
        { status: 404 }
      )
    }

    const isVaultOwner = vault.userId === authContext.user.id

    const userRole = await prisma.teamMember.findUnique({
      where: {
        userId_vaultId: {
          userId: authContext.user.id,
          vaultId: id,
        },
      },
      select: { role: true },
    })

    const hasPermission = isVaultOwner || (userRole && (userRole.role === 'OWNER' || userRole.role === 'ADMIN'))

    if (!hasPermission) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Insufficient permissions' },
        { status: 403 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validatedData = AddTeamMemberSchema.parse(body)

    // Check if user exists, if not create them
    let user = await prisma.user.findUnique({
      where: { walletAddress: validatedData.userWalletAddress },
    })

    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          walletAddress: validatedData.userWalletAddress,
          tier: 'PERSONAL',
        },
      })
    }

    // Check if user is already a team member
    const existingMember = await prisma.teamMember.findUnique({
      where: {
        userId_vaultId: {
          userId: user.id,
          vaultId: id,
        },
      },
    })

    if (existingMember) {
      return NextResponse.json(
        { success: false, error: 'User is already a team member' },
        { status: 409 }
      )
    }

    // Create team member
    const teamMember = await prisma.teamMember.create({
      data: {
        userId: user.id,
        vaultId: id,
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
      { vaultId: id, userId: user.id, role: validatedData.role },
      'Team member added'
    )

    return NextResponse.json(
      { success: true, data: teamMember },
      { status: 201 }
    )
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.issues },
        { status: 400 }
      )
    }

    logger.error({ error, vaultId: id }, 'Error adding team member')
    return NextResponse.json(
      { success: false, error: 'Failed to add team member' },
      { status: 500 }
    )
  }
}
