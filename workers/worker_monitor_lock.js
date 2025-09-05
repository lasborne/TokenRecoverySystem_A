export class MonitorLock {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname !== '/lock/run') return new Response('Not found', { status: 404 })

    const now = Date.now()
    const lock = await this.state.storage.get('lock')
    if (lock && (now - lock.timestamp) < 25000) {
      return new Response(JSON.stringify({ success: true, skipped: true, message: 'Another instance is running' }), {
        headers: { 'content-type': 'application/json' }
      })
    }

    await this.state.storage.put('lock', { timestamp: now })
    try {
      // TODO: integrate with a RecoveryService adapter; placeholder here
      const result = { processed: 0 }
      return new Response(JSON.stringify({ success: true, result }), { headers: { 'content-type': 'application/json' } })
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message || String(e) }), { status: 500, headers: { 'content-type': 'application/json' } })
    } finally {
      await this.state.storage.delete('lock')
    }
  }
}


