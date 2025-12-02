export default function HomePage() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Aegis Guardian</h1>
      <p>Backend service for Aegis on-chain operating system</p>
      <p>
        <a href="/api/health" style={{ color: '#0070f3' }}>
          Health Check
        </a>
      </p>
    </main>
  )
}
