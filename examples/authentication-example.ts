/**
 * Aegis Guardian Authentication Example
 *
 * This example demonstrates how to:
 * 1. Create API keys
 * 2. Use API keys for authentication
 * 3. Manage API key lifecycle
 * 4. Handle authentication errors
 */

// ============================================================================
// Setup
// ============================================================================

/**
 * Example 1: Creating an API Key
 *
 * You need to be authenticated to create an API key. Use either:
 * - An existing API key (if you have one)
 * - The x-user-id header (for development)
 */
async function createApiKey() {
  const response = await fetch('http://localhost:3000/api/api-keys', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Option 1: Use existing API key
      'Authorization': 'Bearer ak_live_existing_key...',
      // Option 2: Use development header
      // 'x-user-id': 'your-user-id'
    },
    body: JSON.stringify({
      name: 'My Production Key',
      environment: 'live', // or 'test'
      permissions: ['vault:read', 'vault:write', 'transaction:read'],
      // Optional: Scope to a specific vault
      // vaultId: 'clx_vault_12345',
      // Optional: Set expiration
      // expiresAt: '2026-12-31T23:59:59Z'
    })
  });

  const result = await response.json();

  if (result.success) {
    console.log('API Key Created!');
    console.log('Key ID:', result.data.apiKey.id);
    console.log('Key:', result.data.key); // ⚠️ Save this! Only shown once
    console.log('Prefix:', result.data.apiKey.prefix);

    // Store the key securely (e.g., in environment variables)
    return result.data.key;
  } else {
    console.error('Failed to create API key:', result.error);
    throw new Error(result.error);
  }
}

// ============================================================================
// Using API Keys with the SDK
// ============================================================================

/**
 * Example 2: Using API Key with the Aegis SDK
 */
async function useSdkWithApiKey() {
  // Import the SDK (assumes @aegis/sdk is installed)
  // import { GuardianClient } from '@aegis/sdk';

  // In a real application, load from environment variables
  const apiKey = process.env.AEGIS_API_KEY || 'ak_live_abc123...';

  // Initialize the client
  const guardian = {
    baseUrl: 'http://localhost:3000',
    apiKey
  };

  // Example: List user's vaults
  const vaultsResponse = await fetch(
    `${guardian.baseUrl}/api/vaults?myVaults=true`,
    {
      headers: {
        'Authorization': `Bearer ${guardian.apiKey}`
      }
    }
  );

  const vaults = await vaultsResponse.json();
  console.log('My Vaults:', vaults.data);

  // Example: Get transaction history
  const txResponse = await fetch(
    `${guardian.baseUrl}/api/transactions?myTransactions=true&page=1&pageSize=20`,
    {
      headers: {
        'Authorization': `Bearer ${guardian.apiKey}`
      }
    }
  );

  const transactions = await txResponse.json();
  console.log('My Transactions:', transactions.data);
}

// ============================================================================
// Managing API Keys
// ============================================================================

/**
 * Example 3: List All API Keys
 */
async function listApiKeys(apiKey: string) {
  const response = await fetch(
    'http://localhost:3000/api/api-keys?page=1&pageSize=20&isActive=true',
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    }
  );

  const result = await response.json();

  if (result.success) {
    console.log('Active API Keys:');
    result.data.items.forEach((key: any) => {
      console.log(`- ${key.name} (${key.prefix})`);
      console.log(`  Permissions: ${key.permissions.join(', ')}`);
      console.log(`  Last used: ${key.lastUsedAt || 'Never'}`);
      console.log(`  Rate limit: ${key.rateLimit} req/min`);
      console.log();
    });
  }
}

/**
 * Example 4: Get Specific API Key Details
 */
async function getApiKeyDetails(apiKey: string, keyId: string) {
  const response = await fetch(
    `http://localhost:3000/api/api-keys/${keyId}`,
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    }
  );

  const result = await response.json();

  if (result.success) {
    console.log('API Key Details:', result.data);
  }
}

/**
 * Example 5: Revoke an API Key
 */
async function revokeApiKey(apiKey: string, keyId: string) {
  const response = await fetch(
    `http://localhost:3000/api/api-keys/${keyId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    }
  );

  const result = await response.json();

  if (result.success) {
    console.log('API key revoked successfully');
  } else {
    console.error('Failed to revoke key:', result.error);
  }
}

// ============================================================================
// Vault-Scoped API Keys
// ============================================================================

/**
 * Example 6: Create a Vault-Scoped API Key
 */
async function createVaultScopedKey(existingApiKey: string, vaultId: string) {
  const response = await fetch('http://localhost:3000/api/api-keys', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${existingApiKey}`
    },
    body: JSON.stringify({
      name: 'Third-Party Integration Key',
      vaultId: vaultId, // Scope to specific vault
      permissions: ['vault:read', 'transaction:read'], // Read-only
      environment: 'live'
    })
  });

  const result = await response.json();

  if (result.success) {
    console.log('Vault-scoped key created:', result.data.key);
    console.log('This key can only access vault:', vaultId);
    return result.data.key;
  }
}

/**
 * Example 7: Using a Vault-Scoped Key
 */
async function useVaultScopedKey(scopedKey: string, authorizedVaultId: string) {
  // This will work - accessing the authorized vault
  const response1 = await fetch(
    `http://localhost:3000/api/vaults/${authorizedVaultId}`,
    {
      headers: {
        'Authorization': `Bearer ${scopedKey}`
      }
    }
  );
  console.log('Authorized vault access:', await response1.json());

  // This will fail with 403 - accessing a different vault
  const response2 = await fetch(
    `http://localhost:3000/api/vaults/different-vault-id`,
    {
      headers: {
        'Authorization': `Bearer ${scopedKey}`
      }
    }
  );
  console.log('Unauthorized vault access:', await response2.json());
  // Expected: { success: false, error: 'API key is not authorized for this vault' }
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Example 8: Proper Error Handling
 */
async function handleAuthErrors(apiKey: string) {
  try {
    const response = await fetch(
      'http://localhost:3000/api/vaults?myVaults=true',
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        console.error('Authentication failed - API key is invalid or expired');
        // Handle: Refresh API key or prompt user to authenticate
      } else if (response.status === 403) {
        console.error('Access denied - insufficient permissions');
        // Handle: Show permission error to user
      } else if (response.status === 429) {
        console.error('Rate limit exceeded');
        const retryAfter = response.headers.get('Retry-After');
        console.log(`Try again in ${retryAfter} seconds`);
        // Handle: Implement exponential backoff
      } else {
        console.error('Request failed:', response.status, response.statusText);
      }
      return;
    }

    const result = await response.json();
    console.log('Success:', result.data);

  } catch (error) {
    console.error('Network error:', error);
    // Handle: Show connection error to user
  }
}

/**
 * Example 9: Exponential Backoff for Rate Limiting
 */
async function fetchWithBackoff(
  url: string,
  apiKey: string,
  maxRetries = 3
): Promise<any> {
  let retries = 0;
  let delay = 1000; // Start with 1 second

  while (retries < maxRetries) {
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (response.status === 429) {
        // Rate limited - wait and retry
        console.log(`Rate limited. Waiting ${delay}ms before retry ${retries + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
        retries++;
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();

    } catch (error) {
      if (retries === maxRetries - 1) {
        throw error; // Max retries reached
      }
      retries++;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }

  throw new Error('Max retries exceeded');
}

// ============================================================================
// Best Practices
// ============================================================================

/**
 * Example 10: Production Best Practices
 */

// ❌ DON'T: Hardcode API keys
const _badExample = {
  apiKey: 'ak_live_abc123def456...' // Never do this!
};

// ✅ DO: Use environment variables
const goodExample = {
  apiKey: process.env.AEGIS_API_KEY
};

// ✅ DO: Validate environment variables on startup
function validateConfig() {
  if (!process.env.AEGIS_API_KEY) {
    throw new Error('AEGIS_API_KEY environment variable is required');
  }

  if (!process.env.AEGIS_API_KEY.startsWith('ak_')) {
    throw new Error('Invalid API key format');
  }

  console.log('✓ Configuration validated');
}

// ✅ DO: Implement proper error boundaries
class GuardianClientWrapper {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.AEGIS_API_KEY!;
    this.baseUrl = process.env.AEGIS_GUARDIAN_URL || 'http://localhost:3000';
  }

  async makeRequest(endpoint: string, options?: RequestInit) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...options?.headers
        }
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return await response.json();
    } catch (error) {
      this.handleError(error);
    }
  }

  private async handleErrorResponse(response: Response) {
    const errorBody = await response.json().catch(() => null);

    switch (response.status) {
      case 401:
        throw new Error('Authentication failed - check API key');
      case 403:
        throw new Error('Access denied - insufficient permissions');
      case 429:
        throw new Error('Rate limit exceeded - please slow down');
      default:
        throw new Error(`API error: ${response.status} - ${errorBody?.error || response.statusText}`);
    }
  }

  private handleError(error: any) {
    console.error('Guardian API error:', error);

    // Log to monitoring service
    // e.g., Sentry.captureException(error);

    throw error;
  }
}

// ============================================================================
// Complete Example
// ============================================================================

/**
 * Example 11: Complete Authentication Flow
 */
async function completeExample() {
  console.log('=== Aegis Guardian Authentication Example ===\n');

  try {
    // Step 1: Create an API key (using development auth)
    console.log('Step 1: Creating API key...');
    const newKey = await createApiKey();
    console.log('✓ API key created\n');

    // Step 2: Use the key to list vaults
    console.log('Step 2: Fetching vaults...');
    await useSdkWithApiKey();
    console.log('✓ Vaults fetched\n');

    // Step 3: List all API keys
    console.log('Step 3: Listing all API keys...');
    await listApiKeys(newKey);
    console.log('✓ API keys listed\n');

    // Step 4: Create a vault-scoped key
    console.log('Step 4: Creating vault-scoped key...');
    const scopedKey = await createVaultScopedKey(newKey, 'example-vault-id');
    console.log('✓ Vault-scoped key created\n');

    console.log('=== Example completed successfully ===');

  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}

// ============================================================================
// Run Examples
// ============================================================================

// Uncomment to run:
// completeExample().catch(console.error);

export {
  createApiKey,
  useSdkWithApiKey,
  listApiKeys,
  getApiKeyDetails,
  revokeApiKey,
  createVaultScopedKey,
  useVaultScopedKey,
  handleAuthErrors,
  fetchWithBackoff,
  validateConfig,
  GuardianClientWrapper
};
