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
    vaultPublicKey: string
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

        // Format the block reason for display
        const blockReason = transactionDetails?.blockReason || 'Policy Violation'
        const formattedReason = blockReason
            .replace(/([A-Z])/g, ' $1') // Add space before capital letters
            .replace(/^./, (str) => str.toUpperCase()) // Capitalize first letter
            .trim()

        const payload: NotificationPayload = {
            amount: transactionDetails
                ? (Number(transactionDetails.amount) / 1e9).toFixed(4)
                : (Number(override.requestedAmount || 0) / 1e9).toFixed(4),
            destination: transactionDetails?.to || override.destination || 'Unknown',
            reason: formattedReason,
            blinkUrl: override.blinkUrl || '',
            expiresAt: Number(override.expiresAt) > 0 
                ? new Date(Number(override.expiresAt) * 1000).toLocaleString()
                : 'No expiration set',
            vaultName: vault.name || `Vault ${vault.publicKey.slice(0, 8)}...`,
            vaultPublicKey: vault.publicKey,
        }

        // Log the notification payload for debugging
        logger.info({ 
            userId: user.id, 
            vaultId: vault.id,
            payload,
            channels: {
                telegram: !!user.telegramChatId,
                discord: !!user.discordWebhook,
                email: !!user.email,
                webhook: !!user.webhookUrl,
            }
        }, 'Sending override notification')

        // Track which channels we're sending to and their results
        const channelPromises: { channel: string; promise: Promise<void> }[] = []

        if (user.telegramChatId) {
            channelPromises.push({
                channel: 'telegram',
                promise: this.sendTelegram(user.telegramChatId, payload)
            })
        }

        if (user.discordWebhook) {
            channelPromises.push({
                channel: 'discord',
                promise: this.sendDiscord(user.discordWebhook, payload)
            })
        }

        if (user.email) {
            channelPromises.push({
                channel: 'email',
                promise: this.sendEmail(user.email, payload)
            })
        }

        if (user.webhookUrl) {
            channelPromises.push({
                channel: 'webhook',
                promise: this.sendWebhook(user.webhookUrl, payload)
            })
        }

        if (channelPromises.length === 0) {
            logger.warn({
                userId: user.id,
                vaultId: vault.id,
                userHasTelegram: !!user.telegramChatId,
                userHasDiscord: !!user.discordWebhook,
                userHasEmail: !!user.email,
                userHasWebhook: !!user.webhookUrl,
            }, 'No notification channels configured for user')
            return
        }

        const results = await Promise.allSettled(channelPromises.map(cp => cp.promise))

        // Build detailed result summary
        const channelResults: Record<string, { success: boolean; error?: string }> = {}
        results.forEach((result, index) => {
            const channelInfo = channelPromises[index]
            if (!channelInfo) return
            
            const channel = channelInfo.channel
            if (result.status === 'fulfilled') {
                channelResults[channel] = { success: true }
            } else {
                const errorMessage = result.reason instanceof Error 
                    ? result.reason.message 
                    : String(result.reason)
                channelResults[channel] = { success: false, error: errorMessage }
                logger.error({ 
                    channel, 
                    errorMessage,
                    userId: user.id,
                    vaultId: vault.id,
                }, `${channel} notification failed`)
            }
        })

        const successCount = results.filter(r => r.status === 'fulfilled').length
        const failCount = results.filter(r => r.status === 'rejected').length

        logger.info({
            userId: user.id,
            vaultId: vault.id,
            successCount,
            failCount,
            channelResults,
        }, `Notifications processed: ${successCount} succeeded, ${failCount} failed`)
    }

    private async sendTelegram(chatId: string, payload: NotificationPayload): Promise<void> {
        const token = process.env.TELEGRAM_BOT_TOKEN
        if (!token) {
            const error = new Error('TELEGRAM_BOT_TOKEN not set - cannot send Telegram notification')
            logger.error({ chatId }, error.message)
            throw error
        }

        try {
            // Truncate destination for display
            const shortDest = `${payload.destination.slice(0, 6)}...${payload.destination.slice(-4)}`

            // Escape special markdown characters in dynamic content
            const escapedVaultName = payload.vaultName.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')
            const escapedReason = payload.reason.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')
            const escapedExpires = payload.expiresAt.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')

            const message = `
🛡️ *Aegis Override Request*

━━━━━━━━━━━━━━━━━━━━
📦 *Vault:* ${escapedVaultName}
💰 *Amount:* ${payload.amount} SOL
📍 *To:* \`${shortDest}\`
⚠️ *Reason:* ${escapedReason}
⏰ *Expires:* ${escapedExpires}
━━━━━━━━━━━━━━━━━━━━

Click below to approve this transaction in your Solana wallet.
      `.trim()

            logger.info({ 
                chatId, 
                vaultName: payload.vaultName, 
                blinkUrl: payload.blinkUrl,
                tokenPresent: true,
            }, 'Sending Telegram notification')

            const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ Approve Override', url: payload.blinkUrl }
                        ]]
                    }
                })
            })

            const responseBody = await response.text()
            
            if (!response.ok) {
                logger.error({ 
                    chatId, 
                    status: response.status,
                    statusText: response.statusText,
                    body: responseBody,
                }, 'Telegram API returned error')
                throw new Error(`Telegram API error: ${response.status} ${response.statusText} - ${responseBody}`)
            }
            
            logger.info({ chatId, response: responseBody }, 'Telegram notification sent successfully')
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error({ errorMessage, chatId, blinkUrl: payload.blinkUrl }, 'Telegram notification failed')
            throw error
        }
    }

    private async sendDiscord(webhookUrl: string, payload: NotificationPayload): Promise<void> {
        if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
            const error = new Error(`Invalid Discord webhook URL: ${webhookUrl?.slice(0, 50)}...`)
            logger.error({ webhookUrl: webhookUrl?.slice(0, 50) }, error.message)
            throw error
        }

        try {
            logger.info({ 
                webhookUrl: webhookUrl.slice(0, 60) + '...',
                vaultName: payload.vaultName,
                blinkUrl: payload.blinkUrl,
            }, 'Sending Discord notification')

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
                            { name: 'Destination', value: `\`${payload.destination.slice(0, 8)}...${payload.destination.slice(-8)}\`` },
                            { name: 'Reason', value: payload.reason },
                            { name: 'Expires', value: payload.expiresAt }
                        ],
                        url: payload.blinkUrl,
                        description: `[Click to Approve or Reject](${payload.blinkUrl})`
                    }]
                })
            })

            if (!response.ok) {
                const responseBody = await response.text()
                logger.error({ 
                    status: response.status,
                    statusText: response.statusText,
                    body: responseBody,
                }, 'Discord API returned error')
                throw new Error(`Discord API error: ${response.status} ${response.statusText} - ${responseBody}`)
            }

            logger.info({ webhookUrl: webhookUrl.slice(0, 60) + '...' }, 'Discord notification sent successfully')
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error({ errorMessage, webhookUrl: webhookUrl?.slice(0, 50) }, 'Discord notification failed')
            throw error
        }
    }

    private async sendEmail(to: string, payload: NotificationPayload): Promise<void> {
        if (!process.env.SENDGRID_API_KEY) {
            const error = new Error('SENDGRID_API_KEY not set - cannot send email notification')
            logger.error({ to }, error.message)
            throw error
        }

        try {
            // Log the email being sent for debugging
            logger.info({ to, vaultName: payload.vaultName, blinkUrl: payload.blinkUrl }, 'Sending email notification')
            
            const msg = {
                to,
                from: process.env.SENDGRID_FROM_EMAIL || 'notifications@aegis.finance',
                subject: `🛡️ Action Required: Override Request for ${payload.vaultName}`,
                html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="margin: 0; font-size: 24px; color: #111827;">🛡️ Aegis Override Request</h1>
      <p style="margin: 8px 0 0 0; color: #6b7280;">A transaction was blocked and requires your approval</p>
    </div>
    
    <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Vault</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #111827;">${payload.vaultName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Amount</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #111827;">${payload.amount} SOL</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Destination</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace; font-size: 12px; color: #111827;">${payload.destination.slice(0, 8)}...${payload.destination.slice(-8)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Reason</td>
          <td style="padding: 8px 0; text-align: right; color: #dc2626;">${payload.reason}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Expires</td>
          <td style="padding: 8px 0; text-align: right; color: #6b7280;">${payload.expiresAt}</td>
        </tr>
      </table>
    </div>

    <div style="text-align: center; margin-top: 24px;">
      <a href="${payload.blinkUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Approve Override →
      </a>
      <p style="margin: 16px 0 0 0; font-size: 12px; color: #9ca3af;">
        Click the button above to open the Solana Blink and approve this transaction
      </p>
    </div>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    
    <div style="font-size: 12px; color: #9ca3af; text-align: center;">
      <p style="margin: 0;">This is an automated notification from Aegis Vaults.</p>
      <p style="margin: 4px 0 0 0;">Vault: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${payload.vaultPublicKey}</code></p>
    </div>
  </div>
</body>
</html>
        `
            }

            await sgMail.send(msg)
            logger.info({ to }, 'Email notification sent successfully')
        } catch (error) {
            logger.error({ error, to, blinkUrl: payload.blinkUrl }, 'Email notification failed')
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
