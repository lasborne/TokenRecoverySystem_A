const keyFor = (network, address) => `tokens:${network}:${address.toLowerCase()}`

export const tokenStorageKV = (kv) => ({
  async saveTokens(tokens, network) {
    try {
      const ops = tokens.map(t => kv.put(
        keyFor(network, t.address),
        JSON.stringify({
          address: (t.address || '').toLowerCase(),
          symbol: t.symbol || 'UNKNOWN',
          name: t.name || 'Unknown Token',
          network,
          decimals: Number(t.decimals || 18),
          isHighPriority: !!t.isHighPriority,
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString()
        })
      ))
      await Promise.all(ops)
      return { success: true, message: `Saved ${tokens.length} tokens` }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  async getSavedTokens(network = null) {
    try {
      const list = await kv.list({ prefix: network ? `tokens:${network}:` : 'tokens:' })
      const items = await Promise.all((list.keys || []).map(k => kv.get(k.name, 'json')))
      const tokens = (items || []).filter(Boolean)
      return { success: true, tokens, count: tokens.length }
    } catch (e) {
      return { success: false, error: e.message, tokens: [] }
    }
  },

  async deleteSavedTokens(network, tokenAddress = null) {
    try {
      if (tokenAddress) {
        await kv.delete(keyFor(network, tokenAddress))
        return { success: true, message: `Deleted 1 token for ${tokenAddress}` }
      }
      const list = await kv.list({ prefix: `tokens:${network}:` })
      await Promise.all((list.keys || []).map(k => kv.delete(k.name)))
      return { success: true, message: `Deleted ${list.keys?.length || 0} tokens for ${network}` }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
})


