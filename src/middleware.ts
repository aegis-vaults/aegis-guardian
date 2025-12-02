import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware for handling CORS across all API routes
 * Allows requests from the frontend (aegis-vaults.xyz) and local development
 */
export function middleware(request: NextRequest) {
  // Get allowed origins from environment variable or use defaults
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
    : [
        'https://aegis-vaults.xyz',
        'https://www.aegis-vaults.xyz',
        'http://localhost:3001',
        'http://localhost:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:3000',
      ]

  const origin = request.headers.get('origin')
  const isAllowedOrigin = origin && allowedOrigins.includes(origin)

  // Log CORS check for debugging (only in development or when origin is blocked)
  if (origin && !isAllowedOrigin && process.env.NODE_ENV === 'development') {
    console.log('[CORS] Blocked origin:', origin, 'Allowed:', allowedOrigins)
  }

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 200 })

    if (isAllowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', origin)
    }

    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    )
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, Accept, Origin, x-user-id'
    )
    response.headers.set('Access-Control-Max-Age', '86400')

    return response
  }

  // Handle actual requests
  const response = NextResponse.next()

  if (isAllowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    )
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, Accept, Origin, x-user-id'
    )
  }

  return response
}

// Configure which routes this middleware applies to
export const config = {
  matcher: '/api/:path*',
}
