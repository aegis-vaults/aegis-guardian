import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import logger from '@/lib/logger'
import { ApiResponse } from '@/types'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'
import { generateTelegramLinkToken, getTelegramBotLink } from '@/lib/telegram'

/**
 * POST /api/user/telegram/link
 *
 * Generate a Telegram link token and return the bot deep link
 *
 * Authentication: Required (via x-user-id header or API key)
 *
 * The user will open the returned link to start a chat with the bot
 * and send the /start command with the token.
 *
 * Rate limit: 5 requests per hour per user
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
            message: 'Authentication required to link Telegram',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    // Check if already linked
    if (user.telegramChatId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ALREADY_LINKED',
            message: 'Telegram account is already linked. Unlink first to connect a different account.',
          },
        } as ApiResponse<never>,
        { status: 400 }
      )
    }

    // Check rate limiting (if token exists and expires in more than 14 minutes, reject)
    if (user.telegramLinkExpiry) {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000)
      if (user.telegramLinkExpiry > oneMinuteAgo) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'RATE_LIMITED',
              message: 'Please wait before generating another link',
            },
          } as ApiResponse<never>,
          { status: 429 }
        )
      }
    }

    // Generate link token (valid for 15 minutes)
    const token = generateTelegramLinkToken()
    const expiry = new Date(Date.now() + 15 * 60 * 1000)

    // Update user with link token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramLinkToken: token,
        telegramLinkExpiry: expiry,
      },
    })

    // Generate Telegram bot deep link
    let botLink: string
    try {
      botLink = getTelegramBotLink(token)
    } catch (error) {
      logger.error({ error, userId: user.id }, 'Failed to generate Telegram bot link')

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'TELEGRAM_NOT_CONFIGURED',
            message: 'Telegram bot is not configured. Please contact support.',
          },
        } as ApiResponse<never>,
        { status: 500 }
      )
    }

    logger.info({ userId: user.id }, 'Telegram link token generated')

    return NextResponse.json({
      success: true,
      data: {
        botLink,
        expiresAt: expiry.toISOString(),
        instructions: 'Click the link to open Telegram and send /start to link your account',
      },
    } as ApiResponse<{ botLink: string; expiresAt: string; instructions: string }>)
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

    logger.error({ error }, 'Failed to generate Telegram link')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate Telegram link',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
