import sgMail from '@sendgrid/mail'
import { createLogger } from '../logger'
import { Override, Vault, User } from '@prisma/client'

const logger = createLogger({ service: 'notification-service' })

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY)
} else {
    logger.warn('SENDGRID_API_KEY not set, email notifications will fail')
}

interface NotificationPayload {
    amount: string
    destination: string
    reason: string
    blinkUrl: string
    expiresAt: string
    vaultName: string
}

/**
 * Notification Service
 * Handles sending multi-channel notifications for Aegis events
 */
export class NotificationService {
    /**
     * Send override request notification via all configured channels
     */
    async sendOverrideNotification(
        override: Override,
        vault: Vault & { name?: string },
        user: User
    ): Promise<void> {
        // Fetch transaction details to get amount, destination, and block reason
        let transactionDetails
        try {
            const prisma = await import('../db').then(m => m.default)
            transactionDetails = await prisma.transaction.findUnique({
                where: { signature: override.transactionId }
            })
        } catch (error) {
            logger.error({ error, overrideId: override.id }, 'Failed to fetch transaction details for notification')
        }

        const payload: NotificationPayload = {
            amount: transactionDetails
                ? (Number(transactionDetails.amount) / 1e9).toFixed(4)
                : (Number(override.requestedAmount || 0) / 1e9).toFixed(4),
            destination: transactionDetails?.to || override.destination || 'Unknown',
            reason: transactionDetails?.blockReason || 'Policy Violation',
            blinkUrl: override.blinkUrl || '',
            expiresAt: new Date(Number(override.expiresAt) * 1000).toLocaleString(),
            vaultName: vault.name || vault.publicKey.slice(0, 8),
        }

        const promises: Promise<void>[] = []

        if (user.telegramChatId) {
            promises.push(this.sendTelegram(user.telegramChatId, payload))
        }

        if (user.discordWebhook) {
            promises.push(this.sendDiscord(user.discordWebhook, payload))
        }

        if (user.email) {
            promises.push(this.sendEmail(user.email, payload))
        }

        if (user.webhookUrl) {
            promises.push(this.sendWebhook(user.webhookUrl, payload))
        }

        const results = await Promise.allSettled(promises)

        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                logger.error({ error: result.reason, channelIndex: index }, 'Failed to send notification')
            }
        })

        logger.info({
            userId: user.id,
            successCount: results.filter(r => r.status === 'fulfilled').length
        }, 'Notifications processed')
    }

    private async sendTelegram(chatId: string, payload: NotificationPayload): Promise<void> {
        try {
            const token = process.env.TELEGRAM_BOT_TOKEN
            if (!token) {
                logger.warn('TELEGRAM_BOT_TOKEN not set')
                return
            }

            const message = `
🛡️ *Aegis Override Request*

*Vault:* ${payload.vaultName}
*Amount:* ${payload.amount} SOL
*To:* \`${payload.destination}\`
*Reason:* ${payload.reason}
*Expires:* ${payload.expiresAt}

[Approve or Reject](${payload.blinkUrl})
      `.trim()

            const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: 'Open Blink', url: payload.blinkUrl }
                        ]]
                    }
                })
            })

            if (!response.ok) {
                throw new Error(`Telegram API error: ${response.statusText}`)
            }
        } catch (error) {
            logger.error({ error, chatId }, 'Telegram notification failed')
            throw error
        }
    }

    private async sendDiscord(webhookUrl: string, payload: NotificationPayload): Promise<void> {
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    embeds: [{
                        title: '🛡️ Aegis Override Request',
                        color: 0xFF0000, // Red
                        fields: [
                            { name: 'Vault', value: payload.vaultName, inline: true },
                            { name: 'Amount', value: `${payload.amount} SOL`, inline: true },
                            { name: 'Destination', value: `\`${payload.destination}\`` },
                            { name: 'Reason', value: payload.reason },
                            { name: 'Expires', value: payload.expiresAt }
                        ],
                        url: payload.blinkUrl,
                        description: `[Click to Approve or Reject](${payload.blinkUrl})`
                    }]
                })
            })

            if (!response.ok) {
                throw new Error(`Discord API error: ${response.statusText}`)
            }
        } catch (error) {
            logger.error({ error, webhookUrl }, 'Discord notification failed')
            throw error
        }
    }

    private async sendEmail(to: string, payload: NotificationPayload): Promise<void> {
        try {
            const msg = {
                to,
                from: process.env.SENDGRID_FROM_EMAIL || 'notifications@aegis.finance',
                subject: `Action Required: Override Request for ${payload.vaultName}`,
                html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>🛡️ Aegis Override Request</h2>
            <p>A transaction was blocked and requires your approval.</p>
            
            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Vault:</strong> ${payload.vaultName}</p>
              <p><strong>Amount:</strong> ${payload.amount} SOL</p>
              <p><strong>Destination:</strong> ${payload.destination}</p>
              <p><strong>Reason:</strong> ${payload.reason}</p>
              <p><strong>Expires:</strong> ${payload.expiresAt}</p>
            </div>

            <a href="${payload.blinkUrl}" style="background: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Review Request
            </a>
          </div>
        `
            }

            await sgMail.send(msg)
        } catch (error) {
            logger.error({ error, to }, 'Email notification failed')
            throw error
        }
    }

    private async sendWebhook(url: string, payload: NotificationPayload): Promise<void> {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'OVERRIDE_REQUEST',
                    timestamp: new Date().toISOString(),
                    data: payload
                })
            })

            if (!response.ok) {
                throw new Error(`Webhook error: ${response.statusText}`)
            }
        } catch (error) {
            logger.error({ error, url }, 'Webhook notification failed')
            throw error
        }
    }
}

export const notificationService = new NotificationService()
