/**
 * API Key Utilities
 */

import crypto from 'crypto';

/**
 * Generate a secure API key
 * Format: ak_live_<32 random chars> or ak_test_<32 random chars>
 */
export function generateApiKey(environment: 'live' | 'test' = 'live'): string {
  const randomBytes = crypto.randomBytes(24); // 24 bytes = 32 base64 chars
  const key = randomBytes.toString('base64url').substring(0, 32);
  return `ak_${environment}_${key}`;
}

/**
 * Hash an API key for storage
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Get the prefix of an API key for display
 * Returns the first 12 characters (e.g., "ak_live_abc...")
 */
export function getApiKeyPrefix(key: string): string {
  return key.substring(0, 12);
}

/**
 * Validate API key format
 */
export function isValidApiKeyFormat(key: string): boolean {
  return /^ak_(live|test)_[A-Za-z0-9_-]{32}$/.test(key);
}
