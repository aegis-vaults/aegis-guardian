import { NextResponse } from 'next/server'

/**
 * Process liveness endpoint for Railway.
 *
 * Keep this independent of PostgreSQL and Redis: those dependencies are checked
 * by /api/health, while Railway only needs to know whether this HTTP process is
 * accepting requests. A dependency outage should not cause restart loops.
 */
export function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  )
}
