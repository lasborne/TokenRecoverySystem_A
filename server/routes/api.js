/**
 * API routes for the recovery system
 * Centralized route handling with proper error management and validation
 */

const express = require('express');
const RecoveryService = require('../services/recoveryService.js');
const AutoRecoveryService = require('../services/autoRecoveryService.js');
const { validateRecoveryForm, validateAutoRescueForm } = require('../utils/validation.js');

const router = express.Router();
const recoveryService = new RecoveryService();
const autoRecoveryService = new AutoRecoveryService();
const fetch = require('node-fetch');

/**
 * Health check endpoint
 * GET /api/health
 */
router.get('/health', (req, res) => {
  try {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0'
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      error: 'Health check failed'
    });
  }
});

/**
 * Client configuration endpoint (exposes safe, non-secret public config only)
 */
router.get('/config', (req, res) => {
  try {
    res.json({
      solanaRpcUrl: process.env.SOLANA_RPC_URL || process.env.REACT_APP_SOLANA_RPC_URL || ''
    });
  } catch (error) {
    res.status(500).json({ error: 'Config not available' });
  }
});

/**
 * Solana token price by mint
 * GET /api/solana/token-price?mint=...
 */
router.get('/solana/token-price', async (req, res) => {
  try {
    const mint = (req.query.mint || '').trim();
    if (!mint) return res.status(400).json({ error: 'mint required' });

    const apiKey = process.env.MORALIS_API_KEY;
    let usdPrice = 0;

    if (apiKey) {
      const url = `https://deep-index.moralis.io/api/v2.2/solana/token/${mint}/price?chain=mainnet`;
      const r = await fetch(url, { headers: { 'X-API-Key': apiKey } });
      if (r.ok) {
        const data = await r.json();
        if (typeof data?.usdPrice === 'number') usdPrice = data.usdPrice;
      }
    }

    if (!usdPrice) {
      try {
        const r2 = await fetch(`https://price.jup.ag/v4/price?ids=${encodeURIComponent(mint)}`);
        if (r2.ok) {
          const j = await r2.json();
          const p = j?.data?.[mint]?.price;
          if (typeof p === 'number') usdPrice = p;
        }
      } catch (_) {}
    }

    return res.json({ mint, usdPrice });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

/**
 * Multi-recovery status endpoint
 * GET /api/multi-recovery-status/:sessionId
 */
router.get('/multi-recovery-status/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({
        error: 'Session ID is required'
      });
    }

    const session = autoRecoveryService.getActiveRecoverySessions().get(sessionId);
    
    res.json({
      active: !!session && session.isActive,
      sessionId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Multi-recovery status error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Register a new recovery
 * POST /api/register-recovery
 */
router.post('/register-recovery', async (req, res) => {
  try {
    const { hackedWallet, safeWallet, network, nonce } = req.body;

    // Validate request body
    if (!hackedWallet || !safeWallet || !network) {
      return res.status(400).json({
        error: 'Missing required fields: hackedWallet, safeWallet, network'
      });
    }

    const result = await recoveryService.registerRecovery({
      hackedWallet,
      safeWallet,
      network,
      nonce
    });

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Register recovery error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get all active recoveries
 * GET /api/active-recoveries
 */
router.get('/active-recoveries', (req, res) => {
  try {
    const recoveries = recoveryService.getActiveRecoveries();
    res.json(recoveries);
  } catch (error) {
    console.error('Get active recoveries error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Deactivate a recovery
 * POST /api/deactivate-recovery
 */
router.post('/deactivate-recovery', async (req, res) => {
  try {
    const { hackedWallet, network } = req.body;

    // Validate request body
    if (!hackedWallet || !network) {
      return res.status(400).json({
        error: 'Missing required fields: hackedWallet, network'
      });
    }

    const result = await recoveryService.deactivateRecovery(hackedWallet, network);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Deactivate recovery error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get recovery status
 * GET /api/recovery-status/:hackedWallet
 */
router.get('/recovery-status/:hackedWallet', (req, res) => {
  try {
    const { hackedWallet } = req.params;
    
    if (!hackedWallet) {
      return res.status(400).json({
        error: 'Missing hacked wallet address'
      });
    }

    const status = recoveryService.getRecoveryStatus(hackedWallet);
    
    if (status) {
      res.json(status);
    } else {
      res.status(404).json({
        error: 'Recovery not found'
      });
    }
  } catch (error) {
    console.error('Get recovery status error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Perform auto rescue operation
 * POST /api/auto-rescue
 */
router.post('/auto-rescue', async (req, res) => {
  try {
    const { hackedWalletPrivateKey, safeWallet, network, nonce, priorityTokens } = req.body;

    // Validate request body
    if (!hackedWalletPrivateKey || !safeWallet || !network) {
      return res.status(400).json({
        error: 'Missing required fields: hackedWalletPrivateKey, safeWallet, network'
      });
    }

    const result = await recoveryService.performAutoRescue({
      hackedWalletPrivateKey,
      safeWallet,
      network,
      nonce,
      priorityTokens: priorityTokens || []
    });

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Auto rescue error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Check wallet balance
 * POST /api/check-balance
 */
router.post('/check-balance', async (req, res) => {
  try {
    const { hackedWalletPrivateKey, network } = req.body;

    // Validate request body
    if (!hackedWalletPrivateKey || !network) {
      return res.status(400).json({
        error: 'Missing required fields: hackedWalletPrivateKey, network'
      });
    }

    const result = await recoveryService.checkBalance({
      hackedWalletPrivateKey,
      network
    });

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Check balance error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get token balances for a wallet
 * GET /api/token-balances/:walletAddress
 */
router.get('/token-balances/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const { network } = req.query;

    // Validate parameters
    if (!walletAddress) {
      return res.status(400).json({
        error: 'Missing wallet address'
      });
    }

    if (!network) {
      return res.status(400).json({
        error: 'Missing network parameter'
      });
    }

    const tokenBalances = await recoveryService.getTokenBalances(walletAddress, network);
    res.json(tokenBalances);
  } catch (error) {
    console.error('Get token balances error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Monitor and claim airdrops
 * POST /api/monitor-claim
 */
router.post('/monitor-claim', async (req, res) => {
  try {
    const { hackedWallet, network } = req.body;

    // Validate request body
    if (!hackedWallet || !network) {
      return res.status(400).json({
        error: 'Missing required fields: hackedWallet, network'
      });
    }

    const result = await recoveryService.monitorAndClaimAirdrops(hackedWallet, network);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Monitor and claim error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Claim and transfer tokens
 * POST /api/claim-transfer
 */
router.post('/claim-transfer', async (req, res) => {
  try {
    const { hackedWallet, tokenAddress, amount, network } = req.body;

    // Validate request body
    if (!hackedWallet || !tokenAddress || !amount || !network) {
      return res.status(400).json({
        error: 'Missing required fields: hackedWallet, tokenAddress, amount, network'
      });
    }

    const result = await recoveryService.claimAndTransfer({
      hackedWallet,
      tokenAddress,
      amount,
      network
    });

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Claim and transfer error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get network statistics
 * GET /api/network-stats/:network
 */
router.get('/network-stats/:network', (req, res) => {
  try {
    const { network } = req.params;
    
    if (!network) {
      return res.status(400).json({
        error: 'Missing network parameter'
      });
    }

    const stats = recoveryService.getStats();
    const networkStats = stats.byNetwork[network] || {
      total: 0,
      active: 0,
      inactive: 0
    };

    res.json({
      network,
      stats: networkStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get network stats error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Test multicall functionality
 * POST /api/test-multicall
 */
router.post('/test-multicall', async (req, res) => {
  try {
    const { walletAddress, network, tokenAddresses } = req.body;

    // Validate request body
    if (!walletAddress || !network) {
      return res.status(400).json({
        error: 'Missing required fields: walletAddress, network'
      });
    }

    const result = await recoveryService.testMulticallFunctionality(walletAddress, network, tokenAddresses);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Test multicall error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get system status
 * GET /api/system-status
 */
router.get('/system-status', (req, res) => {
  try {
    const stats = recoveryService.getStats();
    
    res.json({
      status: 'operational',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      stats,
      memory: process.memoryUsage(),
      platform: process.platform,
      nodeVersion: process.version
    });
  } catch (error) {
    console.error('Get system status error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get recovery statistics
 * GET /api/recovery-stats
 */
router.get('/recovery-stats', (req, res) => {
  try {
    const stats = recoveryService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Get recovery stats error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Start multi-network auto recovery session
 * POST /api/start-multi-recovery
 */
router.post('/start-multi-recovery', async (req, res) => {
  try {
    const {
      hackedWalletPrivateKey,
      safeWallet,
      primaryNetwork,
      runOnAllNetworks = false,
      targetNetworks = [],
      intervalSeconds = 30,
      priorityTokens = []
    } = req.body;

    // Validate request body
    if (!hackedWalletPrivateKey || !safeWallet || !primaryNetwork) {
      return res.status(400).json({
        error: 'Missing required fields: hackedWalletPrivateKey, safeWallet, primaryNetwork'
      });
    }

    const result = await autoRecoveryService.startMultiNetworkRecovery({
      hackedWalletPrivateKey,
      safeWallet,
      primaryNetwork,
      runOnAllNetworks,
      targetNetworks,
      intervalSeconds,
      priorityTokens
    });

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Start multi-recovery error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Stop multi-network auto recovery session
 * POST /api/stop-multi-recovery
 */
router.post('/stop-multi-recovery', async (req, res) => {
  try {
    const { sessionId } = req.body;

    // Validate request body
    if (!sessionId) {
      return res.status(400).json({
        error: 'Missing required field: sessionId'
      });
    }

    const result = autoRecoveryService.stopRecoverySession(sessionId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Stop multi-recovery error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get multi-network recovery session status
 * GET /api/multi-recovery-status/:sessionId
 */
router.get('/multi-recovery-status/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        error: 'Missing session ID'
      });
    }

    const result = autoRecoveryService.getSessionStatus(sessionId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Get multi-recovery status error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get all active multi-network recovery sessions
 * GET /api/active-multi-recovery-sessions
 */
router.get('/active-multi-recovery-sessions', (req, res) => {
  try {
    const result = autoRecoveryService.getAllActiveSessions();
    res.json(result);
  } catch (error) {
    console.error('Get active multi-recovery sessions error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get auto recovery service statistics
 * GET /api/auto-recovery-stats
 */
router.get('/auto-recovery-stats', (req, res) => {
  try {
    const result = autoRecoveryService.getStats();
    res.json(result);
  } catch (error) {
    console.error('Get auto recovery stats error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Cancel ongoing auto rescue operation
 * POST /api/cancel-auto-rescue
 */
router.post('/cancel-auto-rescue', async (req, res) => {
  try {
    const result = await recoveryService.cancelAutoRescue();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Cancel auto rescue error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Test scanner-based token discovery
 * POST /api/test-scanner
 */
router.post('/test-scanner', async (req, res) => {
  try {
    const { walletAddress, network, options = {} } = req.body;

    // Validate request body
    if (!walletAddress || !network) {
      return res.status(400).json({
        error: 'Missing required fields: walletAddress, network'
      });
    }

    // Import scanner utilities
    const scannerUtils = require('../utils/scanner');
    
    console.log(`Testing scanner for ${walletAddress} on ${network}`);
    
    // Get optimal block range for the network
    const provider = new (require('ethers')).JsonRpcProvider(require('../config/networks.js').getRpcUrl(network));
    const optimalRange = await scannerUtils.getOptimalBlockRange(network, provider);
    
    // Use scanner to discover all tokens
    const result = await scannerUtils.scanWallet(walletAddress, network, {
      startBlock: optimalRange.start,
      endBlock: null, // Use latest block
      chunkSize: optimalRange.chunkSize,
      ...options
    });

    if (result.success) {
      res.json({
        success: true,
        message: `Scanner completed successfully`,
        data: result
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Scanner failed',
        data: result
      });
    }
  } catch (error) {
    console.error('Test scanner error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Save tokens to server for future recovery operations
 * POST /api/save-tokens
 */
router.post('/save-tokens', async (req, res) => {
  try {
    const { tokens, network } = req.body;

    // Validate request body
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid tokens array'
      });
    }

    if (!network) {
      return res.status(400).json({
        error: 'Missing network parameter'
      });
    }

    // Validate each token
    for (const token of tokens) {
      if (!token.address || !token.symbol || !token.network) {
        return res.status(400).json({
          error: 'Invalid token data: missing address, symbol, or network'
        });
      }
    }

    // Save tokens to server storage (in production, use a database)
    const savedTokens = require('../services/tokenStorageService.js');
    const result = await savedTokens.saveTokens(tokens, network);

    if (result.success) {
      res.json({
        success: true,
        message: `Successfully saved ${tokens.length} tokens for ${network}`,
        data: result
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to save tokens'
      });
    }
  } catch (error) {
    console.error('Save tokens error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get saved tokens from server
 * GET /api/saved-tokens
 */
router.get('/saved-tokens', async (req, res) => {
  try {
    const { network } = req.query;

    // Get saved tokens from server storage
    const savedTokens = require('../services/tokenStorageService.js');
    const result = await savedTokens.getSavedTokens(network);

    if (result.success) {
      res.json({
        success: true,
        tokens: result.tokens,
        message: `Retrieved ${result.tokens.length} saved tokens${network ? ` for ${network}` : ''}`
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to retrieve saved tokens'
      });
    }
  } catch (error) {
    console.error('Get saved tokens error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Delete saved tokens
 * DELETE /api/saved-tokens
 */
router.delete('/saved-tokens', async (req, res) => {
  try {
    const { network, tokenAddress } = req.body;

    if (!network) {
      return res.status(400).json({
        error: 'Missing network parameter'
      });
    }

    // Delete saved tokens from server storage
    const savedTokens = require('../services/tokenStorageService.js');
    const result = await savedTokens.deleteSavedTokens(network, tokenAddress);

    if (result.success) {
      res.json({
        success: true,
        message: result.message || 'Tokens deleted successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to delete tokens'
      });
    }
  } catch (error) {
    console.error('Delete saved tokens error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Lightweight Solana RPC proxy
 * POST /api/solana-rpc
 * Forwards JSON-RPC payloads to an upstream RPC to avoid browser-origin 403s
 */
router.post('/solana-rpc', async (req, res) => {
  try {
    const upstreamCandidates = [];
    if (process.env.REACT_APP_SOLANA_RPC_URL) upstreamCandidates.push(process.env.REACT_APP_SOLANA_RPC_URL);
    if (process.env.SOLANA_RPC_URL) upstreamCandidates.push(process.env.SOLANA_RPC_URL);
    upstreamCandidates.push('https://api.mainnet-beta.solana.com');
    upstreamCandidates.push('https://rpc.ankr.com/solana');

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
    ]);

    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON-RPC payload' });
    }
    const method = payload.method;
    if (!allowedMethods.has(method)) {
      return res.status(400).json({ error: `Method not allowed: ${method}` });
    }

    let lastError = null;
    for (const url of upstreamCandidates) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!r.ok) {
          lastError = new Error(`Upstream ${url} responded ${r.status}`);
          continue;
        }
        const data = await r.json();
        return res.json(data);
      } catch (e) {
        lastError = e;
        continue;
      }
    }
    return res.status(502).json({ error: lastError?.message || 'All upstream RPCs failed' });
  } catch (error) {
    console.error('Solana RPC proxy error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Error handling middleware for API routes
 */
router.use((error, req, res, next) => {
  console.error('API Error:', error);
  
  // Handle specific error types
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.message
    });
  }
  
  if (error.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }
  
  // Default error response
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

module.exports = router; 