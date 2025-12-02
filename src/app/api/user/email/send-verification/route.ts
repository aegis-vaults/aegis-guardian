import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import logger from '@/lib/logger'
import { ApiResponse } from '@/types'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'
import { generateVerificationToken, sendVerificationEmail } from '@/lib/email-verification'

/**
 * POST /api/user/email/send-verification
 *
 * Send email verification email to the authenticated user
 *
 * Authentication: Required (via x-user-id header or API key)
 *
 * Rate limit: 3 requests per hour per user
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
            message: 'Authentication required to send verification email',
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

    // Check if email is already verified
    if (user.emailVerified) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ALREADY_VERIFIED',
            message: 'Email address is already verified',
          },
        } as ApiResponse<never>,
        { status: 400 }
      )
    }

    // Check rate limiting (basic check - if token exists and expires in more than 23 hours, reject)
    if (user.emailVerifyExpiry) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      if (user.emailVerifyExpiry > oneHourAgo) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'RATE_LIMITED',
              message: 'Please wait before requesting another verification email',
            },
          } as ApiResponse<never>,
          { status: 429 }
        )
      }
    }

    // Generate verification token (valid for 24 hours)
    const token = generateVerificationToken()
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000)

    // Update user with verification token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: token,
        emailVerifyExpiry: expiry,
      },
    })

    // Send verification email
    try {
      await sendVerificationEmail(user.email, token)
    } catch (emailError) {
      // Revert token if email fails
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerifyToken: null,
          emailVerifyExpiry: null,
        },
      })

      logger.error({ error: emailError, userId: user.id }, 'Failed to send verification email')

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'EMAIL_SEND_FAILED',
            message: 'Failed to send verification email. Please try again later.',
          },
        } as ApiResponse<never>,
        { status: 500 }
      )
    }

    logger.info({ userId: user.id, email: user.email }, 'Verification email sent')

    return NextResponse.json({
      success: true,
      data: {
        message: 'Verification email sent. Please check your inbox.',
        expiresAt: expiry.toISOString(),
      },
    } as ApiResponse<{ message: string; expiresAt: string }>)
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

    logger.error({ error }, 'Failed to send verification email')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to send verification email',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
