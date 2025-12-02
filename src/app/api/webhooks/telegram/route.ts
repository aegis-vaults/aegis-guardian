import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import logger from '@/lib/logger'
import { sendTelegramMessage } from '@/lib/telegram'

/**
 * POST /api/webhooks/telegram
 *
 * Telegram bot webhook endpoint
 *
 * This endpoint receives updates from the Telegram Bot API.
 * It handles user commands like /start for account linking.
 *
 * No authentication required - this is called by Telegram's servers
 * Security: Configure webhook URL in Telegram Bot API with your domain
 */
export async function POST(request: NextRequest) {
  try {
    const update = await request.json()

    logger.info({ update }, 'Telegram webhook received')

    // Handle text messages
    if (update.message?.text) {
      const chatId = update.message.chat.id
      const text = update.message.text
      const username = update.message.from?.username
      const firstName = update.message.from?.first_name

      // Handle /start command for account linking
      if (text.startsWith('/start ')) {
        const token = text.split(' ')[1]

        if (!token) {
          await sendTelegramMessage(
            chatId,
            '❌ Invalid link. Please generate a new link from your Aegis settings.'
          )
          return NextResponse.json({ ok: true })
        }

        // Find user with this link token
        const user = await prisma.user.findFirst({
          where: {
            telegramLinkToken: token,
            telegramLinkExpiry: {
              gt: new Date(), // Token not expired
            },
          },
        })

        if (!user) {
          logger.warn({ token: token.slice(0, 8), chatId }, 'Invalid or expired Telegram link token')

          await sendTelegramMessage(
            chatId,
            '❌ Invalid or expired link token.\n\n' +
            'Please generate a new link from your Aegis settings.'
          )

          return NextResponse.json({ ok: true })
        }

        // Link account
        await prisma.user.update({
          where: { id: user.id },
          data: {
            telegramChatId: chatId.toString(),
            telegramUsername: username || null,
            telegramLinkToken: null,
            telegramLinkExpiry: null,
          },
        })

        logger.info({ userId: user.id, chatId, username }, 'Telegram account linked successfully')

        // Send success message
        await sendTelegramMessage(
          chatId,
          `✅ *Success!* Your Aegis account is now linked.\n\n` +
          `*Welcome, ${firstName || username || 'User'}!*\n\n` +
          `You will receive notifications here when:\n` +
          `• Transactions are blocked\n` +
          `• Override requests are created\n` +
          `• Policy violations occur\n\n` +
          `Use /unlink to disconnect or /help for more commands.`,
          { parseMode: 'Markdown' }
        )

        return NextResponse.json({ ok: true })
      }

      // Handle /unlink command
      if (text === '/unlink') {
        const user = await prisma.user.findFirst({
          where: { telegramChatId: chatId.toString() },
        })

        if (!user) {
          await sendTelegramMessage(
            chatId,
            '❌ Your account is not linked to Aegis.'
          )
          return NextResponse.json({ ok: true })
        }

        // Unlink account
        await prisma.user.update({
          where: { id: user.id },
          data: {
            telegramChatId: null,
            telegramUsername: null,
          },
        })

        logger.info({ userId: user.id, chatId }, 'Telegram account unlinked via bot command')

        await sendTelegramMessage(
          chatId,
          '✅ Your Aegis account has been unlinked.\n\n' +
          'You will no longer receive notifications here. ' +
          'You can link again from your Aegis settings.'
        )

        return NextResponse.json({ ok: true })
      }

      // Handle /status command
      if (text === '/status') {
        const user = await prisma.user.findFirst({
          where: { telegramChatId: chatId.toString() },
          include: {
            _count: {
              select: {
                vaults: true,
              },
            },
          },
        })

        if (!user) {
          await sendTelegramMessage(
            chatId,
            '❌ Your account is not linked to Aegis.\n\n' +
            'Send /start with a link token from your Aegis settings to connect.'
          )
          return NextResponse.json({ ok: true })
        }

        await sendTelegramMessage(
          chatId,
          `✅ *Account Status*\n\n` +
          `• *Linked:* Yes\n` +
          `• *Vaults:* ${user._count.vaults}\n` +
          `• *Email:* ${user.email ? '✅ Set' : '❌ Not set'}\n` +
          `• *Notifications:*\n` +
          `  - Blocked: ${user.notifyOnBlocked ? '✅' : '❌'}\n` +
          `  - Executed: ${user.notifyOnExecuted ? '✅' : '❌'}\n` +
          `  - Overrides: ${user.notifyOnOverride ? '✅' : '❌'}`,
          { parseMode: 'Markdown' }
        )

        return NextResponse.json({ ok: true })
      }

      // Handle /help command
      if (text === '/help') {
        await sendTelegramMessage(
          chatId,
          `🛡️ *Aegis Bot Commands*\n\n` +
          `*/start <token>* - Link your Aegis account\n` +
          `*/status* - Check your account status\n` +
          `*/unlink* - Disconnect your account\n` +
          `*/help* - Show this help message\n\n` +
          `For more information, visit your Aegis dashboard.`,
          { parseMode: 'Markdown' }
        )

        return NextResponse.json({ ok: true })
      }

      // Unknown command
      await sendTelegramMessage(
        chatId,
        '❓ Unknown command. Send /help to see available commands.'
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error({ error }, 'Failed to process Telegram webhook')

    // Return 200 to Telegram to avoid retries
    return NextResponse.json({ ok: false, error: 'Internal error' })
  }
}
