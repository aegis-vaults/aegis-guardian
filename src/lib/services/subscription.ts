/**
 * Subscription and Tier Management Service
 *
 * Handles subscription tier management with Stripe billing integration.
 * Supports PERSONAL, TEAM, and ENTERPRISE tiers with usage-based limits.
 *
 * @module services/subscription
 */

import Stripe from 'stripe'
import { VaultTier as PrismaVaultTier } from '@prisma/client'
import { prisma } from '../db'
import logger from '../logger'
import {
    VaultTier,
    TierLimits,
    UsageStats,
    UpgradeResult,
    DowngradeResult,
    SubscriptionError,
    NotFoundError,
    ValidationError,
    UpgradeTierSchema,
    DowngradeTierSchema,
} from '@/types'

//Initialize Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-11-17.clover',
    typescript: true,
})

// Tier price IDs from environment
const TIER_PRICE_IDS: Record<VaultTier, string> = {
    [VaultTier.PERSONAL]: process.env.STRIPE_PERSONAL_PRICE_ID || '',
    [VaultTier.TEAM]: process.env.STRIPE_TEAM_PRICE_ID || '',
    [VaultTier.ENTERPRISE]: process.env.STRIPE_ENTERPRISE_PRICE_ID || '',
}

// Conversion constants
const LAMPORTS_PER_SOL = 1_000_000_000n

/**
 * Get the tier limits configuration for a specific tier.
 *
 * @param tier - The vault tier (PERSONAL, TEAM, or ENTERPRISE)
 * @returns TierLimits object with max vaults, daily limit, team members, and features
 *
 * @example
 * ```typescript
 * const limits = getTierLimits(VaultTier.PERSONAL)
 * console.log(limits.maxVaults) // 1
 * console.log(limits.maxDailyLimit) // 100000000000n (100 SOL / $100)
 * ```
 */
export function getTierLimits(tier: VaultTier | PrismaVaultTier): TierLimits {
    // All tiers now have unlimited vaults (subscription tiers deprecated)
    // Features remain differentiated for future use
    switch (tier) {
        case 'PERSONAL':
            return {
                maxVaults: -1, // Unlimited vaults for all users
                maxDailyLimit: -1n, // Unlimited (enforced on-chain per vault)
                maxTeamMembers: -1, // Unlimited team members
                features: {
                    webhooks: true,
                    customDomain: false,
                    prioritySupport: false,
                    advancedAnalytics: true,
                },
            }

        case 'TEAM':
            return {
                maxVaults: -1, // Unlimited
                maxDailyLimit: -1n, // Unlimited
                maxTeamMembers: -1, // Unlimited
                features: {
                    webhooks: true,
                    customDomain: true,
                    prioritySupport: false,
                    advancedAnalytics: true,
                },
            }

        case 'ENTERPRISE':
            return {
                maxVaults: -1, // Unlimited
                maxDailyLimit: -1n, // Unlimited
                maxTeamMembers: -1, // Unlimited
                features: {
                    webhooks: true,
                    customDomain: true,
                    prioritySupport: true,
                    advancedAnalytics: true,
                },
            }

        default:
            // Default to PERSONAL tier limits (now unlimited)
            logger.warn({ tier }, 'Unknown tier, defaulting to PERSONAL limits')
            return getTierLimits('PERSONAL')
    }
}

/**
 * Check current usage against tier limits for a user.
 *
 * Queries the database to calculate:
 * - Number of active vaults owned by the user
 * - Maximum daily limit configured across all vaults
 * - Total team member count across all vaults
 *
 * Compares usage against current tier limits.
 *
 * @param userId - The user's ID (CUID)
 * @returns Promise<UsageStats> - Current usage vs limits
 * @throws {NotFoundError} If user not found
 *
 * @example
 * ```typescript
 * const usage = await checkUsageLimits('clfoo123')
 * if (!usage.can CreateVault) {
 *   console.log('User has reached vault limit')
 * }
 * ```
 */
export async function checkUsageLimits(userId: string): Promise<UsageStats> {
    try {
        // Fetch user with related data
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                vaults: {
                    where: { isActive: true },
                    include: {
                        teamMembers: true,
                    },
                },
            },
        })

        if (!user) {
            throw new NotFoundError('User', userId)
        }

        // Calculate current usage
        const vaultCount = user.vaults.length
        const maxDailyLimit =
            user.vaults.length > 0
                ? user.vaults.reduce(
                    (max, vault) => (vault.dailyLimit > max ? vault.dailyLimit : max),
                    0n
                )
                : 0n

        // Count unique team members across all vaults
        const teamMemberIds = new Set<string>()
        user.vaults.forEach((vault) => {
            vault.teamMembers.forEach((member) => {
                teamMemberIds.add(member.userId)
            })
        })
        const teamMemberCount = teamMemberIds.size

        // Get limits for current tier
        const limits = getTierLimits(user.tier)

        // Check if user can perform actions
        const canCreateVault =
            limits.maxVaults === -1 || vaultCount < limits.maxVaults
        const canIncreaseDailyLimit =
            limits.maxDailyLimit === -1n || maxDailyLimit < limits.maxDailyLimit
        const canAddTeamMembers =
            limits.maxTeamMembers === -1 || teamMemberCount < limits.maxTeamMembers

        const usage: UsageStats = {
            currentTier: user.tier as VaultTier,
            vaultCount,
            maxDailyLimit,
            teamMemberCount,
            limits,
            canCreateVault,
            canIncreaseDailyLimit,
            canAddTeamMembers,
        }

        logger.info(
            {
                userId,
                tier: user.tier,
                vaultCount,
                teamMemberCount,
                canCreateVault,
            },
            'Checked usage limits'
        )

        return usage
    } catch (error) {
        logger.error({ error, userId }, 'Failed to check usage limits')
        throw error
    }
}

/**
 * Check if a user can create another vault within their tier limits.
 *
 * @param userId - The user's ID (CUID)
 * @returns Promise<boolean> - True if user can create another vault
 * @throws {NotFoundError} If user not found
 *
 * @example
 * ```typescript
 * if (await canCreateVault('clfoo123')) {
 *   // Proceed with vault creation
 * } else {
 *   // Show upgrade prompt
 * }
 * ```
 */
export async function canCreateVault(userId: string): Promise<boolean> {
    try {
        const usage = await checkUsageLimits(userId)
        return usage.canCreateVault
    } catch (error) {
        logger.error({ error, userId }, 'Failed to check vault creation eligibility')
        throw error
    }
}

/**
 * Upgrade a user to a higher subscription tier.
 *
 * This function:
 * 1. Validates the upgrade (must be to a higher tier)
 * 2. Creates or retrieves Stripe customer
 * 3. Creates subscription with prorated billing (handled by Stripe)
 * 4. Updates user record in database
 *
 * Stripe automatically handles prorated charges based on the billing cycle.
 *
 * @param userId - The user's ID (CUID)
 * @param newTier - The target tier (must be higher than current)
 * @returns Promise<UpgradeResult> - Result with subscription details or error
 * @throws {ValidationError} If validation fails
 * @throws {SubscriptionError} If Stripe operation fails
 *
 * @example
 * ```typescript
 * const result = await upgradeTier('clfoo123', VaultTier.TEAM)
 * if (result.success) {
 *   console.log('Upgraded to TEAM tier')
 *   console.log('Subscription ID:', result.subscriptionId)
 *   console.log('Prorated amount:', result.proratedAmount)
 * }
 * ```
 */
export async function upgradeTier(
    userId: string,
    newTier: VaultTier
): Promise<UpgradeResult> {
    try {
        // Validate input
        const validation = UpgradeTierSchema.safeParse({ userId, newTier })
        if (!validation.success) {
            throw new ValidationError('Invalid upgrade parameters', validation.error)
        }

        // Fetch user
        const user = await prisma.user.findUnique({
            where: { id: userId },
        })

        if (!user) {
            throw new NotFoundError('User', userId)
        }

        const currentTier = user.tier as VaultTier

        // Validate upgrade direction (must be upgrading, not downgrading)
        const tierOrder: Record<VaultTier, number> = {
            [VaultTier.PERSONAL]: 0,
            [VaultTier.TEAM]: 1,
            [VaultTier.ENTERPRISE]: 2,
        }
        const currentTierOrder = tierOrder[currentTier]
        const newTierOrder = tierOrder[newTier]

        if (currentTierOrder === undefined || newTierOrder === undefined) {
            throw new ValidationError('Invalid tier specified')
        }

        if (newTierOrder <= currentTierOrder) {
            throw new ValidationError(
                `Cannot upgrade from ${currentTier} to ${newTier}. Use downgradeTier for downgrades.`
            )
        }

        logger.info(
            { userId, currentTier, newTier },
            'Starting tier upgrade process'
        )

        // Get or create Stripe customer
        let customerId = user.stripeCustomerId

        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email || undefined,
                metadata: {
                    userId: user.id,
                    walletAddress: user.walletAddress,
                },
            })
            customerId = customer.id
            logger.info({ userId, customerId }, 'Created Stripe customer')
        }

        // Get price ID for new tier
        const priceId = TIER_PRICE_IDS[newTier]
        if (!priceId) {
            throw new SubscriptionError(
                `No Stripe price ID configured for tier: ${newTier}`
            )
        }

        // Create or update subscription
        let subscription: Stripe.Subscription

        if (user.stripeSubscriptionId) {
            // Update existing subscription (Stripe handles proration)
            subscription = await stripe.subscriptions.update(
                user.stripeSubscriptionId,
                {
                    items: [
                        {
                            price: priceId,
                        },
                    ],
                    proration_behavior: 'create_prorations', // Enable prorated billing
                    metadata: {
                        previousTier: currentTier,
                        newTier,
                    },
                }
            )
            logger.info(
                { userId, subscriptionId: subscription.id },
                'Updated Stripe subscription'
            )
        } else {
            // Create new subscription
            subscription = await stripe.subscriptions.create({
                customer: customerId,
                items: [
                    {
                        price: priceId,
                    },
                ],
                metadata: {
                    userId: user.id,
                    tier: newTier,
                },
            })
            logger.info(
                { userId, subscriptionId: subscription.id },
                'Created Stripe subscription'
            )
        }

        // Calculate prorated amount from latest invoice (if exists)
        let proratedAmount = 0
        if (subscription.latest_invoice) {
            const invoice =
                typeof subscription.latest_invoice === 'string'
                    ? await stripe.invoices.retrieve(subscription.latest_invoice)
                    : subscription.latest_invoice

            proratedAmount = invoice.amount_due
        }

        // Update user in database (wrapped in transaction)
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                tier: newTier as PrismaVaultTier,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscription.id,
                subscriptionStatus: subscription.status,
                currentPeriodEnd: new Date(((subscription as any).current_period_end as number) * 1000),
                scheduledDowngrade: null, // Clear any pending downgrade
                updatedAt: new Date(),
            },
        })

        logger.info(
            {
                userId,
                oldTier: currentTier,
                newTier,
                subscriptionId: subscription.id,
                proratedAmount,
            },
            'Successfully upgraded user tier'
        )

        return {
            success: true,
            subscriptionId: subscription.id,
            newTier: updatedUser.tier as VaultTier,
            proratedAmount,
        }
    } catch (error) {
        logger.error({ error, userId, newTier }, 'Failed to upgrade tier')

        if (
            error instanceof ValidationError ||
            error instanceof NotFoundError ||
            error instanceof SubscriptionError
        ) {
            return {
                success: false,
                newTier,
                error: error.message,
            }
        }

        // Stripe API errors
        if (error instanceof Stripe.errors.StripeError) {
            return {
                success: false,
                newTier,
                error: `Stripe error: ${error.message}`,
            }
        }

        return {
            success: false,
            newTier,
            error: 'An unexpected error occurred during upgrade',
        }
    }
}

/**
 * Downgrade a user to a lower subscription tier.
 *
 * This function:
 * 1. Validates the downgrade (must be to a lower tier)
 * 2. Checks current usage against new tier limits
 * 3. Rejects if usage exceeds new tier limits (prevents data loss)
 * 4. Schedules downgrade for end of billing period via Stripe
 * 5. Updates user record with pending downgrade
 *
 * The downgrade takes effect at the end of the current billing period.
 *
 * @param userId - The user's ID (CUID)
 * @param newTier - The target tier (must be lower than current)
 * @returns Promise<DowngradeResult> - Result with scheduled date or usage violations
 * @throws {ValidationError} If validation fails
 * @throws {SubscriptionError} If Stripe operation fails
 *
 * @example
 * ```typescript
 * const result = await downgradeTier('clfoo123', VaultTier.PERSONAL)
 * if (!result.success && result.usageViolations) {
 *   console.log('Cannot downgrade: usage exceeds limits')
 *   console.log('Current vaults:', result.usageViolations.vaultCount?.current)
 *   console.log('Allowed vaults:', result.usageViolations.vaultCount?.allowed)
 * } else if (result.success) {
 *   console.log('Downgrade scheduled for:', result.scheduledFor)
 * }
 * ```
 */
export async function downgradeTier(
    userId: string,
    newTier: VaultTier
): Promise<DowngradeResult> {
    try {
        // Validate input
        const validation = DowngradeTierSchema.safeParse({ userId, newTier })
        if (!validation.success) {
            throw new ValidationError(
                'Invalid downgrade parameters',
                validation.error
            )
        }

        // Fetch user
        const user = await prisma.user.findUnique({
            where: { id: userId },
        })

        if (!user) {
            throw new NotFoundError('User', userId)
        }

        const currentTier = user.tier as VaultTier

        // Validate downgrade direction (must be downgrading, not upgrading)
        const tierOrder: Record<VaultTier, number> = {
            [VaultTier.PERSONAL]: 0,
            [VaultTier.TEAM]: 1,
            [VaultTier.ENTERPRISE]: 2,
        }
        const currentTierOrder = tierOrder[currentTier]
        const newTierOrder = tierOrder[newTier]

        if (currentTierOrder === undefined || newTierOrder === undefined) {
            throw new ValidationError('Invalid tier specified')
        }

        if (newTierOrder >= currentTierOrder) {
            throw new ValidationError(
                `Cannot downgrade from ${currentTier} to ${newTier}. Use upgradeTier for upgrades.`
            )
        }

        logger.info(
            { userId, currentTier, newTier },
            'Starting tier downgrade process'
        )

        // Check current usage
        const usage = await checkUsageLimits(userId)
        const newLimits = getTierLimits(newTier)

        // Check if usage fits within new tier limits
        const violations: DowngradeResult['usageViolations'] = {}
        let hasViolations = false

        if (newLimits.maxVaults !== -1 && usage.vaultCount > newLimits.maxVaults) {
            violations.vaultCount = {
                current: usage.vaultCount,
                allowed: newLimits.maxVaults,
            }
            hasViolations = true
        }

        if (
            newLimits.maxDailyLimit !== -1n &&
            usage.maxDailyLimit > newLimits.maxDailyLimit
        ) {
            violations.dailyLimit = {
                current: usage.maxDailyLimit.toString(),
                allowed: newLimits.maxDailyLimit.toString(),
            }
            hasViolations = true
        }

        if (
            newLimits.maxTeamMembers !== -1 &&
            usage.teamMemberCount > newLimits.maxTeamMembers
        ) {
            violations.teamMembers = {
                current: usage.teamMemberCount,
                allowed: newLimits.maxTeamMembers,
            }
            hasViolations = true
        }

        // Reject downgrade if usage exceeds new tier limits
        if (hasViolations) {
            logger.warn(
                { userId, currentTier, newTier, violations },
                'Downgrade rejected: usage exceeds new tier limits'
            )

            return {
                success: false,
                newTier,
                error:
                    'Current usage exceeds new tier limits. Please reduce usage before downgrading.',
                usageViolations: violations,
            }
        }

        // Get Stripe subscription
        if (!user.stripeSubscriptionId) {
            throw new SubscriptionError('No active subscription found')
        }

        // Get price ID for new tier
        const priceId = TIER_PRICE_IDS[newTier]
        if (!priceId) {
            throw new SubscriptionError(
                `No Stripe price ID configured for tier: ${newTier}`
            )
        }

        // Schedule downgrade at period end
        const subscription = await stripe.subscriptions.update(
            user.stripeSubscriptionId,
            {
                items: [
                    {
                        price: priceId,
                    },
                ],
                proration_behavior: 'none', // No proration for downgrades
                billing_cycle_anchor: 'unchanged', // Keep current billing date
                metadata: {
                    scheduledDowngrade: newTier,
                    previousTier: currentTier,
                },
            }
        )

        const scheduledFor = new Date(((subscription as any).current_period_end as number) * 1000)

        // Update user in database
        await prisma.user.update({
            where: { id: userId },
            data: {
                scheduledDowngrade: newTier as PrismaVaultTier,
                currentPeriodEnd: scheduledFor,
                updatedAt: new Date(),
            },
        })

        logger.info(
            {
                userId,
                oldTier: currentTier,
                newTier,
                scheduledFor,
            },
            'Successfully scheduled tier downgrade'
        )

        return {
            success: true,
            scheduledFor,
            newTier,
        }
    } catch (error) {
        logger.error({ error, userId, newTier }, 'Failed to downgrade tier')

        if (
            error instanceof ValidationError ||
            error instanceof NotFoundError ||
            error instanceof SubscriptionError
        ) {
            return {
                success: false,
                newTier,
                error: error.message,
            }
        }

        // Stripe API errors
        if (error instanceof Stripe.errors.StripeError) {
            return {
                success: false,
                newTier,
                error: `Stripe error: ${error.message}`,
            }
        }

        return {
            success: false,
            newTier,
            error: 'An unexpected error occurred during downgrade',
        }
    }
}
