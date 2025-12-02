import { NextRequest, NextResponse } from 'next/server'
import logger from '@/lib/logger'
import { ApiResponse } from '@/types'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'
import { sendTestEmail } from '@/lib/email-verification'

/**
 * POST /api/user/email/test
 *
 * Send a test email notification to the authenticated user
 *
 * Authentication: Required (via x-user-id header or API key)
 * Note: User's email must be verified
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
            message: 'Authentication required to send test email',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    // Check if user has an email
    if (!user.email) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NO_EMAIL',
            message: 'Please set an email address in your profile first',
          },
        } as ApiResponse<never>,
        { status: 400 }
      )
    }

    // Check if email is verified
    if (!user.emailVerified) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Please verify your email address before sending test notifications',
          },
        } as ApiResponse<never>,
        { status: 400 }
      )
    }

    // Send test email
    try {
      await sendTestEmail(user.email)
    } catch (emailError) {
      logger.error({ error: emailError, userId: user.id }, 'Failed to send test email')

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'EMAIL_SEND_FAILED',
            message: 'Failed to send test email. Please try again later.',
          },
        } as ApiResponse<never>,
        { status: 500 }
      )
    }

    logger.info({ userId: user.id, email: user.email }, 'Test email sent')

    return NextResponse.json({
      success: true,
      data: {
        message: 'Test email sent successfully. Please check your inbox.',
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

    logger.error({ error }, 'Failed to send test email')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to send test email',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
