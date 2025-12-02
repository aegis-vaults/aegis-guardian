import sgMail from '@sendgrid/mail'
import { randomBytes } from 'crypto'
import { createLogger } from './logger'

const logger = createLogger({ service: 'email-verification' })

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
} else {
  logger.warn('SENDGRID_API_KEY not set, email verification will fail')
}

/**
 * Generate a cryptographically secure random token
 * Returns a 32-character hex string
 */
export function generateVerificationToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Send email verification email
 */
export async function sendVerificationEmail(
  email: string,
  token: string
): Promise<void> {
  try {
    const verifyUrl = `${process.env.NEXT_PUBLIC_GUARDIAN_URL || 'http://localhost:3001'}/api/user/email/verify/${token}`

    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL || 'notifications@aegis.finance',
      subject: 'Verify your Aegis email address',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verify Your Email</title>
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px;">🛡️ Aegis</h1>
              </div>

              <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <h2 style="color: #111827; margin: 0 0 20px 0; font-size: 20px;">Verify Your Email Address</h2>

                <p style="color: #4b5563; line-height: 1.6; margin: 0 0 20px 0;">
                  Thanks for setting up notifications for your Aegis account! Click the button below to verify your email address and start receiving important alerts about your vaults.
                </p>

                <div style="text-align: center; margin: 30px 0;">
                  <a href="${verifyUrl}" style="background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
                    Verify Email Address
                  </a>
                </div>

                <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                  This link will expire in 24 hours. If you didn't request this verification, you can safely ignore this email.
                </p>

                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

                <p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">
                  If the button doesn't work, copy and paste this link into your browser:<br>
                  <a href="${verifyUrl}" style="color: #667eea; word-break: break-all;">${verifyUrl}</a>
                </p>
              </div>
            </div>
          </body>
        </html>
      `,
      text: `
Verify Your Email Address

Thanks for setting up notifications for your Aegis account! Click the link below to verify your email address:

${verifyUrl}

This link will expire in 24 hours. If you didn't request this verification, you can safely ignore this email.
      `.trim(),
    }

    await sgMail.send(msg)
    logger.info({ email }, 'Verification email sent')
  } catch (error) {
    logger.error({ error, email }, 'Failed to send verification email')
    throw new Error('Failed to send verification email')
  }
}

/**
 * Send test notification email
 */
export async function sendTestEmail(email: string): Promise<void> {
  try {
    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL || 'notifications@aegis.finance',
      subject: 'Test Notification from Aegis',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Test Notification</title>
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px;">🛡️ Aegis</h1>
              </div>

              <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <h2 style="color: #111827; margin: 0 0 20px 0; font-size: 20px;">✅ Test Notification</h2>

                <p style="color: #4b5563; line-height: 1.6; margin: 0 0 20px 0;">
                  This is a test notification from Aegis. Your email notifications are working correctly!
                </p>

                <div style="background: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
                  <p style="color: #374151; margin: 0; font-size: 14px;">
                    <strong>What you'll receive:</strong><br>
                    • Transaction blocked alerts<br>
                    • Override request notifications<br>
                    • Policy violation warnings
                  </p>
                </div>

                <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                  You can manage your notification preferences in your Aegis settings.
                </p>
              </div>
            </div>
          </body>
        </html>
      `,
      text: `
✅ Test Notification from Aegis

This is a test notification from Aegis. Your email notifications are working correctly!

What you'll receive:
- Transaction blocked alerts
- Override request notifications
- Policy violation warnings

You can manage your notification preferences in your Aegis settings.
      `.trim(),
    }

    await sgMail.send(msg)
    logger.info({ email }, 'Test email sent')
  } catch (error) {
    logger.error({ error, email }, 'Failed to send test email')
    throw new Error('Failed to send test email')
  }
}
