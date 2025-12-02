import { startEventListener } from '../src/lib/services/event-listener'
import { createLogger } from '../src/lib/logger'

const logger = createLogger({ service: 'listener-startup' })

/**
 * Standalone script to start the Aegis event listener
 * This runs independently from the Next.js server
 */
async function main() {
    logger.info('Starting Aegis Guardian Event Listener...')

    // Check required environment variables
    const requiredVars = ['PROGRAM_ID', 'SOLANA_RPC_URL', 'DATABASE_URL']
    const missing = requiredVars.filter(v => !process.env[v])

    if (missing.length > 0) {
        logger.error({ missing }, 'Missing required environment variables')
        process.exit(1)
    }

    try {
        // Start the event listener
        const listener = await startEventListener()
        logger.info('Event listener started successfully')

        // Handle graceful shutdown
        const shutdown = async () => {
            logger.info('Shutting down event listener...')
            await listener.stop()
            process.exit(0)
        }

        process.on('SIGINT', shutdown)
        process.on('SIGTERM', shutdown)

        // Keep process running
        logger.info('Event listener is now running. Press Ctrl+C to stop.')
    } catch (error) {
        logger.error({ error }, 'Failed to start event listener')
        process.exit(1)
    }
}

main().catch((error) => {
    logger.error({ error }, 'Unexpected error in main')
    process.exit(1)
})
