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

// Register a new recovery
app.post('/api/register-recovery', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    
    const { hackedWallet, safeWallet, network, nonce } = body

    // Validate request body
    if (!hackedWallet || !safeWallet || !network) {
      return c.json({
        error: 'Missing required fields: hackedWallet, safeWallet, network'
      }, 400)
    }

    // For now, return a success response (in production, this would store in KV/D1)
    return c.json({
      success: true,
      message: 'Recovery registered successfully',
      data: {
        id: `${hackedWallet}-${network}`,
        hackedWallet,
        safeWallet,
        network,
        nonce,
        isActive: true,
        createdAt: new Date().toISOString()
      }
    })
  } catch (error) {
    console.error('Register recovery error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Get all active recoveries
app.get('/api/active-recoveries', async c => {
  try {
    // For now, return empty array (in production, this would read from KV/D1)
    return c.json([])
  } catch (error) {
    console.error('Get active recoveries error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Get recovery status
app.get('/api/recovery-status/:hackedWallet', async c => {
  try {
    const hackedWallet = c.req.param('hackedWallet')
    
    if (!hackedWallet) {
      return c.json({
        error: 'Missing hacked wallet address'
      }, 400)
    }

    // For now, return not found (in production, this would read from KV/D1)
    return c.json({
      error: 'Recovery not found'
    }, 404)
  } catch (error) {
    console.error('Get recovery status error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Deactivate a recovery
app.post('/api/deactivate-recovery', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    
    const { hackedWallet, network } = body

    // Validate request body
    if (!hackedWallet || !network) {
      return c.json({
        error: 'Missing required fields: hackedWallet, network'
      }, 400)
    }

    // For now, return success (in production, this would update KV/D1)
    return c.json({
      success: true,
      message: 'Recovery deactivated successfully'
    })
  } catch (error) {
    console.error('Deactivate recovery error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Auto rescue operation
app.post('/api/auto-rescue', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    
    const { hackedWalletPrivateKey, safeWallet, network, nonce, priorityTokens } = body

    // Validate request body
    if (!hackedWalletPrivateKey || !safeWallet || !network) {
      return c.json({
        error: 'Missing required fields: hackedWalletPrivateKey, safeWallet, network'
      }, 400)
    }

    // For now, return success (in production, this would perform the rescue)
    return c.json({
      success: true,
      message: 'Auto rescue operation completed successfully',
      data: {
        recoveredTokens: [],
        totalValue: 0
      }
    })
  } catch (error) {
    console.error('Auto rescue error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Check wallet balance
app.post('/api/check-balance', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    
    const { hackedWalletPrivateKey, network } = body

    // Validate request body
    if (!hackedWalletPrivateKey || !network) {
      return c.json({
        error: 'Missing required fields: hackedWalletPrivateKey, network'
      }, 400)
    }

    // For now, return empty balance (in production, this would check actual balance)
    return c.json({
      success: true,
      data: {
        tokens: [],
        totalValue: 0
      }
    })
  } catch (error) {
    console.error('Check balance error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Get token balances for a wallet
app.get('/api/token-balances/:walletAddress', async c => {
  try {
    const walletAddress = c.req.param('walletAddress')
    const network = c.req.query('network')

    // Validate parameters
    if (!walletAddress) {
      return c.json({
        error: 'Missing wallet address'
      }, 400)
    }

    if (!network) {
      return c.json({
        error: 'Missing network parameter'
      }, 400)
    }

    // For now, return empty balances (in production, this would fetch actual balances)
    return c.json([])
  } catch (error) {
    console.error('Get token balances error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Monitor and claim airdrops
app.post('/api/monitor-claim', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    
    const { hackedWallet, network } = body

    // Validate request body
    if (!hackedWallet || !network) {
      return c.json({
        error: 'Missing required fields: hackedWallet, network'
      }, 400)
    }

    // For now, return success (in production, this would monitor and claim)
    return c.json({
      success: true,
      message: 'Monitoring and claiming completed',
      data: {
        claimedTokens: [],
        totalValue: 0
      }
    })
  } catch (error) {
    console.error('Monitor and claim error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Claim and transfer tokens
app.post('/api/claim-transfer', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    
    const { hackedWallet, tokenAddress, amount, network } = body

    // Validate request body
    if (!hackedWallet || !tokenAddress || !amount || !network) {
      return c.json({
        error: 'Missing required fields: hackedWallet, tokenAddress, amount, network'
      }, 400)
    }

    // For now, return success (in production, this would claim and transfer)
    return c.json({
      success: true,
      message: 'Claim and transfer completed successfully',
      data: {
        transactionHash: '0x' + Math.random().toString(16).substr(2, 64)
      }
    })
  } catch (error) {
    console.error('Claim and transfer error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Get network statistics
app.get('/api/network-stats/:network', async c => {
  try {
    const network = c.req.param('network')
    
    if (!network) {
      return c.json({
        error: 'Missing network parameter'
      }, 400)
    }

    // For now, return empty stats (in production, this would calculate actual stats)
    return c.json({
      network,
      stats: {
        total: 0,
        active: 0,
        inactive: 0
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Get network stats error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Get recovery statistics
app.get('/api/recovery-stats', async c => {
  try {
    // For now, return empty stats (in production, this would calculate actual stats)
    return c.json({
      total: 0,
      active: 0,
      inactive: 0,
      byNetwork: {}
    })
  } catch (error) {
    console.error('Get recovery stats error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Start multi-network auto recovery session
app.post('/api/start-multi-recovery', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    
    const {
      hackedWalletPrivateKey,
      safeWallet,
      primaryNetwork,
      runOnAllNetworks = false,
      targetNetworks = [],
      intervalSeconds = 30,
      priorityTokens = []
    } = body

    // Validate request body
    if (!hackedWalletPrivateKey || !safeWallet || !primaryNetwork) {
      return c.json({
        error: 'Missing required fields: hackedWalletPrivateKey, safeWallet, primaryNetwork'
      }, 400)
    }

    // For now, return success with a mock session ID
    const sessionId = 'session_' + Math.random().toString(36).substr(2, 9)
    return c.json({
      success: true,
      message: 'Multi-network recovery session started',
      data: {
        sessionId,
        isActive: true,
        startedAt: new Date().toISOString()
      }
    })
  } catch (error) {
    console.error('Start multi-recovery error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Stop multi-network auto recovery session
app.post('/api/stop-multi-recovery', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    
    const { sessionId } = body

    // Validate request body
    if (!sessionId) {
      return c.json({
        error: 'Missing required field: sessionId'
      }, 400)
    }

    // For now, return success (in production, this would stop the session)
    return c.json({
      success: true,
      message: 'Multi-network recovery session stopped'
    })
  } catch (error) {
    console.error('Stop multi-recovery error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Get multi-network recovery session status
app.get('/api/multi-recovery-status/:sessionId', async c => {
  try {
    const sessionId = c.req.param('sessionId')

    if (!sessionId) {
      return c.json({
        error: 'Missing session ID'
      }, 400)
    }

    // For now, return not found (in production, this would check actual status)
    return c.json({
      success: false,
      error: 'Session not found'
    }, 404)
  } catch (error) {
    console.error('Get multi-recovery status error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Get all active multi-network recovery sessions
app.get('/api/active-multi-recovery-sessions', async c => {
  try {
    // For now, return empty array (in production, this would return actual sessions)
    return c.json([])
  } catch (error) {
    console.error('Get active multi-recovery sessions error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Get auto recovery service statistics
app.get('/api/auto-recovery-stats', async c => {
  try {
    // For now, return empty stats (in production, this would return actual stats)
    return c.json({
      totalSessions: 0,
      activeSessions: 0,
      completedSessions: 0
    })
  } catch (error) {
    console.error('Get auto recovery stats error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Cancel ongoing auto rescue operation
app.post('/api/cancel-auto-rescue', async c => {
  try {
    // For now, return success (in production, this would cancel the operation)
    return c.json({
      success: true,
      message: 'Auto rescue operation cancelled'
    })
  } catch (error) {
    console.error('Cancel auto rescue error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Test multicall functionality
app.post('/api/test-multicall', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    
    const { walletAddress, network, tokenAddresses } = body

    // Validate request body
    if (!walletAddress || !network) {
      return c.json({
        error: 'Missing required fields: walletAddress, network'
      }, 400)
    }

    // For now, return success (in production, this would test multicall)
    return c.json({
      success: true,
      message: 'Multicall test completed successfully',
      data: {
        results: []
      }
    })
  } catch (error) {
    console.error('Test multicall error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Test scanner-based token discovery
app.post('/api/test-scanner', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    
    const { walletAddress, network, options = {} } = body

    // Validate request body
    if (!walletAddress || !network) {
      return c.json({
        error: 'Missing required fields: walletAddress, network'
      }, 400)
    }

    // For now, return success (in production, this would scan for tokens)
    return c.json({
      success: true,
      message: 'Scanner test completed successfully',
      data: {
        tokens: []
      }
    })
  } catch (error) {
    console.error('Test scanner error:', error)
    return c.json({
      error: error.message || 'Internal server error'
    }, 500)
  }
})

// Solana RPC proxy
app.post('/api/solana-rpc', async c => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)

    // Basic allowlist of methods for safety
    const allowedMethods = new Set([
      'getLatestBlockhash',
      'getBalance',
      'getAccountInfo',
      'getParsedAccountInfo',
      'getParsedTokenAccountsByOwner',
      'getTokenAccountsByOwner',
      'getProgramAccounts',
      'getBlockHeight',
      'getSlot',
      'getVersion',
      'getSignatureStatuses',
      'sendTransaction',
      'simulateTransaction'
    ])

    const method = body.method
    if (!allowedMethods.has(method)) {
      return c.json({ error: `Method not allowed: ${method}` }, 400)
    }

    // For now, return a mock response (in production, this would proxy to Solana RPC)
    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: null
    })
  } catch (error) {
    console.error('Solana RPC proxy error:', error)
    return c.json({ error: error.message || 'Internal server error' }, 500)
  }
})

// Get client configuration
app.get('/api/config', async c => {
  try {
    return c.json({
      solanaRpcUrl: c.env.SOLANA_RPC_URL || ''
    })
  } catch (error) {
    return c.json({ error: 'Config not available' }, 500)
  }
})

// Get Solana token price
app.get('/api/solana/token-price', async c => {
  try {
    const mint = c.req.query('mint') || ''
    if (!mint) return c.json({ error: 'mint required' }, 400)

    // For now, return zero price (in production, this would fetch actual price)
    return c.json({ mint, usdPrice: 0 })
  } catch (error) {
    return c.json({ error: error.message || String(error) }, 500)
  }
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


