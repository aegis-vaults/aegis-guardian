import { createLogger } from '../logger'
import prisma from '../db'
import { BlinkMetadata } from '@/types'

const logger = createLogger({ service: 'blink-generator' })

/**
 * Blink generator service for Solana Actions
 *
 * Generates shareable override URLs for the self-hosted aegis-app.
 * This replaces the previous dial.to integration which had timeout issues.
 *
 * The URLs point to aegis-app's /override page which handles wallet
 * connection and transaction signing directly.
 */
export class BlinkGeneratorService {
  private baseUrl: string
  private appBaseUrl: string

  constructor() {
    // Guardian API base URL
    const envBaseUrl = process.env.BASE_URL || ''
    
    // Validate the BASE_URL:
    // - Must start with http:// or https://
    // - Must not contain spaces (indicates an error message)
    // - Must not contain '+' (URL-encoded spaces)
    // - Must not contain 'Domains' (common Railway error message)
    const isValidUrl = envBaseUrl && 
      envBaseUrl.startsWith('http') && 
      !envBaseUrl.includes(' ') && 
      !envBaseUrl.includes('+') && 
      !envBaseUrl.toLowerCase().includes('domains')
    
    if (isValidUrl) {
      this.baseUrl = envBaseUrl.replace(/\/$/, '') // Remove trailing slash
      logger.info({ baseUrl: this.baseUrl }, 'Using BASE_URL from environment')
    } else {
      logger.warn({ 
        envBaseUrl, 
        reason: 'Invalid or missing BASE_URL, using default' 
      }, 'BASE_URL is not properly configured')
      this.baseUrl = 'https://aegis-guardian-production.up.railway.app'
    }

    // App base URL for self-hosted override pages
    const envAppUrl = process.env.APP_BASE_URL || ''
    const isValidAppUrl = envAppUrl && envAppUrl.startsWith('http')
    
    if (isValidAppUrl) {
      this.appBaseUrl = envAppUrl.replace(/\/$/, '')
      logger.info({ appBaseUrl: this.appBaseUrl }, 'Using APP_BASE_URL from environment')
    } else {
      // Default to production aegis-app URL
      this.appBaseUrl = 'https://aegis-vaults.xyz'
      logger.info({ appBaseUrl: this.appBaseUrl }, 'Using default APP_BASE_URL')
    }

    logger.info({ baseUrl: this.baseUrl, appBaseUrl: this.appBaseUrl }, 'BlinkGeneratorService initialized')
  }

  /**
   * Get the properly formatted base URL
   */
  getBaseUrl(): string {
    return this.baseUrl
  }

  /**
   * Generate a Blink for approving an override request
   *
   * @param vaultId - Vault database ID
   * @param overrideId - Override database ID
   * @param nonce - Override nonce for on-chain matching
   * @returns Blink metadata and database record
   */
  async generateOverrideApprovalBlink(
    vaultId: string,
    overrideId: string,
    nonce: bigint
  ): Promise<{ blink: BlinkMetadata; actionUrl: string }> {
    try {
      // Fetch vault and override data
      const vault = await prisma.vault.findUnique({
        where: { id: vaultId },
      })

      const override = await prisma.override.findUnique({
        where: { id: overrideId },
      })

      if (!vault || !override) {
        throw new Error('Vault or override not found')
      }

      // Generate action URL
      const actionUrl = `${this.baseUrl}/api/actions/${vault.publicKey}/${nonce}`

      // Create Blink metadata
      const metadata: BlinkMetadata = {
        title: 'Approve Override Request',
        icon: `${this.baseUrl}/icons/aegis-shield.png`,
        description: `Guardian approval needed for override request #${nonce}. This will allow the vault owner to execute a blocked transaction after the timelock period.`,
        label: 'Approve Override',
        links: {
          actions: [
            {
              type: 'transaction',
              label: 'Approve',
              href: `${actionUrl}/approve`,
            },
            {
              type: 'transaction',
              label: 'Reject',
              href: `${actionUrl}/reject`,
            },
          ],
        },
      }

      // Store Blink in database (upsert to handle duplicates)
      await prisma.blink.upsert({
        where: { actionUrl },
        update: {
          title: metadata.title,
          description: metadata.description,
          iconUrl: metadata.icon,
          label: metadata.label,
          isActive: true,
        },
        create: {
          actionUrl,
          title: metadata.title,
          description: metadata.description,
          iconUrl: metadata.icon,
          label: metadata.label,
          vaultId,
          overrideId,
          isActive: true,
        },
      })

      logger.info({ vaultId, overrideId, actionUrl }, 'Override approval Blink generated')

      return { blink: metadata, actionUrl }
    } catch (error) {
      logger.error({ error, vaultId, overrideId }, 'Failed to generate override Blink')
      throw error
    }
  }

  /**
   * Generate override URL for a blocked transaction notification
   *
   * This generates a self-hosted override URL that points to aegis-app's /override page.
   * The user can connect their wallet directly and approve the transaction without
   * relying on external services like dial.to (which had timeout issues).
   *
   * @param vaultId - Vault database ID
   * @param transactionId - Transaction database ID
   * @returns Blink metadata and URLs (actionUrl for API compatibility, blinkUrl for user sharing)
   */
  async generateBlockedTransactionBlink(
    vaultId: string,
    transactionId: string
  ): Promise<{ blink: BlinkMetadata; actionUrl: string; blinkUrl: string }> {
    try {
      const vault = await prisma.vault.findUnique({
        where: { id: vaultId },
      })

      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
      })

      if (!vault || !transaction) {
        throw new Error('Vault or transaction not found')
      }

      // Map block reason to the expected format
      const reasonMap: Record<string, string> = {
        'DailyLimitExceeded': 'exceeded_daily_limit',
        'NotWhitelisted': 'not_whitelisted',
        'VaultPaused': 'vault_paused',
      }
      const reason = reasonMap[transaction.blockReason || ''] || 'exceeded_daily_limit'

      // Build the action URL for backwards compatibility with Solana Actions protocol
      const actionQueryParams = new URLSearchParams({
        vault: vault.publicKey,
        destination: transaction.to,
        amount: transaction.amount.toString(),
        reason,
      })
      const actionUrl = `${this.baseUrl}/api/blinks/override?${actionQueryParams.toString()}`
      
      // Generate the self-hosted override URL for aegis-app
      // This replaces dial.to and eliminates timeout issues
      const overrideQueryParams = new URLSearchParams({
        vault: vault.publicKey,
        destination: transaction.to,
        amount: transaction.amount.toString(),
        reason,
      })
      const blinkUrl = `${this.appBaseUrl}/override?${overrideQueryParams.toString()}`

      const amountSol = this.formatSol(transaction.amount)
      
      const metadata: BlinkMetadata = {
        title: 'Aegis Override Request',
        icon: `${this.appBaseUrl}/aegis-icon.png`,
        description: `A transaction was blocked and requires your approval. Amount: ${amountSol} SOL to ${this.truncateAddress(transaction.to)}. Reason: ${transaction.blockReason || 'Policy violation'}`,
        label: 'Approve Override',
        links: {
          actions: [
            {
              type: 'transaction',
              label: `Approve ${amountSol} SOL Override`,
              href: blinkUrl, // Point to self-hosted override page
            },
          ],
        },
      }

      // Use upsert to handle duplicate URLs (from retries or duplicate requests)
      await prisma.blink.upsert({
        where: { actionUrl },
        update: {
          title: metadata.title,
          description: metadata.description,
          iconUrl: metadata.icon,
          label: metadata.label,
          isActive: true,
          usedCount: { increment: 1 },
        },
        create: {
          actionUrl,
          title: metadata.title,
          description: metadata.description,
          iconUrl: metadata.icon,
          label: metadata.label,
          vaultId,
          isActive: true,
        },
      })

      logger.info({ 
        vaultId, 
        transactionId, 
        actionUrl,
        blinkUrl,
        vaultPublicKey: vault.publicKey,
        amount: transaction.amount.toString(),
        destination: transaction.to,
        reason,
        selfHosted: true,
      }, 'Self-hosted override URL generated for blocked transaction')

      return { blink: metadata, actionUrl, blinkUrl }
    } catch (error) {
      logger.error({ error, vaultId, transactionId }, 'Failed to generate blocked tx override URL')
      throw error
    }
  }

  /**
   * Generate a Blink for vault creation success
   *
   * @param vaultId - Vault database ID
   * @returns Blink metadata and action URL
   */
  async generateVaultCreatedBlink(vaultId: string): Promise<{ blink: BlinkMetadata; actionUrl: string }> {
    try {
      const vault = await prisma.vault.findUnique({
        where: { id: vaultId },
      })

      if (!vault) {
        throw new Error('Vault not found')
      }

      const actionUrl = `${this.baseUrl}/api/actions/vault/${vault.publicKey}`

      const metadata: BlinkMetadata = {
        title: 'Aegis Vault Created',
        icon: `${this.baseUrl}/icons/aegis-vault.png`,
        description: `Your Aegis vault has been successfully created! Daily limit: ${this.formatSol(vault.dailyLimit)} SOL. Guardian: ${this.truncateAddress(vault.guardian)}`,
        label: 'View Vault',
        links: {
          actions: [
            {
              type: 'transaction',
              label: 'Configure Policy',
              href: `${actionUrl}/configure`,
            },
            {
              type: 'transaction',
              label: 'View Dashboard',
              href: `${this.baseUrl}/vault/${vault.publicKey}`,
            },
          ],
        },
      }

      await prisma.blink.upsert({
        where: { actionUrl },
        update: {
          title: metadata.title,
          description: metadata.description,
          iconUrl: metadata.icon,
          label: metadata.label,
          isActive: true,
        },
        create: {
          actionUrl,
          title: metadata.title,
          description: metadata.description,
          iconUrl: metadata.icon,
          label: metadata.label,
          vaultId,
          isActive: true,
        },
      })

      logger.info({ vaultId, actionUrl }, 'Vault created Blink generated')

      return { blink: metadata, actionUrl }
    } catch (error) {
      logger.error({ error, vaultId }, 'Failed to generate vault created Blink')
      throw error
    }
  }

  /**
   * Deactivate a Blink (mark as inactive)
   *
   * @param actionUrl - The action URL to deactivate
   */
  async deactivateBlink(actionUrl: string): Promise<void> {
    try {
      await prisma.blink.update({
        where: { actionUrl },
        data: { isActive: false },
      })

      logger.info({ actionUrl }, 'Blink deactivated')
    } catch (error) {
      logger.error({ error, actionUrl }, 'Failed to deactivate Blink')
      throw error
    }
  }

  /**
   * Get Blink metadata by action URL
   *
   * @param actionUrl - The action URL
   * @returns Blink metadata or null if not found/inactive
   */
  async getBlinkMetadata(actionUrl: string): Promise<BlinkMetadata | null> {
    try {
      const blink = await prisma.blink.findUnique({
        where: { actionUrl },
      })

      if (!blink || !blink.isActive) {
        return null
      }

      // Increment usage counter
      await prisma.blink.update({
        where: { id: blink.id },
        data: { usedCount: { increment: 1 } },
      })

      return {
        title: blink.title,
        icon: blink.iconUrl || `${this.baseUrl}/icons/aegis-default.png`,
        description: blink.description,
        label: blink.label,
      }
    } catch (error) {
      logger.error({ error, actionUrl }, 'Failed to get Blink metadata')
      return null
    }
  }

  /**
   * Format lamports to SOL with 4 decimal places
   */
  private formatSol(lamports: bigint): string {
    const sol = Number(lamports) / 1e9
    return sol.toFixed(4)
  }

  /**
   * Truncate Solana address for display
   */
  private truncateAddress(address: string): string {
    if (address.length <= 12) return address
    return `${address.slice(0, 4)}...${address.slice(-4)}`
  }
}

export default BlinkGeneratorService
