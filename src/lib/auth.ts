import { NextRequest } from 'next/server'
import prisma from './db'
import { User, ApiKey } from '@prisma/client'
import { createLogger } from './logger'
import { hashApiKey, isValidApiKeyFormat } from './api-keys'

const logger = createLogger({ service: 'auth' })

export interface AuthContext {
    user: User
    apiKey?: ApiKey
    vaultId?: string
}

/**
 * Extract API key from Authorization header
 * Expected format: "Bearer ak_live_xxx" or "Bearer ak_test_xxx"
 */
function extractApiKey(req: NextRequest): string | null {
    const authHeader = req.headers.get('authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null
    }

    const key = authHeader.substring(7).trim()
    return isValidApiKeyFormat(key) ? key : null
}

/**
 * Validate API key and return auth context
 * Returns user, API key, and vault scope if applicable
 */
export async function validateApiKey(req: NextRequest): Promise<AuthContext | null> {
    const rawKey = extractApiKey(req)

    if (!rawKey) {
        return null
    }

    try {
        const keyHash = hashApiKey(rawKey)

        // Find API key in database
        const apiKey = await (prisma as any).apiKey.findUnique({
            where: { key: keyHash },
            include: { user: true },
        })

        if (!apiKey) {
            logger.warn({ prefix: rawKey.substring(0, 12) }, 'API key not found')
            return null
        }

        // Check if key is active
        if (!apiKey.isActive) {
            logger.warn({ keyId: apiKey.id }, 'Attempted use of inactive API key')
            return null
        }

        // Check if key is expired
        if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
            logger.warn({ keyId: apiKey.id, expiresAt: apiKey.expiresAt }, 'Attempted use of expired API key')
            return null
        }

        // Update last used timestamp (fire and forget)
        (prisma as any).apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
        }).catch((error: Error) => {
            logger.error({ error, keyId: apiKey.id }, 'Failed to update API key lastUsedAt')
        })

        logger.info({
            keyId: apiKey.id,
            userId: apiKey.userId,
            vaultId: apiKey.vaultId,
            prefix: apiKey.prefix
        }, 'API key validated successfully')

        return {
            user: apiKey.user,
            apiKey,
            vaultId: apiKey.vaultId,
        }
    } catch (error) {
        logger.error({ error }, 'Failed to validate API key')
        return null
    }
}

/**
 * Get authenticated user from request
 * Tries API key authentication first, then falls back to x-user-id header
 */
export async function getAuthUser(req: NextRequest): Promise<User | null> {
    // Try API key authentication first
    const apiKeyAuth = await validateApiKey(req)
    if (apiKeyAuth) {
        return apiKeyAuth.user
    }

    // Fall back to header-based authentication
    const userId = req.headers.get('x-user-id')

    if (!userId) {
        return null
    }

    try {
        // Cast prisma to any to avoid stale type error if User model is not yet picked up by IDE
        const user = await (prisma as any).user.findUnique({
            where: { id: userId },
        })

        return user as User
    } catch (error) {
        logger.error({ error, userId }, 'Failed to fetch auth user')
        return null
    }
}

/**
 * Get full authentication context including API key and vault scope
 * Use this when you need to enforce vault-scoped permissions
 */
export async function getAuthContext(req: NextRequest): Promise<AuthContext | null> {
    // Try API key authentication first
    const apiKeyAuth = await validateApiKey(req)
    if (apiKeyAuth) {
        return apiKeyAuth
    }

    // Fall back to header-based authentication
    const userId = req.headers.get('x-user-id')

    if (!userId) {
        return null
    }

    try {
        const user = await (prisma as any).user.findUnique({
            where: { id: userId },
        })

        if (!user) {
            return null
        }

        return { user }
    } catch (error) {
        logger.error({ error, userId }, 'Failed to fetch auth user')
        return null
    }
}

/**
 * Check if authenticated user has permission for an operation
 * If API key is scoped to a vault, validates that the requested vault matches
 */
export function hasVaultAccess(authContext: AuthContext, vaultId: string): boolean {
    // If API key is vault-scoped, only allow access to that vault
    if (authContext.apiKey && authContext.vaultId) {
        return authContext.vaultId === vaultId
    }

    // Otherwise, allow access (will be checked against vault ownership separately)
    return true
}

/**
 * Check if authenticated user has specific permission
 * Permission format: "vault:read", "vault:write", "transaction:read", etc.
 */
export function hasPermission(authContext: AuthContext, permission: string): boolean {
    // If no API key, assume full permissions (header-based auth)
    if (!authContext.apiKey) {
        return true
    }

    // Check if API key has the required permission
    const permissions = authContext.apiKey.permissions || []
    return permissions.includes(permission) || permissions.includes('*')
}
