import { randomBytes } from 'crypto'
import { createLogger } from './logger'

const logger = createLogger({ service: 'telegram' })

/**
 * Generate a cryptographically secure random token for Telegram linking
 * Returns a 32-character hex string
 */
export function generateTelegramLinkToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(
  chatId: string | number,
  message: string,
  options?: {
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML'
    replyMarkup?: any
  }
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN

  if (!token) {
    logger.error('TELEGRAM_BOT_TOKEN not set')
    throw new Error('Telegram bot token not configured')
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: options?.parseMode,
        reply_markup: options?.replyMarkup,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Telegram API error: ${error.description || response.statusText}`)
    }

    logger.info({ chatId }, 'Telegram message sent')
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to send Telegram message')
    throw error
  }
}

/**
 * Send a test notification message
 */
export async function sendTestTelegramMessage(chatId: string): Promise<void> {
  const message = `
✅ *Test Notification*

This is a test notification from Aegis. Your Telegram notifications are working correctly!

*What you'll receive:*
• Transaction blocked alerts
• Override request notifications
• Policy violation warnings

You can manage your notification preferences in your Aegis settings.
  `.trim()

  await sendTelegramMessage(chatId, message, { parseMode: 'Markdown' })
}

/**
 * Get Telegram bot deep link for account linking
 */
export function getTelegramBotLink(token: string): string {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME

  if (!botUsername) {
    logger.error('TELEGRAM_BOT_USERNAME not set')
    throw new Error('Telegram bot username not configured')
  }

  return `https://t.me/${botUsername}?start=${token}`
}
