import { createLogger } from '../logger'
import prisma from '../db'
import { BlinkMetadata } from '@/types'

const logger = createLogger({ service: 'blink-generator' })

/**
 * Blink generator service for Solana Actions
 *
 * Generates shareable action URLs that comply with the Solana Actions spec:
 * https://solana.com/docs/advanced/actions
 *
 * Blinks allow users to interact with on-chain programs via shareable links
 * that render as interactive cards in wallets and social media
 */
export class BlinkGeneratorService {
  private baseUrl: string

  constructor() {
    // Ensure BASE_URL is properly set and doesn't contain error messages
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
    logger.info({ baseUrl: this.baseUrl }, 'BlinkGeneratorService initialized')
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

      // Store Blink in database
      await prisma.blink.create({
        data: {
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
   * Generate a Blink for a blocked transaction notification
   *
   * This generates a Solana Blink URL that the vault owner can use to approve
   * an override for the blocked transaction. The Blink renders in Solana wallets
   * and social media as an interactive card.
   *
   * @param vaultId - Vault database ID
   * @param transactionId - Transaction database ID
   * @returns Blink metadata and action URL (both raw API URL and dial.to shareable URL)
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

      // Build the action URL with proper query parameters
      // This uses the /api/blinks/override endpoint which handles Solana Actions protocol
      const queryParams = new URLSearchParams({
        vault: vault.publicKey,
        destination: transaction.to,
        amount: transaction.amount.toString(),
        reason,
      })
      
      const actionUrl = `${this.baseUrl}/api/blinks/override?${queryParams.toString()}`
      
      // Generate the dial.to shareable URL for Blinks
      // This is what gets shared and renders the interactive card
      const encodedActionUrl = encodeURIComponent(actionUrl)
      const blinkUrl = `https://dial.to/?action=solana-action:${encodedActionUrl}`

      const amountSol = this.formatSol(transaction.amount)
      
      const metadata: BlinkMetadata = {
        title: 'Aegis Override Request',
        icon: `${this.baseUrl}/aegis-icon.png`,
        description: `A transaction was blocked and requires your approval. Amount: ${amountSol} SOL to ${this.truncateAddress(transaction.to)}. Reason: ${transaction.blockReason || 'Policy violation'}`,
        label: 'Approve Override',
        links: {
          actions: [
            {
              type: 'transaction',
              label: `Approve ${amountSol} SOL Override`,
              href: actionUrl,
            },
          ],
        },
      }

      await prisma.blink.create({
        data: {
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
      }, 'Blocked transaction Blink generated')

      return { blink: metadata, actionUrl, blinkUrl }
    } catch (error) {
      logger.error({ error, vaultId, transactionId }, 'Failed to generate blocked tx Blink')
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

      await prisma.blink.create({
        data: {
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
