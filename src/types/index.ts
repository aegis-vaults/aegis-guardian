import { z } from 'zod'

/**
 * Solana public key validation (base58 encoded, 32-44 characters)
 */
export const SolanaPublicKeySchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid Solana public key format')

/**
 * Transaction signature validation (base58 encoded, 88 characters)
 */
export const TransactionSignatureSchema = z
  .string()
  .length(88)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid transaction signature format')

/**
 * Solana event discriminators (first 8 bytes of event data)
 * These are the Anchor event discriminators from the IDL
 * Converted from byte arrays to hex strings for matching
 */
export enum EventDiscriminator {
  // VaultInitialized: [180, 43, 207, 2, 18, 71, 3, 75]
  VaultInitialized = '0xb42bcf021247034b',
  // VaultCreated: [117, 25, 120, 254, 75, 236, 78, 115]
  VaultCreated = '0x751978fe4bec4e73',
  // TransactionExecuted: [211, 227, 168, 14, 32, 111, 189, 210]
  TransactionExecuted = '0xd3e3a80e206fbdd2',
  // TransactionBlocked: [3, 64, 83, 53, 179, 19, 131, 87]
  TransactionBlocked = '0x03405335b3138357',
  // OverrideCreated: [109, 39, 191, 207, 28, 235, 116, 67]
  OverrideRequested = '0x6d27bfcf1ceb7443',
  // OverrideApproved: [173, 131, 53, 85, 191, 81, 150, 221]
  OverrideApproved = '0xad833555bf5196dd',
  // PolicyUpdated: [225, 112, 112, 67, 95, 236, 245, 161]
  PolicyUpdated = '0xe17070435fecf5a1',
}

/**
 * Parsed event data structures
 */

/**
 * VaultInitialized event from the protocol
 * 
 * Note: The actual protocol event only contains vault, authority, dailyLimit, and timestamp.
 * The guardian and overrideDelay fields are populated with defaults by the event listener:
 * - guardian is set to authority (same person manages the vault)
 * - overrideDelay defaults to 3600 seconds (1 hour)
 */
export interface VaultInitializedEvent {
  vaultPda: string
  owner: string
  guardian: string // Set to same value as owner
  dailyLimit: bigint
  overrideDelay: number // Default: 3600 (1 hour)
  timestamp: bigint
}

export interface TransactionExecutedEvent {
  vaultPda: string
  signature: string
  from: string
  to: string
  amount: bigint
  feeCollected?: bigint
  timestamp: bigint
}

export interface TransactionBlockedEvent {
  vaultPda: string
  signature: string
  from: string
  to: string
  amount: bigint
  reason: string
  timestamp: bigint
}

export interface OverrideRequestedEvent {
  vaultPda: string
  nonce: bigint
  requestedBy: string
  canExecuteAfter: bigint
  expiresAt: bigint
  timestamp: bigint
}

export interface OverrideApprovedEvent {
  vaultPda: string
  nonce: bigint
  approvedBy: string
  timestamp: bigint
}

export interface PolicyUpdatedEvent {
  vaultPda: string
  dailyLimit?: bigint
  whitelistEnabled?: boolean
  whitelist?: string[]
  timestamp: bigint
}

/**
 * API request/response types
 */
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

export interface PaginatedResponse<T> {
  items: T[]
  pagination: {
    total: number
    page: number
    pageSize: number
    hasNext: boolean
  }
}

/**
 * Webhook payload types
 */
export interface WebhookPayload {
  event: string
  vaultId: string
  timestamp: string
  data: unknown
  signature: string // HMAC signature for verification
}

/**
 * Analytics query types
 */
export interface AnalyticsQuery {
  vaultId?: string
  startDate: Date
  endDate: Date
  granularity: 'hour' | 'day' | 'week' | 'month'
}

export interface AnalyticsResult {
  period: string
  transactionsTotal: number
  transactionsExecuted: number
  transactionsBlocked: number
  volumeTotal: string // BigInt as string
  volumeExecuted: string
  volumeBlocked: string
}

/**
 * Blink action types (Solana Actions spec)
 */
export interface BlinkAction {
  type: 'transaction'
  label: string
  href: string
  parameters?: BlinkParameter[]
}

export interface BlinkParameter {
  name: string
  label: string
  required: boolean
  type?: 'text' | 'email' | 'url' | 'number' | 'date' | 'datetime'
  pattern?: string
}

export interface BlinkMetadata {
  title: string
  icon: string
  description: string
  label: string
  links?: {
    actions: BlinkAction[]
  }
}

/**
 * Error types
 */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, id?: string) {
    super(
      'NOT_FOUND',
      id ? `${resource} with id ${id} not found` : `${resource} not found`,
      404
    )
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401)
    this.name = 'UnauthorizedError'
  }
}

export class RateLimitError extends ApiError {
  constructor(retryAfter?: number) {
    super('RATE_LIMIT_EXCEEDED', 'Too many requests', 429, { retryAfter })
    this.name = 'RateLimitError'
  }
}

export class SubscriptionError extends ApiError {
  constructor(message: string, details?: unknown) {
    super('SUBSCRIPTION_ERROR', message, 400, details)
    this.name = 'SubscriptionError'
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(service: string, details?: unknown) {
    super(
      'SERVICE_UNAVAILABLE',
      `${service} is temporarily unavailable. Please try again later.`,
      503,
      details
    )
    this.name = 'ServiceUnavailableError'
  }
}

/**
 * Subscription and tier management types
 */
export enum VaultTier {
  PERSONAL = 'PERSONAL',
  TEAM = 'TEAM',
  ENTERPRISE = 'ENTERPRISE',
}

export interface TierLimits {
  maxVaults: number // -1 for unlimited
  maxDailyLimit: bigint // Maximum allowed daily limit in lamports, -1n for unlimited
  maxTeamMembers: number // Max team members across all vaults, -1 for unlimited
  features: {
    webhooks: boolean
    customDomain: boolean
    prioritySupport: boolean
    advancedAnalytics: boolean
  }
}

export interface UsageStats {
  currentTier: VaultTier
  vaultCount: number
  maxDailyLimit: bigint // Highest daily limit across user's vaults
  teamMemberCount: number
  limits: TierLimits
  canCreateVault: boolean
  canIncreaseDailyLimit: boolean
  canAddTeamMembers: boolean
}

export interface UpgradeResult {
  success: boolean
  subscriptionId?: string
  newTier: VaultTier
  proratedAmount?: number // In cents
  error?: string
}

export interface DowngradeResult {
  success: boolean
  scheduledFor?: Date // When downgrade will take effect
  newTier: VaultTier
  error?: string
  usageViolations?: {
    vaultCount?: { current: number; allowed: number }
    dailyLimit?: { current: string; allowed: string }
    teamMembers?: { current: number; allowed: number }
  }
}

/**
 * Zod validation schemas for subscription operations
 */
export const VaultTierSchema = z.enum(['PERSONAL', 'TEAM', 'ENTERPRISE'])

export const UpgradeTierSchema = z.object({
  userId: z.string().cuid(),
  newTier: VaultTierSchema,
})

export const DowngradeTierSchema = z.object({
  userId: z.string().cuid(),
  newTier: VaultTierSchema,
})
// Trigger rebuild 1764725394
