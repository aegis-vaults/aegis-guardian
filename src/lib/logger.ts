import pino from 'pino'

/**
 * Production-grade structured logger using Pino
 * Provides high-performance logging with JSON formatting
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() }
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

/**
 * Child logger factory for creating loggers with context
 *
 * @param context - Object containing contextual information (service name, request ID, etc.)
 * @returns Pino logger instance with bound context
 *
 * @example
 * const log = createLogger({ service: 'event-listener', vaultId: '123' })
 * log.info('Processing transaction')
 */
export function createLogger(context: Record<string, unknown>): pino.Logger {
  return logger.child(context)
}

export default logger
