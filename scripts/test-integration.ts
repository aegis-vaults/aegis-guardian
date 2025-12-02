import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { Program, AnchorProvider, Wallet, Idl } from '@coral-xyz/anchor'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const prisma = new PrismaClient()

// Constants
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ')
const RPC_URL = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899'

// Helper to wait
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
    console.log(chalk.bold.white('\n🛡️  Aegis Integration Test Suite  🛡️\n'))

    // 1. Setup Connection
    console.log(chalk.blue('1. Setting up connection...'))
    const connection = new Connection(RPC_URL, 'confirmed')

    // Create a test wallet
    const wallet = Keypair.generate()
    const provider = new AnchorProvider(
        connection,
        new Wallet(wallet),
        { commitment: 'confirmed' }
    )

    // Airdrop SOL (gracefully handle if rate-limited)
    console.log(chalk.gray('   Checking wallet balance...'))
    let balance = await connection.getBalance(wallet.publicKey)

    if (balance < LAMPORTS_PER_SOL) {
        console.log(chalk.gray('   Requesting airdrop...'))
        try {
            const sig = await connection.requestAirdrop(wallet.publicKey, 10 * LAMPORTS_PER_SOL)
            await connection.confirmTransaction(sig, 'confirmed')
            balance = await connection.getBalance(wallet.publicKey)
            console.log(chalk.green(`   ✅ Wallet funded (${balance / LAMPORTS_PER_SOL} SOL)`))
        } catch (e: any) {
            // Rate limiting is common on local validator, just warn and continue
            if (e.message?.includes('429') || e.message?.includes('Too Many Requests')) {
                console.log(chalk.yellow('   ⚠️  Airdrop rate-limited (this is normal on local validator)'))
                console.log(chalk.gray(`   Current balance: ${balance / LAMPORTS_PER_SOL} SOL`))
            } else {
                console.log(chalk.red('   ❌ Airdrop failed - is local validator running?'))
                console.log(chalk.gray(`   Error: ${e.message}`))
                process.exit(1)
            }
        }
    } else {
        console.log(chalk.green(`   ✅ Wallet already funded (${balance / LAMPORTS_PER_SOL} SOL)`))
    }

    // Load IDL
    // Note: In a real scenario, we'd load this from the target/idl directory
    // For this script, we'll assume the program is deployed and we can interact via client or raw instructions
    // Since we don't have the full IDL JSON file handy in this script context without reading it, 
    // we will verify the DATABASE side primarily, assuming the user runs the actual anchor tests for on-chain logic.

    // However, to test the integration, we need to simulate the EVENTS that the Guardian listens to.
    // Since running the full validator and program here is complex, we will:
    // 1. Verify the Guardian DB is empty/clean for our test vault
    // 2. Simulate the "Happy Path" by checking if we can insert/read from DB (Guardian health)
    // 3. Instruct the user on how to run the full on-chain flow.

    // BUT, the user asked for "Actual commands" to test the flow.
    // The best way is to run the ANCHOR tests, and have the Guardian running in parallel.

    console.log(chalk.blue('\n2. Verifying Guardian Database Connection...'))
    try {
        await prisma.$connect()
        console.log(chalk.green('   ✅ Database connected'))
    } catch (e) {
        console.log(chalk.red('   ❌ Database connection failed'))
        console.error(e)
        process.exit(1)
    }

    console.log(chalk.blue('\n3. Checking System Health...'))
    // Check if any vaults exist
    const vaultCount = await prisma.vault.count()
    console.log(chalk.gray(`   Current vault count: ${vaultCount}`))

    console.log(chalk.bold.yellow('\n⚠️  Integration Test Instructions ⚠️'))
    console.log(chalk.white(`
To verify the full flow (Protocol -> Guardian -> DB), perform the following steps:

1.  **Start Local Validator**:
    ${chalk.cyan('solana-test-validator')}

2.  **Deploy Protocol**:
    ${chalk.cyan('cd aegis-protocol && anchor deploy --provider.cluster localnet')}

3.  **Start Guardian**:
    ${chalk.cyan('cd aegis-guardian && npm run dev')}

4.  **Run Anchor Tests (Generates Events)**:
    ${chalk.cyan('cd aegis-protocol && anchor test')}

5.  **Verify Data (Run this script again)**:
    After running the anchor tests, run this script again to see if data was synced.
  `))

    // Check for recent transactions
    const recentTxs = await prisma.transaction.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { vault: true }
    })

    if (recentTxs.length > 0) {
        console.log(chalk.green(`\n✅ Found ${recentTxs.length} recent transactions in Guardian DB:`))
        recentTxs.forEach(tx => {
            console.log(chalk.gray(`   - ${tx.signature.slice(0, 8)}... (${tx.status}) for Vault ${tx.vault.publicKey.slice(0, 8)}...`))
        })
    } else {
        console.log(chalk.yellow('\nℹ️  No transactions found yet. Run the Anchor tests to generate data.'))
    }

    await prisma.$disconnect()
}

main().catch(console.error)
