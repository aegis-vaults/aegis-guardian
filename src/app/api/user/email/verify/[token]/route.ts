import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import logger from '@/lib/logger'
import { Prisma } from '@prisma/client'

/**
 * GET /api/user/email/verify/[token]
 *
 * Verify email address using token from email
 *
 * This endpoint is called when the user clicks the link in their verification email.
 * On success, it redirects to the app with a success message.
 * On failure, it redirects with an error message.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params

    if (!token) {
      return redirectToApp('error', 'missing_token')
    }

    // Find user with this verification token
    const user = await prisma.user.findFirst({
      where: {
        emailVerifyToken: token,
        emailVerifyExpiry: {
          gt: new Date(), // Token not expired
        },
      },
    })

    if (!user) {
      logger.warn({ token: token.slice(0, 8) }, 'Invalid or expired verification token')
      return redirectToApp('error', 'invalid_token')
    }

    // Mark email as verified and clear token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpiry: null,
      },
    })

    logger.info({ userId: user.id, email: user.email }, 'Email verified successfully')

    return redirectToApp('success', 'email_verified')
  } catch (error) {
    // Handle database connection errors specifically
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientRustPanicError
    ) {
      logger.error({ error: error.message, code: 'code' in error ? error.code : 'UNKNOWN' }, 'Database connection error')
      return redirectToApp('error', 'database_unavailable')
    }

    logger.error({ error }, 'Failed to verify email')
    return redirectToApp('error', 'verification_failed')
  }
}

/**
 * Helper function to redirect to the frontend app with status
 */
function redirectToApp(status: 'success' | 'error', code: string): NextResponse {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const redirectUrl = `${appUrl}/settings?${status}=${code}`

  return NextResponse.redirect(redirectUrl, { status: 302 })
}
