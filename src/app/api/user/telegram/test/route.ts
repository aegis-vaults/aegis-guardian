import { NextRequest, NextResponse } from 'next/server'
import logger from '@/lib/logger'
import { ApiResponse } from '@/types'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'
import { sendTestTelegramMessage } from '@/lib/telegram'

/**
 * POST /api/user/telegram/test
 *
 * Send a test Telegram notification to the authenticated user
 *
 * Authentication: Required (via x-user-id header or API key)
 * Note: User's Telegram must be linked
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
            message: 'Authentication required to send test Telegram message',
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
            code: 'TELEGRAM_NOT_LINKED',
            message: 'Please link your Telegram account first',
          },
        } as ApiResponse<never>,
        { status: 400 }
      )
    }

    // Send test message
    try {
      await sendTestTelegramMessage(user.telegramChatId)
    } catch (telegramError) {
      logger.error({ error: telegramError, userId: user.id }, 'Failed to send test Telegram message')

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'TELEGRAM_SEND_FAILED',
            message: 'Failed to send test message. Please try again later.',
          },
        } as ApiResponse<never>,
        { status: 500 }
      )
    }

    logger.info({ userId: user.id, chatId: user.telegramChatId }, 'Test Telegram message sent')

    return NextResponse.json({
      success: true,
      data: {
        message: 'Test message sent successfully. Please check your Telegram.',
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

    logger.error({ error }, 'Failed to send test Telegram message')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to send test message',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
