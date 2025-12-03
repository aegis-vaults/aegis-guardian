/**
 * Aegis Guardian - Override Blink Actions Endpoint
 * 
 * This implements the Solana Actions protocol for override approval.
 * When an agent-signed transaction is blocked by policy, the agent can
 * generate a Blink URL that the vault owner can use to approve the override.
 * 
 * Solana Actions Protocol:
 * - GET: Returns action metadata (title, icon, description)
 * - POST: Returns the transaction to sign
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import logger from '@/lib/logger'

// Aegis Program ID
const AEGIS_PROGRAM_ID = new PublicKey('ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ')

// Solana RPC
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'

// Block reasons
const BLOCK_REASONS: Record<string, number> = {
  exceeded_daily_limit: 0,
  not_whitelisted: 1,
  vault_paused: 2,
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
      description: `Approve override for ${amountSol.toFixed(4)} SOL transfer. Reason: ${reason.replace(/_/g, ' ')}`,
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
    const overrideNonceOffset = 8 + 32 + 32 + 8 + 8 + 8 + 640 + 1 + 1 + 2 + 50 + 1 + 1
    const overrideNonce = data.readBigUInt64LE(overrideNonceOffset)
    const vaultNonce = data.readBigUInt64LE(overrideNonceOffset + 8)

    // Derive pending override PDA
    const [pendingOverridePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('override'),
        vaultPubkey.toBuffer(),
        new BN(overrideNonce.toString()).toArrayLike(Buffer, 'le', 8),
      ],
      AEGIS_PROGRAM_ID
    )

    // Build create_override instruction
    // Discriminator: sha256("global:create_override")[:8]
    const crypto = await import('crypto')
    const hash = crypto.createHash('sha256')
    hash.update('global:create_override')
    const discriminator = hash.digest().slice(0, 8)

    // Instruction data
    const instructionData = Buffer.alloc(8 + 8 + 32 + 8 + 1)
    discriminator.copy(instructionData, 0)
    instructionData.writeBigUInt64LE(vaultNonce, 8)
    destinationPubkey.toBuffer().copy(instructionData, 16)
    instructionData.writeBigUInt64LE(amountLamports, 48)
    instructionData.writeUInt8(blockReason, 56)

    const createOverrideIx = new TransactionInstruction({
      keys: [
        { pubkey: vaultPubkey, isSigner: false, isWritable: true },
        { pubkey: signerPubkey, isSigner: true, isWritable: true },
        { pubkey: pendingOverridePda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: AEGIS_PROGRAM_ID,
      data: instructionData,
    })

    // Build transaction
    const transaction = new Transaction()
    transaction.add(createOverrideIx)

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash('confirmed')
    transaction.recentBlockhash = blockhash
    transaction.feePayer = signerPubkey

    // Serialize transaction (without signatures)
    const serializedTx = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })

    logger.info({
      vault,
      destination,
      amount: amountLamports.toString(),
      reason,
      signer: account,
      pendingOverride: pendingOverridePda.toBase58(),
    }, 'Created override transaction')

    // Return Solana Actions response
    return NextResponse.json(
      {
        type: 'transaction',
        transaction: serializedTx.toString('base64'),
        message: `Approve override for ${(Number(amountLamports) / LAMPORTS_PER_SOL).toFixed(4)} SOL to ${destination.slice(0, 8)}...`,
      },
      { headers: ACTIONS_CORS_HEADERS }
    )
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error in POST /api/blinks/override')
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: ACTIONS_CORS_HEADERS }
    )
  }
}

