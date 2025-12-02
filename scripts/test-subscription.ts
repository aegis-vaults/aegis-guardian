/**
 * Subscription Service Test Script
 *
 * This script demonstrates how to use the subscription service
 * and performs basic validation of the tier limits.
 */

import {
    getTierLimits,
    checkUsageLimits,
    canCreateVault,
    upgradeTier,
    downgradeTier,
} from '../src/lib/services/subscription'
import { VaultTier } from '../src/types'

/**
 * Test 1: Verify tier limits configuration
 */
function testTierLimits() {
    console.log('=== Testing Tier Limits ===\n')

    const personalLimits = getTierLimits('PERSONAL')
    console.log('PERSONAL Tier:')
    console.log('  Max Vaults:', personalLimits.maxVaults)
    console.log(
        '  Max Daily Limit:',
        personalLimits.maxDailyLimit.toString(),
        'lamports'
    )
    console.log('  Max Team Members:', personalLimits.maxTeamMembers)
    console.log('  Webhooks:', personalLimits.features.webhooks)
    console.log()

    const teamLimits = getTierLimits('TEAM')
    console.log('TEAM Tier:')
    console.log('  Max Vaults:', teamLimits.maxVaults)
    console.log('  Max Daily Limit:', teamLimits.maxDailyLimit.toString(), 'lamports')
    console.log('  Max Team Members:', teamLimits.maxTeamMembers)
    console.log('  Webhooks:', teamLimits.features.webhooks)
    console.log('  Advanced Analytics:', teamLimits.features.advancedAnalytics)
    console.log()

    const enterpriseLimits = getTierLimits('ENTERPRISE')
    console.log('ENTERPRISE Tier:')
    console.log('  Max Vaults:', enterpriseLimits.maxVaults === -1 ? 'Unlimited' : enterpriseLimits.maxVaults)
    console.log(
        '  Max Daily Limit:',
        enterpriseLimits.maxDailyLimit === -1n ? 'Unlimited' : enterpriseLimits.maxDailyLimit.toString()
    )
    console.log('  Max Team Members:', enterpriseLimits.maxTeamMembers === -1 ? 'Unlimited' : enterpriseLimits.maxTeamMembers)
    console.log('  All Features:', Object.values(enterpriseLimits.features).every(Boolean))
    console.log()

    // Validate expected values
    const LAMPORTS_PER_SOL = 1_000_000_000n

    if (personalLimits.maxVaults !== 1) {
        console.error('❌ PERSONAL maxVaults should be 1')
        return false
    }
    if (personalLimits.maxDailyLimit !== BigInt(100) * LAMPORTS_PER_SOL) {
        console.error('❌ PERSONAL maxDailyLimit should be 100 SOL')
        return false
    }
    if (personalLimits.maxTeamMembers !== 5) {
        console.error('❌ PERSONAL maxTeamMembers should be 5')
        return false
    }

    if (teamLimits.maxVaults !== 10) {
        console.error('❌ TEAM maxVaults should be 10')
        return false
    }
    if (teamLimits.maxDailyLimit !== BigInt(1000) * LAMPORTS_PER_SOL) {
        console.error('❌ TEAM maxDailyLimit should be 1000 SOL')
        return false
    }
    if (teamLimits.maxTeamMembers !== 20) {
        console.error('❌ TEAM maxTeamMembers should be 20')
        return false
    }

    if (enterpriseLimits.maxVaults !== -1) {
        console.error('❌ ENTERPRISE maxVaults should be unlimited (-1)')
        return false
    }
    if (enterpriseLimits.maxDailyLimit !== -1n) {
        console.error('❌ ENTERPRISE maxDailyLimit should be unlimited (-1n)')
        return false
    }
    if (enterpriseLimits.maxTeamMembers !== -1) {
        console.error('❌ ENTERPRISE maxTeamMembers should be unlimited (-1)')
        return false
    }

    console.log('✅ All tier limits configured correctly!\n')
    return true
}

/**
 * Test 2: Example usage patterns
 */
async function exampleUsage() {
    console.log('=== Example Usage Patterns ===\n')

    // Example 1: Check if user can create a vault
    console.log('Example 1: Check vault creation eligibility')
    console.log('```typescript')
    console.log('const canCreate = await canCreateVault(userId)')
    console.log('if (!canCreate) {')
    console.log('  throw new Error("Vault limit reached. Please upgrade your plan.")')
    console.log('}')
    console.log('```\n')

    // Example 2: Check current usage
    console.log('Example 2: Display usage stats to user')
    console.log('```typescript')
    console.log('const usage = await checkUsageLimits(userId)')
    console.log('console.log(`Vaults: ${usage.vaultCount}/${usage.limits.maxVaults}`)')
    console.log('console.log(`Team Members: ${usage.teamMemberCount}/${usage.limits.maxTeamMembers}`)')
    console.log('```\n')

    // Example 3: Upgrade tier
    console.log('Example 3: Upgrade user to TEAM tier')
    console.log('```typescript')
    console.log('const result = await upgradeTier(userId, "TEAM")')
    console.log('if (result.success) {')
    console.log('  console.log("Upgraded successfully!")')
    console.log('  console.log("Subscription ID:", result.subscriptionId)')
    console.log('  console.log("Prorated charge:", result.proratedAmount, "cents")')
    console.log('} else {')
    console.log('  console.error("Upgrade failed:", result.error)')
    console.log('}')
    console.log('```\n')

    // Example 4: Downgrade tier
    console.log('Example 4: Schedule downgrade to PERSONAL tier')
    console.log('```typescript')
    console.log('const result = await downgradeTier(userId, "PERSONAL")')
    console.log('if (!result.success && result.usageViolations) {')
    console.log('  // User has too many vaults/team members')
    console.log('  console.error("Cannot downgrade:")')
    console.log('  if (result.usageViolations.vaultCount) {')
    console.log('    console.error(`You have ${result.usageViolations.vaultCount.current} vaults`)')
    console.log('    console.error(`PERSONAL tier allows ${result.usageViolations.vaultCount.allowed}`)')
    console.log('  }')
    console.log('} else if (result.success) {')
    console.log('  console.log("Downgrade scheduled for:", result.scheduledFor)')
    console.log('}')
    console.log('```\n')

    // Example 5: API endpoint integration
    console.log('Example 5: API endpoint for checking limits')
    console.log('```typescript')
    console.log('// app/api/subscription/usage/route.ts')
    console.log('export async function GET(request: Request) {')
    console.log('  const userId = await getUserIdFromAuth(request)')
    console.log('  const usage = await checkUsageLimits(userId)')
    console.log('  return Response.json({ success: true, data: usage })')
    console.log('}')
    console.log('```\n')
}

/**
 * Main test runner
 */
async function main() {
    console.log('╔════════════════════════════════════════╗')
    console.log('║  Subscription Service Test Suite      ║')
    console.log('╚════════════════════════════════════════╝\n')

    try {
        // Run tier limits test
        const limitsPass = testTierLimits()

        if (!limitsPass) {
            console.error('❌ Tier limits test failed')
            process.exit(1)
        }

        // Show usage examples
        await exampleUsage()

        console.log('╔════════════════════════════════════════╗')
        console.log('║  ✅ All Tests Passed!                  ║')
        console.log('╚════════════════════════════════════════╝\n')

        console.log('Next Steps:')
        console.log('1. Add Stripe credentials to .env file:')
        console.log('   - STRIPE_SECRET_KEY')
        console.log('   - STRIPE_WEBHOOK_SECRET')
        console.log('   - STRIPE_PERSONAL_PRICE_ID')
        console.log('   - STRIPE_TEAM_PRICE_ID')
        console.log('   - STRIPE_ENTERPRISE_PRICE_ID')
        console.log('')
        console.log('2. Run database migration:')
        console.log('   npm run prisma:migrate')
        console.log('')
        console.log('3. Test with real Stripe API in test mode')
    } catch (error) {
        console.error('❌ Test failed with error:', error)
        process.exit(1)
    }
}

main()
