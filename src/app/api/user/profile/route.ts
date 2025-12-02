import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import logger from '@/lib/logger'
import { ApiResponse, ValidationError } from '@/types'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'

/**
 * GET /api/user/profile
 *
 * Get the authenticated user's profile
 *
 * Authentication: Required (via x-user-id header or API key)
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication required
    const user = await getAuthUser(request)

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required to access profile',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    // Return user profile (excluding sensitive tokens)
    const profile = {
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      emailVerified: user.emailVerified,
      tier: user.tier,
      telegramChatId: user.telegramChatId,
      telegramUsername: user.telegramUsername,
      discordWebhook: user.discordWebhook,
      webhookUrl: user.webhookUrl,
      notifyOnBlocked: user.notifyOnBlocked,
      notifyOnExecuted: user.notifyOnExecuted,
      notifyOnOverride: user.notifyOnOverride,
      quietHoursStart: user.quietHoursStart,
      quietHoursEnd: user.quietHoursEnd,
      timezone: user.timezone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }

    logger.info({ userId: user.id }, 'User profile fetched')

    return NextResponse.json({
      success: true,
      data: profile,
    } as ApiResponse<typeof profile>)
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

    logger.error({ error }, 'Failed to fetch user profile')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch user profile',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/user/profile
 *
 * Update the authenticated user's profile
 *
 * Authentication: Required (via x-user-id header or API key)
 *
 * Body:
 * {
 *   "email"?: string | null,
 *   "discordWebhook"?: string | null,
 *   "webhookUrl"?: string | null,
 *   "notifyOnBlocked"?: boolean,
 *   "notifyOnExecuted"?: boolean,
 *   "notifyOnOverride"?: boolean,
 *   "quietHoursStart"?: number | null,
 *   "quietHoursEnd"?: number | null,
 *   "timezone"?: string | null
 * }
 */
const UpdateProfileSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .optional()
    .nullable(),
  discordWebhook: z
    .string()
    .url('Invalid webhook URL')
    .refine(
      (url) => url.includes('discord.com/api/webhooks/'),
      'Discord webhook URL must be from discord.com/api/webhooks/'
    )
    .optional()
    .nullable(),
  webhookUrl: z
    .string()
    .url('Invalid webhook URL')
    .optional()
    .nullable(),
  notifyOnBlocked: z.boolean().optional(),
  notifyOnExecuted: z.boolean().optional(),
  notifyOnOverride: z.boolean().optional(),
  quietHoursStart: z
    .number()
    .int()
    .min(0)
    .max(23)
    .optional()
    .nullable(),
  quietHoursEnd: z
    .number()
    .int()
    .min(0)
    .max(23)
    .optional()
    .nullable(),
  timezone: z
    .string()
    .max(50)
    .optional()
    .nullable(),
})

export async function PATCH(request: NextRequest) {
  try {
    // Authentication required
    const user = await getAuthUser(request)

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required to update profile',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    const body = await request.json()

    // Validate request body
    const validationResult = UpdateProfileSchema.safeParse(body)
    if (!validationResult.success) {
      throw new ValidationError('Invalid request body', validationResult.error.issues)
    }

    const updates = validationResult.data

    // If email is being updated, reset verification status
    const emailData =
      updates.email !== undefined
        ? {
            email: updates.email,
            emailVerified: false,
            emailVerifyToken: null,
            emailVerifyExpiry: null,
          }
        : {}

    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...emailData,
        ...(updates.discordWebhook !== undefined && { discordWebhook: updates.discordWebhook }),
        ...(updates.webhookUrl !== undefined && { webhookUrl: updates.webhookUrl }),
        ...(updates.notifyOnBlocked !== undefined && { notifyOnBlocked: updates.notifyOnBlocked }),
        ...(updates.notifyOnExecuted !== undefined && { notifyOnExecuted: updates.notifyOnExecuted }),
        ...(updates.notifyOnOverride !== undefined && { notifyOnOverride: updates.notifyOnOverride }),
        ...(updates.quietHoursStart !== undefined && { quietHoursStart: updates.quietHoursStart }),
        ...(updates.quietHoursEnd !== undefined && { quietHoursEnd: updates.quietHoursEnd }),
        ...(updates.timezone !== undefined && { timezone: updates.timezone }),
      },
    })

    // Return updated profile (excluding sensitive tokens)
    const profile = {
      id: updatedUser.id,
      walletAddress: updatedUser.walletAddress,
      email: updatedUser.email,
      emailVerified: updatedUser.emailVerified,
      tier: updatedUser.tier,
      telegramChatId: updatedUser.telegramChatId,
      telegramUsername: updatedUser.telegramUsername,
      discordWebhook: updatedUser.discordWebhook,
      webhookUrl: updatedUser.webhookUrl,
      notifyOnBlocked: updatedUser.notifyOnBlocked,
      notifyOnExecuted: updatedUser.notifyOnExecuted,
      notifyOnOverride: updatedUser.notifyOnOverride,
      quietHoursStart: updatedUser.quietHoursStart,
      quietHoursEnd: updatedUser.quietHoursEnd,
      timezone: updatedUser.timezone,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    }

    logger.info({ userId: user.id, updates: Object.keys(updates) }, 'User profile updated')

    return NextResponse.json({
      success: true,
      data: profile,
    } as ApiResponse<typeof profile>)
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        } as ApiResponse<never>,
        { status: error.statusCode }
      )
    }

    // Handle unique constraint violations (e.g., email already in use)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'EMAIL_IN_USE',
            message: 'This email address is already in use by another account',
          },
        } as ApiResponse<never>,
        { status: 409 }
      )
    }

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

    logger.error({ error }, 'Failed to update user profile')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update user profile',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
