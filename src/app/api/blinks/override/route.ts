/**
 * Aegis Guardian - Override Blink Actions Endpoint
 * 
 * This implements the Solana Actions protocol for override approval.
 * When an agent-signed transaction is blocked by policy, the agent can
 * generate a Blink URL that the vault owner can use to approve the override.
 * 
 * The transaction includes ALL THREE steps:
 * 1. create_override - Creates the pending override
 * 2. approve_override - Approves it
 * 3. execute_approved_override - Executes the transfer
 * 
 * Solana Actions Protocol:
 * - GET: Returns action metadata (title, icon, description)
 * - POST: Returns the transaction to sign
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import logger from '@/lib/logger'

// Aegis Program ID
const AEGIS_PROGRAM_ID = new PublicKey('ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ')

// Solana RPC
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'

// Block reasons - must match IDL BlockReason enum order:
// NotWhitelisted = 0, ExceededDailyLimit = 1, InsufficientFunds = 2
const BLOCK_REASONS: Record<string, number> = {
  not_whitelisted: 0,
  exceeded_daily_limit: 1,
  insufficient_funds: 2,
}

// CORS headers for Solana Actions
const ACTIONS_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept-Encoding',
  'Access-Control-Expose-Headers': 'X-Action-Version, X-Blockchain-Ids',
  'X-Action-Version': '2.1.3',
  'X-Blockchain-Ids': 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
}

// Helper to compute instruction discriminator
async function getDiscriminator(name: string): Promise<Buffer> {
  const crypto = await import('crypto')
  const hash = crypto.createHash('sha256')
  hash.update(`global:${name}`)
  return hash.digest().slice(0, 8)
}

// Derive vault authority PDA
function deriveVaultAuthorityPda(vault: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault_authority'), vault.toBuffer()],
    AEGIS_PROGRAM_ID
  )
}

// Derive fee treasury PDA
function deriveFeeTreasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('treasury')],
    AEGIS_PROGRAM_ID
  )
}

/**
 * OPTIONS - CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: ACTIONS_CORS_HEADERS,
  })
}

/**
 * GET - Return action metadata
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const vault = searchParams.get('vault')
    const destination = searchParams.get('destination')
    const amount = searchParams.get('amount')
    const reason = searchParams.get('reason') || 'exceeded_daily_limit'

    if (!vault || !destination || !amount) {
      return NextResponse.json(
        { error: 'Missing required parameters: vault, destination, amount' },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      )
    }

    const amountSol = Number(amount) / LAMPORTS_PER_SOL

    // Return Solana Actions metadata
    const actionMetadata = {
      type: 'action',
      icon: 'https://aegis-vaults.xyz/aegis-icon.png',
      title: 'Aegis Override Request',
      description: `Approve override for ${amountSol.toFixed(4)} SOL transfer. Reason: ${reason.replace(/_/g, ' ')}. (Devnet: If you see a timeout, check your vault - the tx may have succeeded.)`,
      label: 'Approve Override',
      links: {
        actions: [
          {
            type: 'transaction',
            label: `Approve ${amountSol.toFixed(4)} SOL Override`,
            href: `/api/blinks/override?vault=${vault}&destination=${destination}&amount=${amount}&reason=${reason}`,
          },
        ],
      },
    }

    return NextResponse.json(actionMetadata, { headers: ACTIONS_CORS_HEADERS })
  } catch (error) {
    logger.error({ error }, 'Error in GET /api/blinks/override')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: ACTIONS_CORS_HEADERS }
    )
  }
}

/**
 * POST - Build and return the transaction
 * 
 * Creates a transaction with 3 instructions:
 * 1. create_override - Creates the pending override
 * 2. approve_override - Approves it
 * 3. execute_approved_override - Executes the actual transfer
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const vault = searchParams.get('vault')
    const destination = searchParams.get('destination')
    const amount = searchParams.get('amount')
    const reason = searchParams.get('reason') || 'exceeded_daily_limit'

    if (!vault || !destination || !amount) {
      return NextResponse.json(
        { error: 'Missing required parameters: vault, destination, amount' },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      )
    }

    // Parse request body for account (signer's public key)
    const body = await request.json()
    const account = body.account

    if (!account) {
      return NextResponse.json(
        { error: 'Missing account in request body' },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      )
    }

    const signerPubkey = new PublicKey(account)
    const vaultPubkey = new PublicKey(vault)
    const destinationPubkey = new PublicKey(destination)
    const amountLamports = BigInt(amount)
    const blockReason = BLOCK_REASONS[reason] ?? 0

    // Connect to Solana
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed')

    // Fetch vault data to get nonces
    const vaultAccount = await connection.getAccountInfo(vaultPubkey)
    if (!vaultAccount) {
      return NextResponse.json(
        { error: 'Vault not found' },
        { status: 404, headers: ACTIONS_CORS_HEADERS }
      )
    }

    const data = vaultAccount.data

    // Verify signer is vault authority
    const authority = new PublicKey(data.slice(8, 40))
    if (!authority.equals(signerPubkey)) {
      return NextResponse.json(
        { error: 'Only the vault owner can approve overrides' },
        { status: 403, headers: ACTIONS_CORS_HEADERS }
      )
    }

    // Parse override_nonce and vault_nonce
    // Offsets based on VaultConfig struct:
    // 8 (discriminator) + 32 (authority) + 32 (agent_signer) + 8 (daily_limit) + 8 (daily_spent) + 8 (last_reset) 
    // + 640 (whitelist: 20*32) + 1 (whitelist_count) + 1 (whitelist_enabled) + 2 (fee_basis_points) 
    // + 50 (name) + 1 (name_len) + 1 (paused) = 792
    const overrideNonceOffset = 792
    const currentOverrideNonce = data.readBigUInt64LE(overrideNonceOffset)
    const vaultNonce = data.readBigUInt64LE(overrideNonceOffset + 8)
    
    // The create_override instruction will increment the override_nonce and use that for the new override
    // So we use currentOverrideNonce (which will become the new override's nonce after increment)
    const overrideNonceToUse = currentOverrideNonce
    
    // Derive the PDA for the override that will be created
    // Note: create_override increments the nonce FIRST, then uses it, so this PDA is correct
    const [pendingOverridePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('override'),
        vaultPubkey.toBuffer(),
        new BN(overrideNonceToUse.toString()).toArrayLike(Buffer, 'le', 8),
      ],
      AEGIS_PROGRAM_ID
    )
    
    const [vaultAuthorityPda] = deriveVaultAuthorityPda(vaultPubkey)
    const [feeTreasury] = deriveFeeTreasuryPda()

    // Get discriminators
    const createOverrideDisc = await getDiscriminator('create_override')
    const approveOverrideDisc = await getDiscriminator('approve_override')
    const executeApprovedOverrideDisc = await getDiscriminator('execute_approved_override')

    // Build all instructions
    const instructions: TransactionInstruction[] = []
    
    // Add compute budget instructions - use maximum priority fee for fastest confirmation on devnet
    // Devnet can be unreliable with slow confirmation times
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 })) // Reduced - simulation shows ~43k used
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000000 })) // 10M microLamports = maximum priority
    
    // 1. Build create_override instruction
    // Always include create - if it already exists, the program will error, but that's better than missing it
    const createOverrideData = Buffer.alloc(8 + 8 + 32 + 8 + 1)
    createOverrideDisc.copy(createOverrideData, 0)
    createOverrideData.writeBigUInt64LE(vaultNonce, 8)
    destinationPubkey.toBuffer().copy(createOverrideData, 16)
    createOverrideData.writeBigUInt64LE(amountLamports, 48)
    createOverrideData.writeUInt8(blockReason, 56)

    const createOverrideIx = new TransactionInstruction({
      keys: [
        { pubkey: vaultPubkey, isSigner: false, isWritable: true },
        { pubkey: signerPubkey, isSigner: true, isWritable: true },
        { pubkey: pendingOverridePda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: AEGIS_PROGRAM_ID,
      data: createOverrideData,
    })
    
    instructions.push(createOverrideIx)
    logger.info({ 
      overrideNonce: overrideNonceToUse.toString(),
      pendingOverridePda: pendingOverridePda.toBase58(),
    }, 'Adding create_override instruction')

    // 2. Build approve_override instruction
    // Account order: vault, authority (signer), pending_override
    const approveOverrideData = Buffer.alloc(8 + 8)
    approveOverrideDisc.copy(approveOverrideData, 0)
    approveOverrideData.writeBigUInt64LE(vaultNonce, 8)

    const approveOverrideIx = new TransactionInstruction({
      keys: [
        { pubkey: vaultPubkey, isSigner: false, isWritable: false }, // vault is NOT mut for approve
        { pubkey: signerPubkey, isSigner: true, isWritable: false },
        { pubkey: pendingOverridePda, isSigner: false, isWritable: true },
      ],
      programId: AEGIS_PROGRAM_ID,
      data: approveOverrideData,
    })
    instructions.push(approveOverrideIx)

    // 3. Build execute_approved_override instruction
    // Account order: vault, pending_override, authority (signer), vault_authority, destination, fee_treasury, system_program
    const executeOverrideData = Buffer.alloc(8 + 8)
    executeApprovedOverrideDisc.copy(executeOverrideData, 0)
    executeOverrideData.writeBigUInt64LE(vaultNonce, 8)

    const executeOverrideIx = new TransactionInstruction({
      keys: [
        { pubkey: vaultPubkey, isSigner: false, isWritable: true },
        { pubkey: pendingOverridePda, isSigner: false, isWritable: true },
        { pubkey: signerPubkey, isSigner: true, isWritable: false },
        { pubkey: vaultAuthorityPda, isSigner: false, isWritable: true },
        { pubkey: destinationPubkey, isSigner: false, isWritable: true },
        { pubkey: feeTreasury, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: AEGIS_PROGRAM_ID,
      data: executeOverrideData,
    })
    instructions.push(executeOverrideIx)

    // Verify fee treasury exists
    const feeTreasuryAccount = await connection.getAccountInfo(feeTreasury)
    if (!feeTreasuryAccount) {
      logger.error({ feeTreasury: feeTreasury.toBase58() }, 'Fee treasury not initialized')
      return NextResponse.json(
        { error: 'Fee treasury not initialized. Contact support.' },
        { status: 500, headers: ACTIONS_CORS_HEADERS }
      )
    }

    // Get recent blockhash with confirmed commitment for faster confirmation
    // Using 'confirmed' instead of 'finalized' because devnet finalized can be slow
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')

    // Create versioned transaction (v0) - better supported by modern wallets and Blinks
    const messageV0 = new TransactionMessage({
      payerKey: signerPubkey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message()

    const versionedTransaction = new VersionedTransaction(messageV0)

    logger.info({
      vault,
      destination,
      amount: amountLamports.toString(),
      reason,
      signer: account,
      pendingOverride: pendingOverridePda.toBase58(),
      vaultAuthority: vaultAuthorityPda.toBase58(),
      feeTreasury: feeTreasury.toBase58(),
      overrideNonce: overrideNonceToUse.toString(),
      vaultNonce: vaultNonce.toString(),
      blockhash,
      lastValidBlockHeight,
    }, 'Built versioned override transaction, simulating...')

    // Simulate versioned transaction BEFORE returning to catch errors
    try {
      const simulation = await connection.simulateTransaction(versionedTransaction, {
        sigVerify: false,
        replaceRecentBlockhash: false,
      })

      if (simulation.value.err) {
        logger.error({
          error: simulation.value.err,
          logs: simulation.value.logs,
          vault,
          destination,
          overrideNonce: overrideNonceToUse.toString(),
        }, 'Transaction simulation failed')

        // Return detailed error to user
        const errorLogs = simulation.value.logs?.join('\n') || 'No logs available'
        return NextResponse.json(
          { 
            error: `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`,
            logs: errorLogs,
          },
          { status: 400, headers: ACTIONS_CORS_HEADERS }
        )
      }

      logger.info({
        unitsConsumed: simulation.value.unitsConsumed,
        logs: simulation.value.logs?.slice(-5),
      }, 'Transaction simulation successful')
    } catch (simError: any) {
      logger.error({ error: simError.message }, 'Failed to simulate transaction')
      // Continue anyway - simulation might fail for various reasons but tx could still work
    }

    // Serialize versioned transaction
    const serializedTx = Buffer.from(versionedTransaction.serialize())

    logger.info({
      vault,
      destination,
      amount: amountLamports.toString(),
      reason,
      signer: account,
      pendingOverride: pendingOverridePda.toBase58(),
      txSize: serializedTx.length,
      txVersion: 'v0',
    }, 'Created complete versioned override transaction (create + approve + execute)')

    // Return Solana Actions response
    // Note: Devnet can show timeout but tx may still succeed - check vault balance
    return NextResponse.json(
      {
        type: 'transaction',
        transaction: serializedTx.toString('base64'),
        message: `Override ${(Number(amountLamports) / LAMPORTS_PER_SOL).toFixed(4)} SOL transfer. Note: If you see a timeout, the transaction may still succeed - check your vault.`,
      },
      { headers: ACTIONS_CORS_HEADERS }
    )
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Error in POST /api/blinks/override')
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: ACTIONS_CORS_HEADERS }
    )
  }
}
