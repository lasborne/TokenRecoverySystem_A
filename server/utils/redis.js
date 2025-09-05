const { createClient } = require('redis');

let redisClient = null;
let isConnecting = false;

const getRedisClient = async () => {
  try {
    if (!process.env.REDIS_URL) {
      return null;
    }

    if (redisClient && redisClient.isOpen) {
      return redisClient;
    }

    if (!isConnecting) {
      isConnecting = true;
      redisClient = createClient({ url: process.env.REDIS_URL });
      redisClient.on('error', (err) => {
        console.error('Redis Client Error:', err.message);
      });
      await redisClient.connect();
      isConnecting = false;
    }

    return redisClient;
  } catch (err) {
    console.warn('Redis unavailable, continuing without it:', err.message);
    return null;
  }
};

const randomId = () => `lock_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const acquireLock = async (key, ttlMs = 20000) => {
  const client = await getRedisClient();
  if (!client) return { acquired: true, client: null, token: null }; // No redis, pretend lock acquired
  const token = randomId();
  const ok = await client.set(key, token, { NX: true, PX: ttlMs });
  return { acquired: ok === 'OK', client, token };
};

const releaseLock = async (key, token) => {
  try {
    const client = await getRedisClient();
    if (!client || !token) return;
    // Release only if token matches (avoid deleting someone else's lock)
    const lua = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
    await client.eval(lua, { keys: [key], arguments: [token] });
  } catch (_) {}
};

const withLock = async (key, ttlMs, fn) => {
  const { acquired, token } = await acquireLock(key, ttlMs);
  if (!acquired) {
    return { success: false, skipped: true, message: 'Another instance is running' };
  }
  try {
    const result = await fn();
    return result;
  } finally {
    await releaseLock(key, token);
  }
};

module.exports = {
  getRedisClient,
  withLock,
  acquireLock,
  releaseLock
};


