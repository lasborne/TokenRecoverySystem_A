const axios = require('axios');

// Simple in-memory cache with TTL
const cache = new Map(); // key -> { value, expiresAt }

const NETWORK_TO_MORALIS = {
  mainnet: 'eth',
  goerli: 'goerli',
  polygon: 'polygon',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  base: 'base',
  linea: 'linea'
};

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlMs = 5 * 60 * 1000) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function getTokenPriceUSD(network, tokenAddress) {
  try {
    const chain = NETWORK_TO_MORALIS[network] || 'eth';
    const key = `price:${chain}:${tokenAddress.toLowerCase()}`;
    const cached = getCache(key);
    if (cached !== null && cached !== undefined) return cached;

    const apiKey = process.env.MORALIS_API_KEY;
    if (!apiKey) return 0; // No API key, skip pricing

    const url = `https://deep-index.moralis.io/api/v2/erc20/${tokenAddress}/price?chain=${chain}`;
    const resp = await axios.get(url, {
      headers: { 'X-API-Key': apiKey }
    });
    const usd = Number(resp.data?.usdPrice || 0);
    if (!Number.isFinite(usd)) return 0;
    setCache(key, usd);
    return usd;
  } catch (err) {
    return 0; // Non-blocking
  }
}

async function getNativePriceUSD(network) {
  try {
    const chain = NETWORK_TO_MORALIS[network] || 'eth';
    const key = `native:${chain}`;
    const cached = getCache(key);
    if (cached !== null && cached !== undefined) return cached;

    const apiKey = process.env.MORALIS_API_KEY;
    if (!apiKey) return 0;

    const url = `https://deep-index.moralis.io/api/v2/erc20/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/price?chain=${chain}`;
    const resp = await axios.get(url, {
      headers: { 'X-API-Key': apiKey }
    });
    const usd = Number(resp.data?.usdPrice || 0);
    if (!Number.isFinite(usd)) return 0;
    setCache(key, usd);
    return usd;
  } catch (err) {
    return 0;
  }
}

module.exports = {
  getTokenPriceUSD,
  getNativePriceUSD
}; 