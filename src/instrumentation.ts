/**
 * Next.js Instrumentation
 * This file is automatically run when the server starts
 * Used to initialize the event listener on server startup
 */

export async function register() {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startEventListener } = await import('./lib/services/event-listener')
    const { createLogger } = await import('./lib/logger')

    const logger = createLogger({ service: 'instrumentation' })

    // Check if event listener should be started
    const shouldStartListener = process.env.START_EVENT_LISTENER !== 'false'

    if (shouldStartListener) {
      try {
        logger.info('Starting event listener on server startup...')
        await startEventListener()
        logger.info('Event listener started successfully')
      } catch (error) {
        logger.error({ error }, 'Failed to start event listener')
        // Don't crash the server if event listener fails
        // This allows the API to continue working
      }
    } else {
      logger.info('Event listener disabled via START_EVENT_LISTENER=false')
    }
  }
}
