import { Hono } from 'hono'

import { tokenStorageKV } from './worker_token_storage_kv.js'

const app = new Hono()

// CORS for browser clients
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || ''
  const allowed = c.env.CLIENT_URL || '*'
  const isAllowed = allowed === '*' || origin === allowed
  c.header('Access-Control-Allow-Origin', isAllowed ? (origin || allowed) : allowed)
  c.header('Vary', 'Origin')
  c.header('Access-Control-Allow-Credentials', 'true')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, x-internal-token')
  c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204)
  }
  await next()
})

app.get('/api/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.get('/api/system-status', async c => {
  return c.json({
    status: 'operational',
    timestamp: new Date().toISOString(),
    platform: 'cloudflare-workers'
  })
})

app.get('/api/saved-tokens', async c => {
  const network = c.req.query('network') || null
  const storage = tokenStorageKV(c.env.TOKEN_STORAGE)
  const result = await storage.getSavedTokens(network)
  return c.json({ success: result.success, tokens: result.tokens || [], message: result.message })
})

app.post('/api/save-tokens', async c => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON' }, 400)
  const { tokens, network } = body
  if (!Array.isArray(tokens) || !network) return c.json({ error: 'Invalid payload' }, 400)
  const storage = tokenStorageKV(c.env.TOKEN_STORAGE)
  const res = await storage.saveTokens(tokens, network)
  return c.json(res.success ? res : { success: false, error: res.error || 'Failed' }, res.success ? 200 : 400)
})

app.delete('/api/saved-tokens', async c => {
  const body = await c.req.json().catch(() => ({}))
  const { network, tokenAddress } = body || {}
  if (!network) return c.json({ error: 'Missing network' }, 400)
  const storage = tokenStorageKV(c.env.TOKEN_STORAGE)
  const res = await storage.deleteSavedTokens(network, tokenAddress || null)
  return c.json(res)
})

// Protected internal monitor-once (stub; implement MonitorLock Durable Object next)
app.post('/api/internal/monitor-once', async c => {
  const token = c.req.header('x-internal-token') || c.req.query('token')
  if (!c.env.INTERNAL_API_TOKEN || token !== c.env.INTERNAL_API_TOKEN) return c.json({ error: 'Unauthorized' }, 401)
  if (!c.env.MonitorLock) return c.json({ success: false, error: 'MonitorLock DO not bound' }, 500)
  const id = c.env.MonitorLock.idFromName('global-monitor')
  const stub = c.env.MonitorLock.get(id)
  const res = await stub.fetch(new URL('/lock/run', c.req.url), { method: 'POST' })
  const payload = await res.json()
  return c.json(payload)
})

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: async (event, env, ctx) => {
    if ((env.ENABLE_INTERNAL_CRON || '').toLowerCase() !== 'true') return
    const id = env.MonitorLock.idFromName('global-monitor')
    const stub = env.MonitorLock.get(id)
    await stub.fetch('https://do/lock/run', { method: 'POST' })
  }
}

// Ensure Durable Object class is included in bundle
export { MonitorLock } from './worker_monitor_lock.js'


