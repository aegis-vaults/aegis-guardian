import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import logger from '@/lib/logger'
import { ApiResponse, ValidationError } from '@/types'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'

/**
 * POST /api/user/discord/test
 *
 * Test a Discord webhook URL before saving it
 *
 * Authentication: Required (via x-user-id header or API key)
 *
 * Body:
 * {
 *   "webhookUrl": "string"
 * }
 */
const TestDiscordWebhookSchema = z.object({
  webhookUrl: z
    .string()
    .url('Invalid webhook URL')
    .refine(
      (url) => url.includes('discord.com/api/webhooks/'),
      'Discord webhook URL must be from discord.com/api/webhooks/'
    ),
})

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
            message: 'Authentication required to test Discord webhook',
          },
        } as ApiResponse<never>,
        { status: 401 }
      )
    }

    const body = await request.json()

    // Validate request body
    const validationResult = TestDiscordWebhookSchema.safeParse(body)
    if (!validationResult.success) {
      throw new ValidationError('Invalid request body', validationResult.error.issues)
    }

    const { webhookUrl } = validationResult.data

    // Send test message to Discord
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [
            {
              title: '✅ Test Notification',
              description: 'This is a test notification from Aegis. Your Discord webhook is working correctly!',
              color: 0x667eea, // Purple
              fields: [
                {
                  name: 'What you\'ll receive',
                  value: '• Transaction blocked alerts\n• Override request notifications\n• Policy violation warnings',
                },
              ],
              footer: {
                text: 'Aegis - On-chain Operating System for AI Finance',
              },
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      })

      if (!response.ok) {
        logger.error(
          { status: response.status, statusText: response.statusText, webhookUrl: webhookUrl.substring(0, 50) },
          'Discord webhook test failed'
        )

        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'DISCORD_WEBHOOK_FAILED',
              message: `Discord webhook test failed: ${response.statusText}`,
            },
          } as ApiResponse<never>,
          { status: 400 }
        )
      }

      logger.info({ userId: user.id }, 'Discord webhook test successful')

      return NextResponse.json({
        success: true,
        data: {
          message: 'Test message sent successfully. Please check your Discord channel.',
        },
      } as ApiResponse<{ message: string }>)
    } catch (fetchError) {
      logger.error({ error: fetchError, userId: user.id }, 'Failed to send Discord test message')

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DISCORD_SEND_FAILED',
            message: 'Failed to send test message to Discord. Please verify the webhook URL.',
          },
        } as ApiResponse<never>,
        { status: 500 }
      )
    }
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

    logger.error({ error }, 'Failed to test Discord webhook')

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to test Discord webhook',
        },
      } as ApiResponse<never>,
      { status: 500 }
    )
  }
}
