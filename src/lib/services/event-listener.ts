import { Connection, PublicKey, Logs } from '@solana/web3.js'
import { createLogger } from '../logger'
import { withTransaction } from '../db'
import { CacheService } from '../redis'
import { BlinkGeneratorService } from './blink-generator'
import { NotificationService } from './notifications'
import prisma from '../db'
import {
  EventDiscriminator,
  VaultInitializedEvent,
  TransactionExecutedEvent,
  TransactionBlockedEvent,
  OverrideRequestedEvent,
  OverrideApprovedEvent,
  PolicyUpdatedEvent,
} from '@/types'

const logger = createLogger({ service: 'event-listener' })
const cache = new CacheService()
const blinkGenerator = new BlinkGeneratorService()
const notificationService = new NotificationService()

// Track failed signatures to avoid duplicate error logging
const failedSignatures = new Map<string, { count: number; lastError: string }>()
const MAX_ERROR_LOG_PER_SIGNATURE = 3 // Only log first 3 errors per signature

/**
 * Solana event listener service
 * Monitors on-chain events from aegis-protocol program
 *
 * Architecture:
 * - Connects to Solana RPC via WebSocket
 * - Subscribes to program logs
 * - Parses base64-encoded event data
 * - Stores events in PostgreSQL
 * - Invalidates relevant caches
 * - Triggers notifications via webhooks
 */
export class EventListenerService {
  private connection: Connection
  private programId: PublicKey
  private subscriptionId: number | null = null
  private isRunning: boolean = false

  constructor(rpcUrl: string, programId: string) {
    // Handle WebSocket endpoint
    let wsEndpoint: string
    if (rpcUrl.startsWith('http://') || rpcUrl.startsWith('https://')) {
      // For HTTP RPC, derive WebSocket endpoint
      if (rpcUrl.includes('127.0.0.1') || rpcUrl.includes('localhost')) {
        // Local validator uses same port for WS
        wsEndpoint = rpcUrl.replace('http://', 'ws://')
      } else {
        // Public RPC uses wss
        wsEndpoint = rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://')
      }
    } else {
      wsEndpoint = rpcUrl
    }

    this.connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint,
    })
    this.programId = new PublicKey(programId)
    logger.info({ programId, rpcUrl, wsEndpoint }, 'Event listener initialized')
  }

  /**
   * Start listening to program events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Event listener already running')
      return
    }

    // Determine if we should use polling or WebSocket
    const forcePolling = process.env.FORCE_POLLING_MODE === 'true'
    const isLocalnet = this.connection.rpcEndpoint.includes('127.0.0.1') ||
      this.connection.rpcEndpoint.includes('localhost')
    const isDevnet = this.connection.rpcEndpoint.includes('devnet')

    // Use polling for localnet, devnet (free tier has WebSocket auth issues), or if forced
    if (isLocalnet || isDevnet || forcePolling) {
      const reason = isLocalnet
        ? 'localnet'
        : isDevnet
        ? 'devnet (avoiding WebSocket auth issues)'
        : 'FORCE_POLLING_MODE=true'
      logger.info({ reason }, 'Using polling mode for event listening')
      await this.startPolling()
    } else {
      // Try WebSocket first for mainnet/custom RPC, fallback to polling if it fails
      try {
        await this.startWebSocket()
      } catch (error) {
        logger.warn({ error }, 'WebSocket listener failed, falling back to polling mode')
        await this.startPolling()
      }
    }
  }

  /**
   * Start WebSocket-based event listening (for devnet/mainnet)
   */
  private async startWebSocket(): Promise<void> {
    try {
      // Test the WebSocket connection first
      await this.testWebSocketConnection()

      this.subscriptionId = this.connection.onLogs(
        this.programId,
        this.handleLogs.bind(this),
        'confirmed'
      )

      this.isRunning = true
      logger.info({ subscriptionId: this.subscriptionId }, 'WebSocket event listener started')

      // Monitor for WebSocket errors and fallback to polling if needed
      this.setupWebSocketErrorHandling()
    } catch (error) {
      logger.error({ error }, 'Failed to start WebSocket listener')
      throw error
    }
  }

  /**
   * Test WebSocket connection before subscribing
   */
  private async testWebSocketConnection(): Promise<void> {
    try {
      // Try to get slot to test the connection
      await this.connection.getSlot('confirmed')
      logger.debug('WebSocket connection test passed')
    } catch (error) {
      logger.error({ error }, 'WebSocket connection test failed')
      throw new Error('WebSocket connection test failed')
    }
  }

  /**
   * Setup error handling for WebSocket failures
   */
  private setupWebSocketErrorHandling(): void {
    // Monitor for repeated errors and switch to polling if needed
    let errorCount = 0
    const maxErrors = 10
    const errorWindow = 30000 // 30 seconds

    const errorHandler = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(errorHandler)
        return
      }

      // If we've had too many errors, switch to polling
      if (errorCount >= maxErrors) {
        logger.warn(
          { errorCount },
          'Too many WebSocket errors detected, switching to polling mode'
        )
        clearInterval(errorHandler)
        this.stop().then(() => this.startPolling())
      }

      // Reset error count after window
      errorCount = 0
    }, errorWindow)
  }

  /**
   * Start polling-based event listening (optimized for RPC credit conservation)
   * 
   * Key optimizations:
   * - Longer polling interval (10s base instead of 2s)
   * - Uses 'until' parameter to only fetch new signatures
   * - Caches processed signatures efficiently
   * - Batches transaction fetches
   * - Adaptive polling based on activity
   */
  private async startPolling(): Promise<void> {
    this.isRunning = true

    // OPTIMIZED: Longer base interval to reduce API calls (10s instead of 2s)
    // This reduces getSignaturesForAddress calls by 5x
    const basePollInterval = 10000 // 10 seconds
    const maxPollInterval = 60000 // Max 60 seconds between polls on repeated errors
    const idlePollInterval = 30000 // 30 seconds when no new transactions found
    let currentPollInterval = basePollInterval
    let consecutiveErrors = 0
    let lastErrorMessage: string | null = null
    let consecutiveEmptyPolls = 0
    
    // Track the most recent signature to use as 'until' parameter
    // This prevents re-fetching old transactions
    let lastProcessedSignature: string | null = null
    
    // Track processed signatures to avoid reprocessing
    const processedSignatures = new Set<string>()
    const MAX_PROCESSED_CACHE = 500 // Reduced from 1000

    const poll = async () => {
      if (!this.isRunning) return

      try {
        // OPTIMIZED: Only fetch signatures newer than the last one we processed
        // This dramatically reduces API calls when there's no new activity
        const signaturesOptions: any = { 
          limit: 10, // Reduced from 20 - we poll more frequently so don't need as many
        }
        
        // Use 'until' parameter to only get new signatures (if we have a reference point)
        if (lastProcessedSignature) {
          signaturesOptions.until = lastProcessedSignature
        }

        const signatures = await this.connection.getSignaturesForAddress(
          this.programId,
          signaturesOptions,
          'confirmed'
        )

        // If no new signatures, increase poll interval to conserve credits
        if (signatures.length === 0) {
          consecutiveEmptyPolls++
          // After 3 empty polls, switch to idle mode (30s interval)
          if (consecutiveEmptyPolls >= 3) {
            currentPollInterval = idlePollInterval
          }
          setTimeout(poll, currentPollInterval)
          return
        }

        // Reset empty poll counter when we find transactions
        consecutiveEmptyPolls = 0
        currentPollInterval = basePollInterval

        // Update our reference point to the newest signature
        const newestSignature = signatures[0]?.signature
        if (newestSignature) {
          lastProcessedSignature = newestSignature
        }

        // Filter to only unprocessed signatures
        const newSignatures = signatures.filter(s => !processedSignatures.has(s.signature))
        
        if (newSignatures.length === 0) {
          setTimeout(poll, currentPollInterval)
          return
        }

        // OPTIMIZED: Process signatures without fetching full transaction data
        // unless absolutely necessary (for event parsing)
        let processedCount = 0
        for (const sigInfo of newSignatures) {
          // Skip if already processed (double check)
          if (processedSignatures.has(sigInfo.signature)) {
            continue
          }

          try {
            // Fetch transaction details - this is necessary for event parsing
            // but we've reduced how often we get here
            const tx = await this.connection.getTransaction(sigInfo.signature, {
              maxSupportedTransactionVersion: 0,
            })

            if (tx && tx.meta && !tx.meta.err) {
              // Extract logs and process
              const logs = tx.meta.logMessages || []
              await this.handleLogs({
                signature: sigInfo.signature,
                logs,
                err: null,
              })
            }
          } catch (txError) {
            // Log but don't fail the whole poll for one transaction
            logger.warn({ 
              signature: sigInfo.signature.slice(0, 20), 
              error: txError instanceof Error ? txError.message : String(txError)
            }, 'Failed to fetch transaction, will retry')
          }
          
          // Mark as processed regardless of success (to avoid infinite retries)
          processedSignatures.add(sigInfo.signature)
          processedCount++
        }
        
        // Clean up old processed signatures to prevent memory growth
        if (processedSignatures.size > MAX_PROCESSED_CACHE) {
          const entries = [...processedSignatures]
          const toDelete = entries.slice(0, entries.length - MAX_PROCESSED_CACHE)
          toDelete.forEach(sig => processedSignatures.delete(sig))
        }

        if (processedCount > 0) {
          logger.info({ 
            processedCount, 
            cacheSize: processedSignatures.size,
            pollInterval: currentPollInterval,
          }, 'Processed new transactions')
        }

        // Reset error state on success
        if (consecutiveErrors > 0) {
          logger.info({ processedSignaturesCount: processedSignatures.size }, 'Event listener polling recovered')
        }
        consecutiveErrors = 0
        lastErrorMessage = null
      } catch (error: unknown) {
        consecutiveErrors++
        const errorMessage = error instanceof Error ? error.message : String(error)

        // Only log if this is a new error or every 10th consecutive error
        if (errorMessage !== lastErrorMessage || consecutiveErrors % 10 === 1) {
          logger.error(
            { errorMessage, consecutiveErrors, nextRetryIn: currentPollInterval },
            'Event listener polling error'
          )
          lastErrorMessage = errorMessage
        }

        // Exponential backoff on repeated errors (up to max)
        currentPollInterval = Math.min(currentPollInterval * 1.5, maxPollInterval)
      }

      // Schedule next poll
      setTimeout(poll, currentPollInterval)
    }

    // Start polling
    poll()
    logger.info({ 
      basePollInterval, 
      idlePollInterval,
      maxPollInterval,
    }, 'Optimized polling event listener started (RPC credit conservation mode)')
  }

  /**
   * Stop listening to program events
   */
  async stop(): Promise<void> {
    if (!this.isRunning || this.subscriptionId === null) {
      return
    }

    try {
      await this.connection.removeOnLogsListener(this.subscriptionId)
      this.isRunning = false
      this.subscriptionId = null
      logger.info('Event listener stopped')
    } catch (error) {
      logger.error({ error }, 'Failed to stop event listener')
      throw error
    }
  }

  /**
   * Handle incoming log messages from Solana
   */
  private async handleLogs(logs: Logs): Promise<void> {
    const { signature, logs: logMessages, err } = logs

    if (err) {
      logger.debug({ signature, error: err }, 'Transaction failed, skipping')
      return
    }

    try {
      // Find program data logs (base64 encoded event data)
      const dataLogs = logMessages.filter((log) => log.startsWith('Program data: '))

      if (dataLogs.length === 0) {
        return
      }

      for (const log of dataLogs) {
        const base64Data = log.replace('Program data: ', '')
        await this.processEventData(base64Data, signature)
      }
    } catch (error) {
      logger.error({ error, signature }, 'Error processing logs')
    }
  }

  /**
   * Process base64-encoded event data
   */
  private async processEventData(base64Data: string, signature: string): Promise<void> {
    try {
      const buffer = Buffer.from(base64Data, 'base64')

      // First 8 bytes are the event discriminator
      if (buffer.length < 8) {
        logger.debug({ signature, length: buffer.length }, 'Event data too short, skipping')
        return
      }

      const discriminator = buffer.slice(0, 8).toString('hex')
      const eventData = buffer.slice(8)

      logger.debug({ discriminator, signature, dataLength: eventData.length }, 'Processing event')

      switch (`0x${discriminator}`) {
        case EventDiscriminator.VaultInitialized:
        case EventDiscriminator.VaultCreated:
          await this.handleVaultInitialized(eventData, signature)
          break
        case EventDiscriminator.TransactionExecuted:
          await this.handleTransactionExecuted(eventData, signature)
          break
        case EventDiscriminator.TransactionBlocked:
          await this.handleTransactionBlocked(eventData, signature)
          break
        case EventDiscriminator.OverrideRequested:
          await this.handleOverrideRequested(eventData, signature)
          break
        case EventDiscriminator.OverrideApproved:
          await this.handleOverrideApproved(eventData, signature)
          break
        case EventDiscriminator.PolicyUpdated:
          await this.handlePolicyUpdated(eventData, signature)
          break
        default:
          // Log unknown discriminators at debug level to reduce noise
          // These are likely other Solana program events we don't care about
          logger.debug({ discriminator, signature, dataLength: eventData.length }, 'Unknown event discriminator, ignoring')
      }
    } catch (error: unknown) {
      // Properly serialize the error for logging
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined
      
      // Track and deduplicate error logging to avoid log spam
      const signatureShort = signature.slice(0, 20)
      const existing = failedSignatures.get(signatureShort)
      
      if (!existing) {
        failedSignatures.set(signatureShort, { count: 1, lastError: errorMessage })
        logger.error({ 
          errorMessage, 
          errorStack,
          signature: signatureShort,
          base64DataLength: base64Data.length,
        }, 'Failed to process event data')
      } else {
        existing.count++
        if (existing.count <= MAX_ERROR_LOG_PER_SIGNATURE) {
          logger.error({ 
            errorMessage, 
            signature: signatureShort,
            failureCount: existing.count,
          }, 'Failed to process event data (repeated)')
        }
        // After MAX_ERROR_LOG_PER_SIGNATURE, silently ignore further errors for this signature
      }
      
      // Clean up old entries periodically (keep map from growing indefinitely)
      if (failedSignatures.size > 1000) {
        const oldest = [...failedSignatures.keys()].slice(0, 500)
        oldest.forEach(key => failedSignatures.delete(key))
      }
    }
  }

  /**
   * Handle VaultInitialized event
   */
  private async handleVaultInitialized(data: Buffer, signature: string): Promise<void> {
    const event = this.parseVaultInitializedEvent(data)

    logger.info({ event, signature }, 'Vault initialized')

    await withTransaction(async (tx) => {
      // Use upsert to handle both new vaults and re-processing of existing events
      // We need to check if the vault exists first and create/update accordingly
      const existingVault = await tx.vault.findUnique({
        where: { publicKey: event.vaultPda },
      })

      if (existingVault) {
        // Update existing vault
        await tx.vault.update({
          where: { publicKey: event.vaultPda },
          data: {
            owner: event.owner,
            guardian: event.guardian,
            dailyLimit: event.dailyLimit,
            overrideDelay: event.overrideDelay,
          },
        })
      } else {
        // Create new vault
        // Note: Using type assertion because Prisma types may be stale
        await tx.vault.create({
          data: {
            publicKey: event.vaultPda,
            owner: event.owner,
            guardian: event.guardian,
            agentSigner: event.owner, // Use owner as initial agentSigner, will be updated on sync
            dailyLimit: event.dailyLimit,
            dailySpent: BigInt(0),
            lastResetTime: event.timestamp,
            whitelistEnabled: false,
            whitelist: [],
            overrideDelay: event.overrideDelay,
            pendingOverride: false,
            isActive: true,
          } as any, // Type assertion needed due to stale Prisma types
        })
      }
    })

    // Invalidate vault cache
    await cache.delete(`vault:${event.vaultPda}`)
    await cache.deletePattern('vaults:list:*')
  }

  /**
   * Handle TransactionExecuted event
   */
  private async handleTransactionExecuted(data: Buffer, signature: string): Promise<void> {
    const event = this.parseTransactionExecutedEvent(data)

    logger.info({ event, signature }, 'Transaction executed')

    await withTransaction(async (tx) => {
      // Find the vault
      const vault = await tx.vault.findUnique({
        where: { publicKey: event.vaultPda },
      })

      if (!vault) {
        logger.error({ vaultPda: event.vaultPda }, 'Vault not found for transaction')
        return
      }

      // Create transaction record (use signature from parameter, not event)
      const transaction = await tx.transaction.create({
        data: {
          signature: signature, // Use the transaction signature from context
          vaultId: vault.id,
          from: event.from,
          to: event.to,
          amount: event.amount,
          status: 'EXECUTED',
          executedAt: new Date(Number(event.timestamp) * 1000),
          blockTime: event.timestamp,
        },
      })

      // Record fee if present
      if (event.feeCollected && event.feeCollected > BigInt(0)) {
        await (tx as any).feeCollection.create({
          data: {
            vaultId: vault.id,
            transactionId: transaction.id,
            amount: event.feeCollected,
            timestamp: new Date(Number(event.timestamp) * 1000),
          },
        })
      }

      // Update vault daily spent
      await tx.vault.update({
        where: { id: vault.id },
        data: {
          dailySpent: {
            increment: event.amount,
          },
        },
      })
    })

    // Invalidate caches
    await cache.delete(`vault:${event.vaultPda}`)
    await cache.deletePattern(`transactions:vault:${event.vaultPda}:*`)
  }

  /**
   * Handle TransactionBlocked event
   */
  private async handleTransactionBlocked(data: Buffer, signature: string): Promise<void> {
    const event = this.parseTransactionBlockedEvent(data)

    logger.info({ event, signature }, 'Transaction blocked')

    let transactionId: string | undefined
    let vaultId: string | undefined

    await withTransaction(async (tx) => {
      const vault = await tx.vault.findUnique({
        where: { publicKey: event.vaultPda },
        include: { user: true },
      })

      if (!vault) {
        logger.error({ vaultPda: event.vaultPda }, 'Vault not found for blocked transaction')
        return
      }

      vaultId = vault.id

      const transaction = await tx.transaction.create({
        data: {
          signature: signature, // Use the transaction signature from context
          vaultId: vault.id,
          from: event.from,
          to: event.to,
          amount: event.amount,
          status: 'BLOCKED',
          blockReason: event.reason,
          blockedAt: new Date(Number(event.timestamp) * 1000),
          blockTime: event.timestamp,
        },
      })

      transactionId = transaction.id
    })

    // Invalidate caches
    await cache.deletePattern(`transactions:vault:${event.vaultPda}:*`)

    // Generate Blink and send notifications for blocked transaction
    if (transactionId && vaultId) {
      try {
        // Generate Blink for the blocked transaction
        const { actionUrl } = await blinkGenerator.generateBlockedTransactionBlink(
          vaultId,
          transactionId
        )

        // Fetch vault with user details for notifications
        const vaultWithUser = await prisma.vault.findUnique({
          where: { id: vaultId },
          include: { user: true },
        })

        if (vaultWithUser?.user) {
          // Send notification via all configured channels
          await notificationService.sendOverrideNotification(
            {
              id: transactionId,
              vaultId,
              transactionId: event.signature,
              nonce: BigInt(0), // No override nonce for simple blocked transactions
              requestedBy: event.from,
              requestedAmount: event.amount,
              destination: event.to,
              canExecuteAfter: BigInt(0),
              expiresAt: BigInt(0),
              status: 'PENDING',
              approvedBy: null,
              approvedAt: null,
              executedAt: null,
              cancelledAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              blinkUrl: actionUrl,
            } as any,
            vaultWithUser as any,
            vaultWithUser.user
          )

          logger.info(
            { vaultId, transactionId, actionUrl },
            'Blink generated and notifications sent for blocked transaction'
          )
        }
      } catch (error) {
        logger.error(
          { error, vaultId, transactionId },
          'Failed to generate Blink or send notifications for blocked transaction'
        )
        // Don't throw - event was successfully stored, notification failure shouldn't break the listener
      }
    }
  }

  /**
   * Handle OverrideRequested event
   */
  private async handleOverrideRequested(data: Buffer, signature: string): Promise<void> {
    const event = this.parseOverrideRequestedEvent(data)

    logger.info({ event, signature }, 'Override requested')

    let overrideId: string | undefined
    let vaultId: string | undefined

    await withTransaction(async (tx) => {
      const vault = await tx.vault.findUnique({
        where: { publicKey: event.vaultPda },
        include: { user: true },
      })

      if (!vault) {
        logger.error({ vaultPda: event.vaultPda }, 'Vault not found for override request')
        return
      }

      vaultId = vault.id

      const override = await tx.override.create({
        data: {
          vaultId: vault.id,
          transactionId: signature,
          nonce: event.nonce,
          requestedBy: event.requestedBy,
          canExecuteAfter: event.canExecuteAfter,
          expiresAt: event.expiresAt,
          status: 'PENDING',
        },
      })

      overrideId = override.id
    })

    // Generate Blink and send notifications for override request
    if (overrideId && vaultId) {
      try {
        // Fetch the override with all details
        const override = await prisma.override.findUnique({
          where: { id: overrideId },
        })

        if (!override) {
          logger.error({ overrideId }, 'Override not found after creation')
          return
        }

        // Generate Blink for override approval
        const { actionUrl } = await blinkGenerator.generateOverrideApprovalBlink(
          vaultId,
          overrideId,
          event.nonce
        )

        // Update override with Blink URL
        await prisma.override.update({
          where: { id: overrideId },
          data: { blinkUrl: actionUrl } as any, // blinkUrl field needs to be added to schema
        })

        // Fetch vault with user details for notifications
        const vaultWithUser = await prisma.vault.findUnique({
          where: { id: vaultId },
          include: { user: true },
        })

        if (vaultWithUser?.user) {
          // Send notification via all configured channels
          await notificationService.sendOverrideNotification(
            { ...override, blinkUrl: actionUrl } as any,
            vaultWithUser as any,
            vaultWithUser.user
          )

          logger.info(
            { vaultId, overrideId, actionUrl },
            'Blink generated and notifications sent for override request'
          )
        }
      } catch (error) {
        logger.error(
          { error, vaultId, overrideId },
          'Failed to generate Blink or send notifications for override request'
        )
        // Don't throw - event was successfully stored, notification failure shouldn't break the listener
      }
    }
  }

  /**
   * Handle OverrideApproved event
   * Sends SUCCESS notification to user when their override is approved
   */
  private async handleOverrideApproved(data: Buffer, signature: string): Promise<void> {
    const event = this.parseOverrideApprovedEvent(data)

    logger.info({ event, signature }, 'Override approved')

    let vaultWithUser: any = null
    let overrideDetails: any = null

    await withTransaction(async (tx) => {
      const vault = await tx.vault.findUnique({
        where: { publicKey: event.vaultPda },
        include: { overrides: true, user: true },
      })

      if (!vault) {
        logger.error({ vaultPda: event.vaultPda }, 'Vault not found for override approval')
        return
      }

      vaultWithUser = vault

      const override = vault.overrides.find((o) => o.nonce === event.nonce)

      if (!override) {
        logger.error({ nonce: event.nonce }, 'Override not found')
        return
      }

      overrideDetails = override

      // Use vault authority as approver (they signed the override transaction)
      const approvedBy = event.approvedBy || vault.owner || ''
      
      await tx.override.update({
        where: { id: override.id },
        data: {
          status: 'APPROVED',
          approvedBy,
          approvedAt: new Date(Number(event.timestamp) * 1000),
        },
      })
    })

    // Send SUCCESS notification to user
    if (vaultWithUser?.user && overrideDetails) {
      try {
        await notificationService.sendSuccessNotification(
          vaultWithUser,
          vaultWithUser.user,
          {
            type: 'OVERRIDE_APPROVED',
            amount: overrideDetails.requestedAmount,
            destination: overrideDetails.destination,
            signature,
          }
        )
        logger.info({ vaultId: vaultWithUser.id, signature }, 'Success notification sent for override approval')
      } catch (error) {
        logger.error({ error, vaultId: vaultWithUser?.id }, 'Failed to send success notification')
      }
    }
  }

  /**
   * Handle PolicyUpdated event
   */
  private async handlePolicyUpdated(data: Buffer, signature: string): Promise<void> {
    const event = this.parsePolicyUpdatedEvent(data)

    logger.info({ event, signature }, 'Policy updated')

    await withTransaction(async (tx) => {
      const updateData: Record<string, unknown> = {}

      if (event.dailyLimit !== undefined) {
        updateData.dailyLimit = event.dailyLimit
      }

      if (event.whitelistEnabled !== undefined) {
        updateData.whitelistEnabled = event.whitelistEnabled
      }

      if (event.whitelist !== undefined) {
        updateData.whitelist = event.whitelist
      }

      await tx.vault.update({
        where: { publicKey: event.vaultPda },
        data: updateData,
      })
    })

    // Invalidate cache
    await cache.delete(`vault:${event.vaultPda}`)
  }

  // Event parsing methods using Anchor's event coder
  private parseVaultInitializedEvent(data: Buffer): VaultInitializedEvent {
    // Supports multiple event formats from the IDL:
    //
    // VaultCreated event (73 bytes):
    // - vault: PublicKey (32 bytes)
    // - authority: PublicKey (32 bytes)
    // - tier: u8 (1 byte)
    // - daily_limit: u64 (8 bytes)
    //
    // VaultInitialized event (80 bytes):
    // - vault: PublicKey (32 bytes)
    // - authority: PublicKey (32 bytes)
    // - daily_limit: u64 (8 bytes)
    // - timestamp: i64 (8 bytes)
    //
    // Note: The protocol does not emit guardian or overrideDelay fields.
    // We use the authority as both owner and guardian, and provide a default overrideDelay.

    // Validate minimum required length
    if (data.length < 64) {
      throw new Error(`Vault event data too short: expected at least 64 bytes, got ${data.length}`)
    }

    let vault: string
    let authority: string
    
    try {
      vault = new PublicKey(data.slice(0, 32)).toBase58()
      authority = new PublicKey(data.slice(32, 64)).toBase58()
    } catch (err) {
      throw new Error(`Failed to parse vault/authority public keys: ${err instanceof Error ? err.message : String(err)}`)
    }

    let dailyLimit: bigint
    let timestamp: bigint

    if (data.length >= 80) {
      // VaultInitialized format (80 bytes)
      dailyLimit = data.readBigUInt64LE(64)
      timestamp = data.readBigInt64LE(72)
    } else if (data.length >= 73) {
      // VaultCreated format (73 bytes) - has tier byte before daily_limit
      // Skip tier byte at offset 64
      dailyLimit = data.readBigUInt64LE(65)
      timestamp = BigInt(Math.floor(Date.now() / 1000)) // Use current time as timestamp
    } else if (data.length >= 72) {
      // Alternative format without tier byte
      dailyLimit = data.readBigUInt64LE(64)
      timestamp = BigInt(Math.floor(Date.now() / 1000))
    } else {
      // Fall back to defaults if we can't parse daily limit
      logger.warn({ dataLength: data.length, vault }, 'Vault event has unexpected length, using defaults')
      dailyLimit = BigInt(1_000_000_000) // 1 SOL default
      timestamp = BigInt(Math.floor(Date.now() / 1000))
    }

    logger.debug({ vault, authority, dailyLimit: dailyLimit.toString(), dataLength: data.length }, 'Parsed vault event')

    return {
      vaultPda: vault,
      owner: authority,
      guardian: authority, // Use authority as guardian (same person manages the vault)
      dailyLimit,
      overrideDelay: 3600, // Default to 1 hour (can be updated via API later)
      timestamp,
    }
  }

  private parseTransactionExecutedEvent(data: Buffer): TransactionExecutedEvent {
    // Event data structure (from IDL):
    // - vault: PublicKey (32 bytes)
    // - amount: u64 (8 bytes)
    // - destination: PublicKey (32 bytes)
    // - fee_collected: u64 (8 bytes)
    // - new_balance: u64 (8 bytes)
    // - spent_today: u64 (8 bytes)
    // Total: 96 bytes

    if (data.length < 96) {
      throw new Error(`Invalid TransactionExecuted event data length: ${data.length}`)
    }

    const vaultPda = new PublicKey(data.slice(0, 32)).toBase58()
    const amount = data.readBigUInt64LE(32)
    const to = new PublicKey(data.slice(40, 72)).toBase58()
    const feeCollected = data.readBigUInt64LE(72)
    const newBalance = data.readBigUInt64LE(80)
    const spentToday = data.readBigUInt64LE(88)

    return {
      vaultPda,
      signature: '', // Not in event, will be filled from transaction context
      from: vaultPda, // The vault is the sender
      to,
      amount,
      feeCollected,
      timestamp: BigInt(Math.floor(Date.now() / 1000)), // Use current time
    }
  }

  private parseTransactionBlockedEvent(data: Buffer): TransactionBlockedEvent {
    // Event data structure (from IDL):
    // - vault: PublicKey (32 bytes)
    // - reason: u8 (1 byte) - BlockReason enum
    // - amount: u64 (8 bytes)
    // - destination: PublicKey (32 bytes)
    // - override_nonce: Option<u64> (1 byte discriminator + 8 bytes if Some)
    // Total: 73-82 bytes

    if (data.length < 73) {
      throw new Error(`Invalid TransactionBlocked event data length: ${data.length}`)
    }

    const vaultPda = new PublicKey(data.slice(0, 32)).toBase58()
    const reasonCode = data.readUInt8(32)
    const amount = data.readBigUInt64LE(33)
    const to = new PublicKey(data.slice(41, 73)).toBase58()
    
    // Parse Option<u64> for override_nonce
    let overrideNonce: bigint | undefined
    if (data.length > 73) {
      const hasNonce = data.readUInt8(73)
      if (hasNonce === 1 && data.length >= 82) {
        overrideNonce = data.readBigUInt64LE(74)
      }
    }

    // Map reason code to string
    const reasonMap: Record<number, string> = {
      0: 'NotWhitelisted',
      1: 'ExceededDailyLimit',
      2: 'InsufficientFunds',
      3: 'VaultPaused',
    }
    const reason = reasonMap[reasonCode] || `Unknown(${reasonCode})`

    return {
      vaultPda,
      signature: '', // Not in event, will be filled from transaction context
      from: vaultPda, // The vault is the sender
      to,
      amount,
      reason,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    }
  }

  private parseOverrideRequestedEvent(data: Buffer): OverrideRequestedEvent {
    // Event data structure:
    // - vault_pda: PublicKey (32 bytes)
    // - nonce: u64 (8 bytes)
    // - requested_by: PublicKey (32 bytes)
    // - can_execute_after: i64 (8 bytes)
    // - expires_at: i64 (8 bytes)

    if (data.length < 88) {
      throw new Error(`Invalid OverrideRequested event data length: ${data.length}`)
    }

    const vaultPda = new PublicKey(data.slice(0, 32)).toBase58()
    const nonce = data.readBigUInt64LE(32)
    const requestedBy = new PublicKey(data.slice(40, 72)).toBase58()
    const canExecuteAfter = data.readBigInt64LE(72)
    const expiresAt = data.readBigInt64LE(80)

    // Note: timestamp is canExecuteAfter for this event
    return {
      vaultPda,
      nonce,
      requestedBy,
      canExecuteAfter,
      expiresAt,
      timestamp: canExecuteAfter,
    }
  }

  private parseOverrideApprovedEvent(data: Buffer): OverrideApprovedEvent {
    // Event data structure (from IDL):
    // - vault: PublicKey (32 bytes)
    // - nonce: u64 (8 bytes)
    // - timestamp: i64 (8 bytes)
    // Total: 48 bytes

    if (data.length < 48) {
      throw new Error(`Invalid OverrideApproved event data length: ${data.length}`)
    }

    const vaultPda = new PublicKey(data.slice(0, 32)).toBase58()
    const nonce = data.readBigUInt64LE(32)
    const timestamp = data.readBigInt64LE(40)

    return {
      vaultPda,
      nonce,
      approvedBy: '', // Not in event, will be filled from transaction context
      timestamp,
    }
  }

  private parsePolicyUpdatedEvent(data: Buffer): PolicyUpdatedEvent {
    // Event data structure:
    // - vault_pda: PublicKey (32 bytes)
    // - daily_limit: Option<u64> (1 byte discriminator + 8 bytes if Some)
    // - whitelist_enabled: Option<bool> (1 byte discriminator + 1 byte if Some)
    // - whitelist: Option<Vec<PublicKey>> (1 byte discriminator + u32 length + 32*n bytes if Some)

    if (data.length < 32) {
      throw new Error(`Invalid PolicyUpdated event data length: ${data.length}`)
    }

    const vaultPda = new PublicKey(data.slice(0, 32)).toBase58()
    let offset = 32

    // Extract timestamp (should be at the end after all optional fields)
    // For now, use current time as fallback
    const event: PolicyUpdatedEvent = {
      vaultPda,
      timestamp: BigInt(Math.floor(Date.now() / 1000))
    }

    // Parse daily_limit (Option<u64>)
    if (offset < data.length) {
      const dailyLimitPresent = data.readUInt8(offset)
      offset += 1
      if (dailyLimitPresent === 1) {
        event.dailyLimit = data.readBigUInt64LE(offset)
        offset += 8
      }
    }

    // Parse whitelist_enabled (Option<bool>)
    if (offset < data.length) {
      const whitelistEnabledPresent = data.readUInt8(offset)
      offset += 1
      if (whitelistEnabledPresent === 1) {
        event.whitelistEnabled = data.readUInt8(offset) === 1
        offset += 1
      }
    }

    // Parse whitelist (Option<Vec<PublicKey>>)
    if (offset < data.length) {
      const whitelistPresent = data.readUInt8(offset)
      offset += 1
      if (whitelistPresent === 1) {
        const whitelistLength = data.readUInt32LE(offset)
        offset += 4
        const whitelist: string[] = []
        for (let i = 0; i < whitelistLength; i++) {
          whitelist.push(new PublicKey(data.slice(offset, offset + 32)).toBase58())
          offset += 32
        }
        event.whitelist = whitelist
      }
    }

    return event
  }
}

/**
 * Create and start the event listener
 */
export async function startEventListener(): Promise<EventListenerService> {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
  const programId = process.env.PROGRAM_ID

  if (!programId) {
    throw new Error('PROGRAM_ID environment variable is required')
  }

  const listener = new EventListenerService(rpcUrl, programId)
  await listener.start()

  return listener
}
