import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import logger from '@/lib/logger'
import { ApiResponse } from '@/types'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'

/**
 * POST /api/user/telegram/unlink
 *
 * Unlink Telegram account from user profile
 *
 * Authentication: Required (via x-user-id header or API key)
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication required
    const user = await getAuthUser(request)

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required to unlink Telegram',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    // Check if Telegram is linked
    if (!user.telegramChatId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_LINKED',
            message: 'No Telegram account is currently linked',
          },
        } as ApiResponse<never>,
        { status: 400 }
      )
    }

    // Unlink Telegram account
    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: null,
        telegramUsername: null,
        telegramLinkToken: null,
        telegramLinkExpiry: null,
      },
    })

    logger.info({ userId: user.id }, 'Telegram account unlinked')

    return NextResponse.json({
      success: true,
      data: {
        message: 'Telegram account unlinked successfully',
      },
    } as ApiResponse<{ message: string }>)
  } catch (error) {
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

    logger.error({ error }, 'Failed to unlink Telegram')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to unlink Telegram',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
