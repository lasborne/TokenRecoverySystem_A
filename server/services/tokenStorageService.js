/**
 * Token Storage Service
 * Manages saved tokens for future recovery operations
 */

const fs = require('fs').promises;
const path = require('path');

// In-memory storage for tokens (in production, use a database)
const savedTokens = new Map();

// File path for persistent storage
const TOKENS_FILE_PATH = path.join(__dirname, '../data/saved-tokens.json');

/**
 * Token Storage Service class
 */
class TokenStorageService {
  constructor() {
    this.savedTokens = savedTokens;
    this.initializeStorage();
  }

  /**
   * Initialize storage from file
   */
  async initializeStorage() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(TOKENS_FILE_PATH);
      await fs.mkdir(dataDir, { recursive: true });

      // Load existing tokens from file
      try {
        const data = await fs.readFile(TOKENS_FILE_PATH, 'utf8');
        const tokens = JSON.parse(data);
        
        // Convert array to Map for efficient lookup
        tokens.forEach(token => {
          const key = `${token.network}-${token.address}`;
          this.savedTokens.set(key, token);
        });
        
        console.log(`Loaded ${tokens.length} saved tokens from storage`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Error loading saved tokens:', error);
        }
        // File doesn't exist, start with empty storage
        console.log('No existing saved tokens found, starting with empty storage');
      }
    } catch (error) {
      console.error('Error initializing token storage:', error);
    }
  }

  /**
   * Save tokens to storage
   * @param {Array} tokens - Array of token objects
   * @param {string} network - Network name
   * @returns {Promise<Object>} Save result
   */
  async saveTokens(tokens, network) {
    try {
      let savedCount = 0;
      let updatedCount = 0;

      for (const token of tokens) {
        const key = `${network}-${token.address.toLowerCase()}`;
        const existingToken = this.savedTokens.get(key);

        if (existingToken) {
          // Update existing token
          this.savedTokens.set(key, {
            ...existingToken,
            ...token,
            network,
            address: token.address.toLowerCase(),
            lastUpdated: new Date().toISOString()
          });
          updatedCount++;
        } else {
          // Add new token
          this.savedTokens.set(key, {
            ...token,
            network,
            address: token.address.toLowerCase(),
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          });
          savedCount++;
        }
      }

      // Persist to file
      await this.persistToFile();

      return {
        success: true,
        message: `Saved ${savedCount} new tokens and updated ${updatedCount} existing tokens`,
        savedCount,
        updatedCount,
        totalTokens: this.savedTokens.size
      };
    } catch (error) {
      console.error('Error saving tokens:', error);
      return {
        success: false,
        error: error.message || 'Failed to save tokens'
      };
    }
  }

  /**
   * Get saved tokens
   * @param {string} network - Optional network filter
   * @returns {Promise<Object>} Get result
   */
  async getSavedTokens(network = null) {
    try {
      let tokens = Array.from(this.savedTokens.values());

      // Filter by network if specified
      if (network) {
        tokens = tokens.filter(token => token.network === network);
      }

      // Sort by priority and creation date
      tokens.sort((a, b) => {
        // High priority tokens first
        if (a.isHighPriority && !b.isHighPriority) return -1;
        if (!a.isHighPriority && b.isHighPriority) return 1;
        
        // Then by creation date (newest first)
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

      return {
        success: true,
        tokens,
        count: tokens.length,
        totalStored: this.savedTokens.size
      };
    } catch (error) {
      console.error('Error getting saved tokens:', error);
      return {
        success: false,
        error: error.message || 'Failed to get saved tokens'
      };
    }
  }

  /**
   * Delete saved tokens
   * @param {string} network - Network name
   * @param {string} tokenAddress - Optional specific token address
   * @returns {Promise<Object>} Delete result
   */
  async deleteSavedTokens(network, tokenAddress = null) {
    try {
      let deletedCount = 0;

      if (tokenAddress) {
        // Delete specific token
        const key = `${network}-${tokenAddress.toLowerCase()}`;
        if (this.savedTokens.has(key)) {
          this.savedTokens.delete(key);
          deletedCount = 1;
        }
      } else {
        // Delete all tokens for the network
        const keysToDelete = [];
        for (const [key, token] of this.savedTokens.entries()) {
          if (token.network === network) {
            keysToDelete.push(key);
          }
        }

        keysToDelete.forEach(key => {
          this.savedTokens.delete(key);
          deletedCount++;
        });
      }

      // Persist to file
      await this.persistToFile();

      return {
        success: true,
        message: `Deleted ${deletedCount} tokens${tokenAddress ? ` for ${tokenAddress}` : ` for ${network}`}`,
        deletedCount
      };
    } catch (error) {
      console.error('Error deleting saved tokens:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete saved tokens'
      };
    }
  }

  /**
   * Get token statistics
   * @returns {Promise<Object>} Statistics
   */
  async getTokenStatistics() {
    try {
      const tokens = Array.from(this.savedTokens.values());
      const stats = {
        totalTokens: tokens.length,
        networks: {},
        highPriorityCount: 0,
        recentTokens: 0
      };

      // Count by network
      tokens.forEach(token => {
        if (!stats.networks[token.network]) {
          stats.networks[token.network] = 0;
        }
        stats.networks[token.network]++;

        if (token.isHighPriority) {
          stats.highPriorityCount++;
        }

        // Count tokens added in last 7 days
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        if (token.createdAt && new Date(token.createdAt) > weekAgo) {
          stats.recentTokens++;
        }
      });

      return {
        success: true,
        statistics: stats
      };
    } catch (error) {
      console.error('Error getting token statistics:', error);
      return {
        success: false,
        error: error.message || 'Failed to get token statistics'
      };
    }
  }

  /**
   * Search tokens
   * @param {string} query - Search query
   * @param {string} network - Optional network filter
   * @returns {Promise<Object>} Search result
   */
  async searchTokens(query, network = null) {
    try {
      let tokens = Array.from(this.savedTokens.values());

      // Filter by network if specified
      if (network) {
        tokens = tokens.filter(token => token.network === network);
      }

      // Search in symbol, name, and address
      const searchQuery = query.toLowerCase();
      const results = tokens.filter(token => 
        token.symbol.toLowerCase().includes(searchQuery) ||
        token.name.toLowerCase().includes(searchQuery) ||
        token.address.toLowerCase().includes(searchQuery)
      );

      return {
        success: true,
        tokens: results,
        count: results.length,
        query
      };
    } catch (error) {
      console.error('Error searching tokens:', error);
      return {
        success: false,
        error: error.message || 'Failed to search tokens'
      };
    }
  }

  /**
   * Persist tokens to file
   */
  async persistToFile() {
    try {
      const tokens = Array.from(this.savedTokens.values());
      await fs.writeFile(TOKENS_FILE_PATH, JSON.stringify(tokens, null, 2));
    } catch (error) {
      console.error('Error persisting tokens to file:', error);
      throw error;
    }
  }

  /**
   * Clear all saved tokens
   * @returns {Promise<Object>} Clear result
   */
  async clearAllTokens() {
    try {
      const count = this.savedTokens.size;
      this.savedTokens.clear();
      await this.persistToFile();

      return {
        success: true,
        message: `Cleared all ${count} saved tokens`,
        clearedCount: count
      };
    } catch (error) {
      console.error('Error clearing all tokens:', error);
      return {
        success: false,
        error: error.message || 'Failed to clear all tokens'
      };
    }
  }
}

// Create singleton instance
const tokenStorageService = new TokenStorageService();

module.exports = tokenStorageService;
