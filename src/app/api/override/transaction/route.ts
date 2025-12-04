/**
 * Aegis Guardian - Override Transaction Builder API
 * 
 * POST /api/override/transaction
 * 
 * Builds an override transaction for the aegis-app frontend.
 * This endpoint handles the complex vault parsing and instruction building
 * server-side, returning a serialized transaction for the client to sign.
 * 
 * Request Body:
 * {
 *   vault: string,        // Vault public key
 *   destination: string,  // Destination address
 *   amount: string,       // Amount in lamports
 *   reason: string,       // Block reason (exceeded_daily_limit, not_whitelisted, etc.)
 *   signer: string,       // Signer's public key (vault authority)
 * }
 * 
 * Response:
 * {
 *   transaction: string,        // Base64-encoded serialized transaction
 *   blockhash: string,          // Recent blockhash used
 *   lastValidBlockHeight: number, // Block height expiration
 *   simulationSuccess: boolean, // Whether simulation passed
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
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

// Block reasons - must match IDL BlockReason enum order
const BLOCK_REASONS: Record<string, number> = {
  not_whitelisted: 0,
  exceeded_daily_limit: 1,
  insufficient_funds: 2,
}

// CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
    headers: CORS_HEADERS,
  })
}

/**
 * POST - Build override transaction
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { vault, destination, amount, reason, signer } = body

    // Validate required fields
    if (!vault || !destination || !amount || !signer) {
      return NextResponse.json(
        { error: 'Missing required parameters: vault, destination, amount, signer' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const signerPubkey = new PublicKey(signer)
    const vaultPubkey = new PublicKey(vault)
    const destinationPubkey = new PublicKey(destination)
    const amountLamports = BigInt(amount)
    const blockReason = BLOCK_REASONS[reason] ?? 1 // Default to exceeded_daily_limit

    // Connect to Solana
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed')

    // Fetch vault data to get nonces
    const vaultAccount = await connection.getAccountInfo(vaultPubkey)
    if (!vaultAccount) {
      return NextResponse.json(
        { error: 'Vault not found on-chain' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const data = vaultAccount.data

    // Verify signer is vault authority
    const authority = new PublicKey(data.slice(8, 40))
    if (!authority.equals(signerPubkey)) {
      return NextResponse.json(
        { error: 'Only the vault owner can approve overrides' },
        { status: 403, headers: CORS_HEADERS }
      )
    }

    // Parse override_nonce and vault_nonce
    // Offsets based on VaultConfig struct
    const overrideNonceOffset = 792
    const currentOverrideNonce = data.readBigUInt64LE(overrideNonceOffset)
    const vaultNonce = data.readBigUInt64LE(overrideNonceOffset + 8)
    
    const overrideNonceToUse = currentOverrideNonce
    
    // Derive PDAs
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
    
    // Add compute budget instructions
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }))
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000000 }))
    
    // 1. Build create_override instruction
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

    // 2. Build approve_override instruction
    const approveOverrideData = Buffer.alloc(8 + 8)
    approveOverrideDisc.copy(approveOverrideData, 0)
    approveOverrideData.writeBigUInt64LE(vaultNonce, 8)

    const approveOverrideIx = new TransactionInstruction({
      keys: [
        { pubkey: vaultPubkey, isSigner: false, isWritable: false },
        { pubkey: signerPubkey, isSigner: true, isWritable: false },
        { pubkey: pendingOverridePda, isSigner: false, isWritable: true },
      ],
      programId: AEGIS_PROGRAM_ID,
      data: approveOverrideData,
    })
    instructions.push(approveOverrideIx)

    // 3. Build execute_approved_override instruction
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
      return NextResponse.json(
        { error: 'Fee treasury not initialized. Contact support.' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')

    // Create versioned transaction
    const messageV0 = new TransactionMessage({
      payerKey: signerPubkey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message()

    const versionedTransaction = new VersionedTransaction(messageV0)

    // Simulate transaction
    let simulationSuccess = true
    try {
      const simulation = await connection.simulateTransaction(versionedTransaction, {
        sigVerify: false,
        replaceRecentBlockhash: false,
      })

      if (simulation.value.err) {
        logger.warn({
          error: simulation.value.err,
          logs: simulation.value.logs,
          vault,
          destination,
        }, 'Transaction simulation failed')
        simulationSuccess = false
        
        // Return error with simulation details
        return NextResponse.json(
          { 
            error: `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`,
            logs: simulation.value.logs,
          },
          { status: 400, headers: CORS_HEADERS }
        )
      }

      logger.info({
        unitsConsumed: simulation.value.unitsConsumed,
      }, 'Transaction simulation successful')
    } catch (simError: any) {
      logger.warn({ error: simError.message }, 'Simulation threw error, continuing anyway')
      simulationSuccess = false
    }

    // Serialize transaction
    const serializedTx = Buffer.from(versionedTransaction.serialize())

    logger.info({
      vault,
      destination,
      amount: amountLamports.toString(),
      reason,
      signer,
      txSize: serializedTx.length,
    }, 'Built override transaction for self-hosted approval')

    return NextResponse.json(
      {
        transaction: serializedTx.toString('base64'),
        blockhash,
        lastValidBlockHeight,
        simulationSuccess,
      },
      { headers: CORS_HEADERS }
    )
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Error building override transaction')
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

