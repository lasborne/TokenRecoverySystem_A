/**
 * Enhanced Auto Recovery Service
 * Handles multi-network auto recovery with continuous monitoring
 * Supports automatic token detection via Moralis and user-controlled operations
 */

const RecoveryService = require('./recoveryService.js');
const { getAllNetworks } = require('../config/networks.js');
const { ethers } = require('ethers');

class AutoRecoveryService {
  constructor() {
    this.recoveryService = new RecoveryService();
    this.activeRecoverySessions = new Map(); // Track active recovery sessions
    // Normalize networks: keep both map and id list for robust validation
    this.networkMap = getAllNetworks(); // { id -> config }
    this.networkIds = Object.keys(this.networkMap); // ['mainnet', 'optimism', ...]
  }

  /**
   * Start a multi-network auto recovery session
   * @param {Object} sessionData - Session configuration
   * @param {string} sessionData.hackedWalletPrivateKey - Private key of hacked wallet
   * @param {string} sessionData.safeWallet - Safe wallet address
   * @param {string} sessionData.primaryNetwork - Primary network to start with
   * @param {boolean} sessionData.runOnAllNetworks - Whether to run on all networks
   * @param {Array} sessionData.targetNetworks - Specific networks to target (if not all)
   * @param {number} sessionData.intervalSeconds - Interval between recovery attempts (default: 30)
   * @returns {Object} Session result
   */
  async startMultiNetworkRecovery(sessionData) {
    try {
      const {
        hackedWalletPrivateKey,
        safeWallet,
        primaryNetwork,
        runOnAllNetworks = false,
        targetNetworks = [],
        intervalSeconds = 30,
        priorityTokens = []
      } = sessionData;

      // Validate inputs
      if (!hackedWalletPrivateKey || !safeWallet || !primaryNetwork) {
        return {
          success: false,
          error: 'Missing required fields: hackedWalletPrivateKey, safeWallet, primaryNetwork'
        };
      }

      // Generate session ID
      const sessionId = this.generateSessionId();
      
      // Determine target networks (use network IDs consistently)
      let networksToProcess = [];
      if (runOnAllNetworks) {
        networksToProcess = [...this.networkIds];
      } else if (Array.isArray(targetNetworks) && targetNetworks.length > 0) {
        networksToProcess = targetNetworks;
      } else {
        networksToProcess = [primaryNetwork];
      }

      // Remove duplicates and validate against known IDs
      networksToProcess = [...new Set(networksToProcess)].filter((networkId) =>
        this.networkIds.includes(networkId)
      );

      if (networksToProcess.length === 0) {
        return {
          success: false,
          error: 'No valid networks specified for recovery'
        };
      }

      // Create session object
      const session = {
        id: sessionId,
        hackedWalletPrivateKey,
        safeWallet,
        networks: networksToProcess,
        primaryNetwork,
        intervalSeconds,
        priorityTokens,
        isActive: true,
        startTime: new Date(),
        lastRun: null,
        results: [],
        currentNetworkIndex: 0,
        totalRecoveries: 0,
        successfulRecoveries: 0,
        failedRecoveries: 0
      };

      // Store session
      this.activeRecoverySessions.set(sessionId, session);

      // Start the recovery process
      this.startRecoveryLoop(sessionId);

      return {
        success: true,
        sessionId,
        message: `Multi-network auto recovery started on ${networksToProcess.length} networks`,
        networks: networksToProcess,
        intervalSeconds
      };

    } catch (error) {
      console.error('Start multi-network recovery error:', error);
      return {
        success: false,
        error: error.message || 'Failed to start multi-network recovery'
      };
    }
  }

  /**
   * Start the continuous recovery loop for a session
   * @param {string} sessionId - Session ID
   */
  async startRecoveryLoop(sessionId) {
    const session = this.activeRecoverySessions.get(sessionId);
    if (!session || !session.isActive) return;

    try {
      console.log(`Starting recovery loop for session ${sessionId} on ${session.networks.length} networks`);

      // Process all networks in sequence
      for (let i = 0; i < session.networks.length; i++) {
        if (!session.isActive) break; // Check if session was stopped

        const network = session.networks[i];
        session.currentNetworkIndex = i;

        console.log(`Processing network ${network} (${i + 1}/${session.networks.length}) for session ${sessionId}`);

        try {
          // Perform auto rescue on this network
          let result;
          try {
            result = await this.recoveryService.performAutoRescue({
              hackedWalletPrivateKey: session.hackedWalletPrivateKey,
              safeWallet: session.safeWallet,
              network,
              nonce: '', // Let the service determine nonce
              priorityTokens: session.priorityTokens || []
            });
          } catch (autoRescueError) {
            console.error(`Auto rescue error: ${autoRescueError.message}`);
            result = {
              success: false,
              error: `auto rescue failed: ${autoRescueError.message}`,
              message: `auto rescue failed: ${autoRescueError.message}`
            };
          }

          // Record result
          const recoveryResult = {
            network,
            timestamp: new Date(),
            success: result.success,
            message: result.message || result.error || 'Unknown result',
            tokensFound: result.data?.tokensFound || 0,
            tokensTransferred: result.data?.tokensTransferred || 0,
            error: result.error || null
          };

          session.results.push(recoveryResult);
          session.totalRecoveries++;

          if (result.success) {
            session.successfulRecoveries++;
            console.log(`✅ Recovery successful on ${network}: ${result.message}`);
          } else {
            session.failedRecoveries++;
            console.log(`❌ Recovery failed on ${network}: ${result.error || result.message}`);
          }

        } catch (networkError) {
          console.error(`Error processing network ${network}:`, networkError);
          
          const recoveryResult = {
            network,
            timestamp: new Date(),
            success: false,
            message: 'Network processing error',
            tokensFound: 0,
            tokensTransferred: 0,
            error: networkError.message
          };

          session.results.push(recoveryResult);
          session.totalRecoveries++;
          session.failedRecoveries++;
        }

        // Update last run time
        session.lastRun = new Date();

        // Wait before processing next network (if not the last one)
        if (i < session.networks.length - 1 && session.isActive) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between networks
        }
      }

      // If session is still active, schedule next run
      if (session.isActive) {
        const nextRunDelay = (session.intervalSeconds * 1000) - 2000; // Subtract the 2s we already waited
        setTimeout(() => {
          this.startRecoveryLoop(sessionId);
        }, Math.max(0, nextRunDelay));
      }

    } catch (error) {
      console.error(`Recovery loop error for session ${sessionId}:`, error);
      
      // Mark session as failed
      if (session) {
        session.isActive = false;
        session.results.push({
          network: 'ALL',
          timestamp: new Date(),
          success: false,
          message: 'Recovery loop error',
          tokensFound: 0,
          tokensTransferred: 0,
          error: error.message
        });
      }
    }
  }

  /**
   * Stop an active recovery session
   * @param {string} sessionId - Session ID to stop
   * @returns {Object} Stop result
   */
  stopRecoverySession(sessionId) {
    try {
      const session = this.activeRecoverySessions.get(sessionId);
      
      if (!session) {
        return {
          success: false,
          error: 'Session not found'
        };
      }

      if (!session.isActive) {
        return {
          success: false,
          error: 'Session is already stopped'
        };
      }

      // Stop the session
      session.isActive = false;
      session.endTime = new Date();

      console.log(`Stopped recovery session ${sessionId}`);

      return {
        success: true,
        message: 'Recovery session stopped successfully',
        sessionId,
        summary: {
          totalRecoveries: session.totalRecoveries,
          successfulRecoveries: session.successfulRecoveries,
          failedRecoveries: session.failedRecoveries,
          duration: session.endTime - session.startTime
        }
      };

    } catch (error) {
      console.error('Stop recovery session error:', error);
      return {
        success: false,
        error: error.message || 'Failed to stop recovery session'
      };
    }
  }

  /**
   * Get session status and results
   * @param {string} sessionId - Session ID
   * @returns {Object} Session status
   */
  getSessionStatus(sessionId) {
    try {
      const session = this.activeRecoverySessions.get(sessionId);
      
      if (!session) {
        return {
          success: false,
          error: 'Session not found'
        };
      }

      return {
        success: true,
        session: {
          id: session.id,
          isActive: session.isActive,
          startTime: session.startTime,
          endTime: session.endTime,
          lastRun: session.lastRun,
          networks: session.networks,
          primaryNetwork: session.primaryNetwork,
          currentNetworkIndex: session.currentNetworkIndex,
          intervalSeconds: session.intervalSeconds,
          totalRecoveries: session.totalRecoveries,
          successfulRecoveries: session.successfulRecoveries,
          failedRecoveries: session.failedRecoveries,
          results: session.results
        }
      };

    } catch (error) {
      console.error('Get session status error:', error);
      return {
        success: false,
        error: error.message || 'Failed to get session status'
      };
    }
  }

  /**
   * Get all active sessions
   * @returns {Object} All active sessions
   */
  getAllActiveSessions() {
    try {
      const activeSessions = [];
      
      for (const [sessionId, session] of this.activeRecoverySessions) {
        if (session.isActive) {
          activeSessions.push({
            id: sessionId,
            startTime: session.startTime,
            networks: session.networks,
            primaryNetwork: session.primaryNetwork,
            totalRecoveries: session.totalRecoveries,
            successfulRecoveries: session.successfulRecoveries,
            failedRecoveries: session.failedRecoveries
          });
        }
      }

      return {
        success: true,
        sessions: activeSessions,
        count: activeSessions.length
      };

    } catch (error) {
      console.error('Get all active sessions error:', error);
      return {
        success: false,
        error: error.message || 'Failed to get active sessions'
      };
    }
  }

  /**
   * Clean up completed sessions (older than 24 hours)
   */
  cleanupOldSessions() {
    try {
      const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      let cleanedCount = 0;

      for (const [sessionId, session] of this.activeRecoverySessions) {
        if (!session.isActive && session.endTime && session.endTime < cutoffTime) {
          this.activeRecoverySessions.delete(sessionId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`Cleaned up ${cleanedCount} old recovery sessions`);
      }

    } catch (error) {
      console.error('Cleanup old sessions error:', error);
    }
  }

  /**
   * Generate unique session ID
   * @returns {string} Unique session ID
   */
  generateSessionId() {
    return `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get active recovery sessions map
   * @returns {Map} Map of active recovery sessions
   */
  getActiveRecoverySessions() {
    return this.activeRecoverySessions;
  }

  /**
   * Get service statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    try {
      const totalSessions = this.activeRecoverySessions.size;
      const activeSessions = Array.from(this.activeRecoverySessions.values()).filter(s => s.isActive).length;
      
      let totalRecoveries = 0;
      let totalSuccessfulRecoveries = 0;
      let totalFailedRecoveries = 0;

      for (const session of this.activeRecoverySessions.values()) {
        totalRecoveries += session.totalRecoveries;
        totalSuccessfulRecoveries += session.successfulRecoveries;
        totalFailedRecoveries += session.failedRecoveries;
      }

      return {
        success: true,
        stats: {
          totalSessions,
          activeSessions,
          totalRecoveries,
          totalSuccessfulRecoveries,
          totalFailedRecoveries,
          successRate: totalRecoveries > 0 ? (totalSuccessfulRecoveries / totalRecoveries * 100).toFixed(2) : 0
        }
      };

    } catch (error) {
      console.error('Get stats error:', error);
      return {
        success: false,
        error: error.message || 'Failed to get statistics'
      };
    }
  }
}

module.exports = AutoRecoveryService;
