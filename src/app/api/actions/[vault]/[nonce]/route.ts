import { NextRequest, NextResponse } from 'next/server'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { Program, Idl, BN } from '@coral-xyz/anchor'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ service: 'actions-api' })

// Minimal IDL for approve_override
const IDL: Idl = {
    address: "ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ",
    metadata: {
        name: "aegis_core",
        version: "0.1.0",
        spec: "0.1.0",
        description: "Aegis Protocol"
    },
    instructions: [
        {
            name: "approve_override",
            discriminator: [41, 2, 181, 184, 119, 133, 62, 52],
            accounts: [
                {
                    name: "vault",
                    writable: false,
                    pda: {
                        seeds: [
                            { kind: "const", value: [118, 97, 117, 108, 116] }, // "vault"
                            { kind: "account", path: "authority" }
                        ]
                    }
                },
                {
                    name: "authority",
                    signer: true
                },
                {
                    name: "pending_override",
                    writable: true,
                    pda: {
                        seeds: [
                            { kind: "const", value: [111, 118, 101, 114, 114, 105, 100, 101] }, // "override"
                            { kind: "account", path: "vault" },
                            { kind: "account", path: "pending_override.nonce", account: "PendingOverride" }
                        ]
                    }
                }
            ],
            args: []
        }
    ]
}

export const GET = async (
    _req: NextRequest,
    { params }: { params: Promise<{ vault: string; nonce: string }> }
) => {
    const { vault: vaultAddress, nonce } = await params

    try {
        // Validate inputs
        if (!vaultAddress || !nonce) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }

        // Find the vault to get the ID
        const vault = await prisma.vault.findUnique({
            where: { publicKey: vaultAddress },
        })

        if (!vault) {
            return NextResponse.json({ error: 'Vault not found' }, { status: 404 })
        }

        // Find the override
        const override = await prisma.override.findFirst({
            where: {
                vaultId: vault.id,
                nonce: BigInt(nonce),
            },
        })

        if (!override) {
            return NextResponse.json({ error: 'Override not found' }, { status: 404 })
        }

        // Check if override is active/pending
        if (override.status !== 'PENDING') {
            return NextResponse.json({ error: 'Override is not pending' }, { status: 400 })
        }

        // Validate BASE_URL - use production default if invalid
        const envBaseUrl = process.env.BASE_URL || ''
        const isValidUrl = envBaseUrl && 
            envBaseUrl.startsWith('http') && 
            !envBaseUrl.includes(' ') && 
            !envBaseUrl.includes('+') && 
            !envBaseUrl.toLowerCase().includes('domains')
        const baseUrl = isValidUrl ? envBaseUrl.replace(/\/$/, '') : 'https://aegis-guardian-production.up.railway.app'
        const actionUrl = `${baseUrl}/api/actions/${vaultAddress}/${nonce}`

        // Return metadata
        const payload = {
            type: "action",
            icon: `${baseUrl}/icons/aegis-shield.png`, // Ensure this icon exists or use a placeholder
            title: "Approve Aegis Override",
            description: `Approve override request #${nonce} for vault ${vaultAddress.slice(0, 8)}...`,
            label: "Approve",
            links: {
                actions: [
                    {
                        label: "Approve",
                        href: actionUrl, // POST endpoint
                    }
                ]
            }
        }

        return NextResponse.json(payload, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'X-Action-Version': '1',
            }
        })

    } catch (error) {
        logger.error({ error, vaultAddress, nonce }, 'Failed to get action metadata')
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

export const OPTIONS = async () => {
    return new NextResponse(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'X-Action-Version': '1',
        },
    })
}

export const POST = async (
    req: NextRequest,
    { params }: { params: Promise<{ vault: string; nonce: string }> }
) => {
    const { vault: vaultAddress, nonce } = await params

    try {
        const body = await req.json()
        const { account } = body

        if (!account) {
            return NextResponse.json({ error: 'Missing account' }, { status: 400 })
        }

        // 1. Load override from database
        const vault = await prisma.vault.findUnique({
            where: { publicKey: vaultAddress },
        })

        if (!vault) {
            return NextResponse.json({ error: 'Vault not found' }, { status: 404 })
        }

        const override = await prisma.override.findFirst({
            where: {
                vaultId: vault.id,
                nonce: BigInt(nonce),
            },
        })

        if (!override) {
            return NextResponse.json({ error: 'Override not found' }, { status: 404 })
        }

        // 2. Verify not expired
        const now = Math.floor(Date.now() / 1000)
        if (Number(override.expiresAt) < now) {
            return NextResponse.json({ error: 'Override expired' }, { status: 400 })
        }

        if (override.status !== 'PENDING') {
            return NextResponse.json({ error: 'Override is not pending' }, { status: 400 })
        }

        // 3. Verify account is vault authority (owner)
        if (account !== vault.owner) {
            return NextResponse.json({ error: 'Unauthorized: Only vault owner can approve' }, { status: 401 })
        }

        // 4. Build approve_override instruction
        const connection = new Connection(
            process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        )

        // Initialize Program with a dummy provider since we only need to build the instruction
        // We don't have a wallet here, so we can't sign.
        const programId = new PublicKey(process.env.AEGIS_PROGRAM_ID || IDL.address)
        const program = new Program(IDL, { connection })

        // Derive PDAs
        const vaultPda = new PublicKey(vaultAddress)

        // Derive pending_override PDA
        // seeds: [b"override", vault.key().as_ref(), nonce.to_le_bytes().as_ref()]
        const nonceBn = new BN(nonce)
        const [pendingOverridePda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("override"),
                vaultPda.toBuffer(),
                nonceBn.toArrayLike(Buffer, 'le', 8)
            ],
            programId
        )

        const instruction = await (program.methods as any)
            .approveOverride()
            .accounts({
                vault: vaultPda,
                authority: new PublicKey(account),
                pendingOverride: pendingOverridePda,
            })
            .instruction()

        const transaction = new Transaction()
        transaction.add(instruction)

        // Set recent blockhash
        const { blockhash } = await connection.getLatestBlockhash()
        transaction.recentBlockhash = blockhash
        transaction.feePayer = new PublicKey(account)

        // Serialize transaction
        const serializedTransaction = transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
        }).toString('base64')

        // 5. Return serialized unsigned transaction
        return NextResponse.json({
            transaction: serializedTransaction,
            message: `Approve override #${nonce}`,
        }, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'X-Action-Version': '1',
            }
        })

    } catch (error) {
        logger.error({ error, vaultAddress, nonce }, 'Failed to create action transaction')
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
