/**
 * Recovery service for handling all recovery-related operations
 * Centralized recovery logic with proper error handling and ethers v6 compatibility
 */

const { ethers } = require('ethers');
const { 
  createProvider, 
  createWallet, 
  createContract, 
  getBalance, 
  getTransactionCount,
  getFeeData,
  waitForTransaction,
  formatBalance,
  parseBalance,
  isValidAddress,
  getChecksumAddress,
  createTransactionRequest,
  estimateGas,
  sendTransaction,
  ERC20_ABI,
  getTokenInfo,
  getTokenBalance,
  withRetryTimeout,
  withTimeout,
  handleNetworkError,
  checkTransactionSuccess,
  checkPendingTransaction,
  checkAndApproveToken,
  getDefaultGasLimit,
  DEFAULT_GAS_LIMITS
} = require('../utils/ethers.js');
const { 
  getNetworkConfig, 
  getContractAddress, 
  getRpcUrl,
  getGasPrice 
} = require('../config/networks.js');
const { getTokenPriceUSD, getNativePriceUSD } = require('./pricingService.js');
const { 
  validateRecoveryForm, 
  validateAutoRescueForm,
  getFirstError 
} = require('../utils/validation.js');

// In-memory storage for recoveries (in production, use a database)
const recoveries = new Map();
const recoveryStatuses = new Map();

/**
 * Recovery service class
 */
class RecoveryService {
  constructor() {
    this.recoveries = recoveries;
    this.recoveryStatuses = recoveryStatuses;
    this.activeAutoRescueOperations = new Map(); // Track active auto rescue operations
    this.operationCancellationFlags = new Map(); // Track cancellation flags
  }

  /**
   * Register a new recovery
   * @param {Object} recoveryData - Recovery data
   * @param {string} recoveryData.hackedWallet - Hacked wallet address
   * @param {string} recoveryData.safeWallet - Safe wallet address
   * @param {string} recoveryData.network - Blockchain network
   * @param {number} recoveryData.nonce - Optional nonce override
   * @returns {Promise<Object>} Registration result
   */
  async registerRecovery(recoveryData) {
    try {
      // Validate form data
      const validation = validateRecoveryForm(recoveryData);
      if (!validation.isValid) {
        const firstError = getFirstError(validation.errors);
        throw new Error(firstError || 'Validation failed');
      }

      const { hackedWallet, safeWallet, network, nonce } = recoveryData;

      // Check if recovery already exists and is active
      const recoveryKey = `${hackedWallet}-${network}`;
      if (this.recoveries.has(recoveryKey)) {
        const existingRecovery = this.recoveries.get(recoveryKey);
        if (existingRecovery.isActive) {
        throw new Error('Recovery already exists for this wallet and network');
        } else {
          // If recovery exists but is inactive, delete it to allow re-registration
          console.log(`Found inactive recovery for ${recoveryKey}, removing to allow re-registration`);
          this.recoveries.delete(recoveryKey);
        }
      }

      // Validate network
      const networkConfig = getNetworkConfig(network);
      if (!networkConfig) {
        throw new Error('Unsupported network');
      }

      // Create recovery object
      const recovery = {
        id: recoveryKey,
        hackedWallet: getChecksumAddress(hackedWallet),
        safeWallet: getChecksumAddress(safeWallet),
        network,
        nonce: nonce !== undefined ? Number(nonce) : undefined,
        isActive: true,
        createdAt: new Date().toISOString(),
        lastCheck: new Date().toISOString(),
        recoveredTokens: []
      };

      // Store recovery
      this.recoveries.set(recoveryKey, recovery);
      
      // Initialize recovery status
      if (!this.recoveryStatuses.has(recoveryKey)) {
        this.recoveryStatuses.set(recoveryKey, {
          isActive: true,
          lastCheck: new Date().toISOString(),
          recoveredTokens: []
        });
      }

      console.log(`Recovery registered: ${recoveryKey}`);

      return {
        success: true,
        recovery,
        message: 'Recovery registered successfully'
      };
    } catch (error) {
      console.error('Recovery registration error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Deactivate a recovery
   * @param {string} hackedWallet - Hacked wallet address
   * @param {string} network - Blockchain network (optional, will find by wallet if not provided)
   * @returns {Promise<Object>} Deactivation result
   */
  async deactivateRecovery(hackedWallet, network) {
    try {
      console.log(`Attempting to deactivate recovery for wallet: ${hackedWallet}, network: ${network}`);
      
      // First try the exact key match
      const recoveryKey = `${hackedWallet}-${network}`;
      console.log(`Looking for recovery key: "${recoveryKey}"`);
      
      if (this.recoveries.has(recoveryKey)) {
        const recovery = this.recoveries.get(recoveryKey);
        recovery.isActive = false;
        recovery.deactivatedAt = new Date().toISOString();

        // Update status
        const status = this.recoveryStatuses.get(recoveryKey);
        if (status) {
          status.isActive = false;
        }

        console.log(`Recovery deactivated: ${recoveryKey}`);
        return {
          success: true,
          message: 'Recovery deactivated successfully'
        };
      }
      
      // If exact match fails, try to find by wallet address only
      console.log('Exact key match failed, searching by wallet address...');
      const found = this.findRecoveryByWallet(hackedWallet);
      
      if (found) {
        console.log(`Found recovery with key: "${found.key}", network: "${found.recovery.network}"`);
        
        const recovery = this.recoveries.get(found.key);
        recovery.isActive = false;
        recovery.deactivatedAt = new Date().toISOString();

        // Update status
        const status = this.recoveryStatuses.get(found.key);
        if (status) {
          status.isActive = false;
        }

        console.log(`Recovery deactivated: ${found.key}`);
        return {
          success: true,
          message: 'Recovery deactivated successfully'
        };
      }
      
      // If still not found, log all recoveries for debugging
      console.log('Recovery not found. All existing recoveries:');
      for (const [key, recovery] of this.recoveries.entries()) {
        console.log(`  Key: "${key}", HackedWallet: "${recovery.hackedWallet}", Network: "${recovery.network}"`);
      }
      
      throw new Error('Recovery not found');
    } catch (error) {
      console.error('Recovery deactivation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all active recoveries
   * @returns {Array} List of active recoveries
   */
  getActiveRecoveries() {
    return Array.from(this.recoveries.values()).filter(recovery => recovery.isActive);
  }

  /**
   * Find recovery by hacked wallet address
   * @param {string} hackedWallet - Hacked wallet address
   * @returns {Object|null} Recovery object or null if not found
   */
  findRecoveryByWallet(hackedWallet) {
    for (const [key, recovery] of this.recoveries.entries()) {
      if (recovery.hackedWallet.toLowerCase() === hackedWallet.toLowerCase()) {
        return { recovery, key };
      }
    }
    return null;
  }

  /**
   * Get recovery status
   * @param {string} hackedWallet - Hacked wallet address
   * @returns {Object|null} Recovery status
   */
  getRecoveryStatus(hackedWallet) {
    const found = this.findRecoveryByWallet(hackedWallet);
    if (found) {
      return this.recoveryStatuses.get(found.key) || null;
    }
    return null;
  }

  /**
   * Perform auto rescue operation
   * @param {Object} rescueData - Auto rescue data
   * @param {string} rescueData.hackedWalletPrivateKey - Private key of hacked wallet
   * @param {string} rescueData.safeWallet - Safe wallet address
   * @param {string} rescueData.network - Blockchain network
   * @param {number} rescueData.nonce - Optional nonce override
   * @returns {Promise<Object>} Rescue result
   */
  async performAutoRescue(rescueData) {
    const summary = [];
    const operationId = this.generateOperationId();
    
    try {
      // Track this operation
      this.activeAutoRescueOperations.set(operationId, {
        startTime: new Date(),
        rescueData: { ...rescueData, hackedWalletPrivateKey: '[HIDDEN]' } // Don't store private key
      });

      // Validate form data
      const validation = validateAutoRescueForm(rescueData);
      if (!validation.isValid) {
        const firstError = getFirstError(validation.errors);
        throw new Error(firstError || 'Validation failed');
      }

      const { hackedWalletPrivateKey, safeWallet, network, nonce } = rescueData;

      summary.push('Starting auto rescue operation...');

      // Check for cancellation
      if (this.shouldCancelOperation(operationId)) {
        throw new Error('Operation cancelled by user');
      }

      // Create provider and wallet
      let provider = createProvider(network);
      let wallet = createWallet(hackedWalletPrivateKey, provider);
      const walletAddress = await wallet.getAddress();

      summary.push(`Connected to wallet: ${walletAddress}`);

      // Check if there's an active recovery for this wallet and use its network if different
      const foundRecovery = this.findRecoveryByWallet(walletAddress);
      let effectiveNetwork = network;
      if (foundRecovery && foundRecovery.recovery.network !== network) {
        console.log(`Found active recovery on network: ${foundRecovery.recovery.network}, switching from: ${network}`);
        effectiveNetwork = foundRecovery.recovery.network;
        summary.push(`Switched to recovery network: ${effectiveNetwork}`);
        
        // Recreate provider with correct network
        const recoveryProvider = createProvider(effectiveNetwork);
        const recoveryWallet = createWallet(hackedWalletPrivateKey, recoveryProvider);
        
        // In Ethers.js v6, we need to create new instances instead of assigning
        // Update references to use the new wallet and provider
        wallet = recoveryWallet;
        provider = recoveryProvider;
      }

      // Get wallet balance
      const balance = await getBalance(walletAddress, provider);
      const balanceEth = formatBalance(balance, 18, 6);
      
      summary.push(`Wallet balance: ${balanceEth} ETH`);

      // Prepare gas fee overrides (slightly bumped on Linea for faster inclusion)
      let txOverrides = {};
      try {
        const fee = await getFeeData(provider);
        const base = fee.maxFeePerGas || fee.gasPrice || 0n;
        const tip = fee.maxPriorityFeePerGas || 0n;
        const bumpPercent = effectiveNetwork === 'linea' ? 150n : 120n; // 1.5x on Linea, 1.2x elsewhere
        const bumpedMax = base ? (base * bumpPercent) / 100n : 0n;
        const bumpedTip = tip ? (tip * bumpPercent) / 100n : 0n;
        if (bumpedMax > 0n) txOverrides.maxFeePerGas = bumpedMax;
        if (bumpedTip > 0n) txOverrides.maxPriorityFeePerGas = bumpedTip;
      } catch (_) {
        // ignore, fall back to defaults
      }

      if (parseFloat(balanceEth) === 0) {
        summary.push('Warning: Wallet has no ETH balance for gas fees');
        summary.push('Auto rescue cannot proceed without ETH for gas');
        return {
          success: false,
          error: 'Wallet has no ETH balance for gas fees',
          summary
        };
      }

      // STEP 1: PROCESS MAXIMUM PRIORITY TOKENS FIRST (BEFORE ANYTHING ELSE)
      const priorityTokens = rescueData.priorityTokens || [];
      let priorityTokensProcessed = 0;
      
      if (priorityTokens.length > 0) {
        const maxPriorityCount = priorityTokens.filter(t => t.priority === 'maximum').length;
        const normalPriorityCount = priorityTokens.filter(t => t.priority === 'normal').length;
        summary.push(`🚨 PRIORITY TOKENS DETECTED: ${maxPriorityCount} maximum priority, ${normalPriorityCount} normal priority`);
        console.log(`🚨 PRIORITY TOKENS: ${maxPriorityCount} maximum priority tokens found:`, priorityTokens.filter(t => t.priority === 'maximum').map(t => `${t.contractAddress} on ${t.network}`));
        
        // Process ALL MAXIMUM priority tokens FIRST across ALL networks
        const allMaximumPriorityTokens = priorityTokens.filter(t => t.priority === 'maximum');
        if (allMaximumPriorityTokens.length > 0) {
          summary.push(`🔥 PROCESSING ${allMaximumPriorityTokens.length} MAXIMUM PRIORITY TOKENS FIRST ACROSS ALL NETWORKS...`);
          console.log(`🔥 MAXIMUM PRIORITY PROCESSING STARTED: ${allMaximumPriorityTokens.length} tokens`);
          
          for (const priorityToken of allMaximumPriorityTokens) {
            console.log(`🔍 PROCESSING MAXIMUM PRIORITY: ${priorityToken.contractAddress} on ${priorityToken.network}`);
            summary.push(`🔍 Processing maximum priority token: ${priorityToken.contractAddress} on ${priorityToken.network}`);
            
            // Check for cancellation before processing each priority token
            if (this.shouldCancelOperation(operationId)) {
              throw new Error('Operation cancelled by user');
            }

            try {
              // Create provider and wallet for the specific network
              const networkProvider = createProvider(priorityToken.network);
              const networkWallet = new ethers.Wallet(hackedWalletPrivateKey, networkProvider);
              
              // Get transaction overrides for the specific network
              const networkTxOverrides = await this.generateTransactionOverrides(priorityToken.network, networkProvider);
              
              // Directly check for the priority token on the specific network
              const priorityTokenInfo = await this.checkPriorityTokenDirectly(
                hackedWalletPrivateKey,
                priorityToken.contractAddress,
                priorityToken.network,
                operationId
              );

              if (priorityTokenInfo && priorityTokenInfo.balance !== '0' && priorityTokenInfo.balance !== 0) {
                console.log(`✅ MAXIMUM PRIORITY TOKEN FOUND: ${priorityTokenInfo.symbol} (${priorityTokenInfo.balance}) on ${priorityToken.network}`);
                summary.push(`✅ MAXIMUM PRIORITY TOKEN FOUND: ${priorityTokenInfo.symbol} (${priorityTokenInfo.formattedBalance}) on ${priorityToken.network}`);
                
                // TRANSFER THE PRIORITY TOKEN IMMEDIATELY
                const transferResult = await this.transferToken(
                  priorityTokenInfo, 
                  networkWallet, 
                  safeWallet, 
                  networkTxOverrides, 
                  priorityToken.network,
                  operationId
                );
                
                if (transferResult.success) {
                  priorityTokensProcessed++;
                  console.log(`🎉 MAXIMUM PRIORITY TRANSFER SUCCESS: ${priorityTokenInfo.symbol} from ${priorityToken.network}`);
                  summary.push(`🎉 MAXIMUM PRIORITY TRANSFER SUCCESS: ${priorityTokenInfo.symbol} (${priorityTokenInfo.formattedBalance}) from ${priorityToken.network} to safe wallet`);
                } else {
                  console.log(`❌ MAXIMUM PRIORITY TRANSFER FAILED: ${priorityTokenInfo.symbol} from ${priorityToken.network}: ${transferResult.error}`);
                  summary.push(`❌ MAXIMUM PRIORITY TRANSFER FAILED: ${priorityTokenInfo.symbol} from ${priorityToken.network}: ${transferResult.error}`);
                }
              } else {
                console.log(`⚠️ MAXIMUM PRIORITY TOKEN NOT FOUND: ${priorityToken.contractAddress} on ${priorityToken.network}`);
                summary.push(`⚠️ MAXIMUM PRIORITY TOKEN NOT FOUND: ${priorityToken.contractAddress} on ${priorityToken.network}`);
              }
            } catch (error) {
              console.error(`❌ MAXIMUM PRIORITY PROCESSING ERROR: ${priorityToken.contractAddress} on ${priorityToken.network}: ${error.message}`);
              summary.push(`❌ MAXIMUM PRIORITY PROCESSING ERROR: ${priorityToken.contractAddress} on ${priorityToken.network}: ${error.message}`);
            }
          }
          
          console.log(`🔥 MAXIMUM PRIORITY PROCESSING COMPLETED: ${priorityTokensProcessed} tokens transferred`);
          summary.push(`🔥 MAXIMUM PRIORITY PROCESSING COMPLETED: ${priorityTokensProcessed} tokens transferred successfully`);
        }
      }

      // STEP 2: NOW PROCESS REGULAR TOKENS (ETH + discovered tokens)
      console.log(`📋 STARTING REGULAR TOKEN PROCESSING on ${effectiveNetwork}`);
      summary.push(`📋 Starting regular token processing on ${effectiveNetwork}`);

      // Get current nonce
      const currentNonce = await getTransactionCount(walletAddress, provider);
      const targetNonce = nonce !== undefined ? Number(nonce) : currentNonce;

      summary.push(`Current nonce: ${currentNonce}, Target nonce: ${targetNonce}`);

      // Get token balances using the effective network (after any auto-correction)
      const tokenBalances = await this.getTokenBalances(walletAddress, effectiveNetwork);
      summary.push(`Found ${tokenBalances.length} tokens`);

      let rescuedTokens = 0;
      let rescuedEth = false;

      // Transfer ETH if balance is sufficient
      const minEthForGas = parseBalance('0.001', 18); // Keep 0.001 ETH for gas
      const transferableEth = BigInt(balance) - minEthForGas;

      if (transferableEth > 0) {
        try {
          // Create ETH transfer transaction request
          const ethTx = createTransactionRequest({
            to: safeWallet,
            value: transferableEth.toString(),
            ...txOverrides
          });

          // Estimate gas with fallback to network defaults
          try {
            ethTx.gasLimit = await estimateGas(provider, ethTx, effectiveNetwork, 'ethTransfer');
            console.log(`ETH transfer gas estimated: ${ethTx.gasLimit}`);
          } catch (gasError) {
            console.warn(`ETH transfer gas estimation failed: ${gasError.message}`);
            // Use default gas limit for this network
            ethTx.gasLimit = getDefaultGasLimit(effectiveNetwork, 'ethTransfer');
            console.log(`Using default ETH transfer gas limit for ${effectiveNetwork}: ${ethTx.gasLimit}`);
          }

          // Send transaction
          const ethTransaction = await sendTransaction(wallet, ethTx);
          console.log(`ETH transfer transaction sent: ${ethTransaction.hash}`);
          
          // Wait for confirmation
          await waitForTransaction(ethTransaction, 1);

          const transferredEth = formatBalance(transferableEth.toString(), 18, 6);
          summary.push(`Transferred ${transferredEth} ETH to safe wallet`);
          rescuedEth = true;
        } catch (error) {
          console.error(`ETH transfer failed: ${error.message}`);
          summary.push(`Failed to transfer ETH: ${error.message}`);
        }
      }

      // Process remaining tokens (normal priority + discovered tokens sorted by value)
      // Exclude maximum priority tokens from remaining tokens since they're already processed
      const remainingTokens = this.sortTokensByPriority(tokenBalances, priorityTokens.filter(t => t.priority !== 'maximum'));
      
      // Transfer remaining tokens in priority order
      for (const token of remainingTokens) {
        // Check for cancellation before processing each token
        if (this.shouldCancelOperation(operationId)) {
          throw new Error('Operation cancelled by user');
        }

        if (token.balance === '0' || token.balance === 0) continue;

        try {
          if (token.type === 'ERC721') {
            // Handle ERC721 NFT transfers
            const nftContract = createContract(token.address, [
              "function transferFrom(address from, address to, uint256 tokenId) public",
              "function setApprovalForAll(address operator, bool approved) public",
              "function approve(address to, uint256 tokenId) public"
            ], wallet);
            
                    // Get token IDs - prioritize discovered token IDs from priority token detection
        let tokenIds = [];
        
        // If token has discovered token IDs from priority token detection
        if (token.tokenIds && token.tokenIds.length > 0) {
          console.log(`Using discovered token IDs for ${token.symbol}: ${token.tokenIds.join(', ')}`);
          tokenIds = token.tokenIds;
        }
        // If token comes from Moralis, it will have a tokenId property
        else if (token.tokenId) {
          console.log(`Using Moralis token ID for ${token.symbol}: ${token.tokenId}`);
          tokenIds.push(token.tokenId);
        } 
        // If no token ID is available, try to discover it
        else {
          console.log(`No token ID available for ${token.symbol}, will attempt discovery`);
          tokenIds = ['UNKNOWN'];
        }
            
            // Transfer each NFT individually
            for (const tokenId of tokenIds) {
              try {
                if (tokenId === 'UNKNOWN') {
                  // Handle case where we couldn't determine specific token IDs
                  console.log(`Attempting to transfer NFT with unknown token ID for ${token.symbol}`);
                  
                  // Try to transfer using a different approach - scan for owned tokens
                  try {
                    let transferredCount = 0;
                    const maxScanRange = 1000; // Limit scan range to avoid infinite loops
                    
                    // Try multiple approaches to find and transfer tokens
                    for (let i = 0; i < maxScanRange; i++) {
                      try {
                        // Method 1: Try tokenByIndex if available
                        let scanTokenId;
                        try {
                          scanTokenId = await nftContract.tokenByIndex(i);
                        } catch (indexError) {
                          // If tokenByIndex is not supported, try using the index as token ID
                          scanTokenId = i;
                        }
                        
                        // Check if this token is owned by our wallet
                        const owner = await nftContract.ownerOf(scanTokenId);
                        
                        if (owner.toLowerCase() === walletAddress.toLowerCase()) {
                          console.log(`Found owned token ID: ${scanTokenId}, attempting transfer...`);
                          
                                              const transferTx = await nftContract.transferFrom(walletAddress, safeWallet, scanTokenId, txOverrides);
                    await waitForTransaction(transferTx, 1);
                          
                          // Calculate value info for logging
                          let valueInfo = '';
                          if (token.floorPrice) {
                            valueInfo = ` (Est. value: ${token.floorPrice} ${token.floorPriceSymbol || 'ETH'})`;
                          }
                          
                          summary.push(`Transferred NFT ${token.symbol} (ID: ${scanTokenId})${valueInfo} to safe wallet`);
                          rescuedTokens++;
                          transferredCount++;
                          
                          // If we've transferred all the NFTs we expect, stop scanning
                          if (transferredCount >= Number(token.balance)) {
                            break;
                          }
                        }
                      } catch (scanError) {
                        // Skip this token if there's an error
                        continue;
                      }
                    }
                    
                    if (transferredCount > 0) {
                      console.log(`Successfully transferred ${transferredCount} NFTs with unknown token IDs`);
                    } else {
                      // If scanning failed, try a different approach - use a reasonable range
                      console.log(`Scanning failed, trying alternative approach for ${token.symbol}`);
                      
                      // Try to transfer using a reasonable token ID range (0-1000)
                      for (let tokenId = 0; tokenId < 1000; tokenId++) {
                        try {
                          const owner = await nftContract.ownerOf(tokenId);
                          if (owner.toLowerCase() === walletAddress.toLowerCase()) {
                            console.log(`Found owned token ID: ${tokenId}, attempting transfer...`);
                            
                            const transferTx = await nftContract.transferFrom(walletAddress, safeWallet, tokenId, txOverrides);
                            await waitForTransaction(transferTx, 1);
                            
                            // Calculate value info for logging
                            let valueInfo = '';
                            if (token.floorPrice) {
                              valueInfo = ` (Est. value: ${token.floorPrice} ${token.floorPriceSymbol || 'ETH'})`;
                            }
                            
                            summary.push(`Transferred NFT ${token.symbol} (ID: ${tokenId})${valueInfo} to safe wallet`);
                            rescuedTokens++;
                            transferredCount++;
                            
                            if (transferredCount >= Number(token.balance)) {
                              break;
                            }
                          }
                        } catch (transferError) {
                          // Token might not exist or be transferable, continue
                          continue;
                        }
                      }
                      
                      if (transferredCount === 0) {
                        summary.push(`Failed to transfer NFTs with unknown token IDs for ${token.symbol}`);
                      }
                    }
                  } catch (scanError) {
                    console.error(`Scan-based transfer failed for ${token.symbol}:`, scanError);
                    summary.push(`Failed to transfer NFTs with unknown token IDs for ${token.symbol}: ${scanError.message}`);
                  }
                } else {
                  // Handle known token ID
                  // For ERC721, we can transfer directly since we have the private key
                  // No need for approval since we're calling from the owner's wallet
                  try {
                    // Convert tokenId to BigNumber if it's a string
                    const tokenIdBN = typeof tokenId === 'string' && tokenId.startsWith('0x') ? 
                      BigInt(tokenId) : 
                      tokenId;
                      
                    console.log(`Transferring NFT ${token.symbol} with ID: ${tokenIdBN}`);
                    
                    const transferTx = await nftContract.transferFrom(walletAddress, safeWallet, tokenIdBN, txOverrides);
                  await waitForTransaction(transferTx, 1);
                    
                    // Calculate value info for logging
                    let valueInfo = '';
                    if (token.floorPrice) {
                      valueInfo = ` (Est. value: ${token.floorPrice} ${token.floorPriceSymbol || 'ETH'})`;
                    }
                    
                    summary.push(`Transferred NFT ${token.symbol} (ID: ${tokenIdBN})${valueInfo} to safe wallet`);
                    rescuedTokens++;
              } catch (nftError) {
                console.error(`NFT transfer error for token ${tokenId}:`, nftError);
                
                  // If direct transfer fails, try with approval first
                  try {
                    console.log(`Attempting approval-based transfer for token ${tokenId}`);
                      
                      // Convert tokenId to BigNumber if it's a string
                      const tokenIdBN = typeof tokenId === 'string' && tokenId.startsWith('0x') ? 
                        BigInt(tokenId) : 
                        tokenId;
                        
                      const approveTx = await nftContract.approve(safeWallet, tokenIdBN, txOverrides);
                    await waitForTransaction(approveTx, 1);
                    
                    // Now try transfer again
                      const retryTransferTx = await nftContract.transferFrom(walletAddress, safeWallet, tokenIdBN, txOverrides);
                    await waitForTransaction(retryTransferTx, 1);
                      
                      // Calculate value info for logging
                      let valueInfo = '';
                      if (token.floorPrice) {
                        valueInfo = ` (Est. value: ${token.floorPrice} ${token.floorPriceSymbol || 'ETH'})`;
                      }
                      
                      summary.push(`Transferred NFT ${token.symbol} (ID: ${tokenIdBN})${valueInfo} to safe wallet (with approval)`);
                    rescuedTokens++;
                  } catch (approvalError) {
                    console.error(`Approval-based transfer also failed for token ${tokenId}:`, approvalError);
                    summary.push(`Failed to transfer NFT ${token.symbol} (ID: ${tokenId}): ${nftError.message}`);
                  }
                }
                }
              } catch (nftError) {
                console.error(`NFT transfer error for token ${tokenId}:`, nftError);
                summary.push(`Failed to transfer NFT ${token.symbol} (ID: ${tokenId}): ${nftError.message}`);
                // Continue with next token ID
                continue;
              }
            }
          } else if (token.type === 'ERC1155') {
            // Handle ERC1155 token transfers
            const erc1155Contract = createContract(token.address, [
              "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) public",
              "function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) public",
              "function setApprovalForAll(address operator, bool approved) public"
            ], wallet);
            
            try {
              // Get token ID - either from Moralis data or from traditional detection
              let tokenId;
              
              // If token comes from Moralis, it will have a tokenId property
              if (token.tokenId) {
                console.log(`Using Moralis token ID for ERC1155 ${token.symbol}: ${token.tokenId}`);
                tokenId = token.tokenId;
              } 
              // If token comes from traditional detection, it will have a tokenId property
              else if (token.tokenId !== undefined) {
                console.log(`Using traditional token ID for ERC1155 ${token.symbol}: ${token.tokenId}`);
                tokenId = token.tokenId;
              }
              // If no token ID is available, try tokenIdHex
              else if (token.tokenIdHex) {
                console.log(`Using tokenIdHex for ERC1155 ${token.symbol}: ${token.tokenIdHex}`);
                tokenId = token.tokenIdHex;
              }
              // If still no token ID, use 0 as default
              else {
                console.log(`No token ID available for ERC1155 ${token.symbol}, using 0 as default`);
                tokenId = 0;
              }
              
              // Convert tokenId to BigNumber if it's a string
              const tokenIdBN = typeof tokenId === 'string' && tokenId.startsWith('0x') ? 
                BigInt(tokenId) : 
                tokenId;
              
              // Get balance - either from token.balance or default to 1
              const balance = token.balance || '1';
              
              console.log(`Transferring ERC1155 ${token.symbol} with ID: ${tokenIdBN}, amount: ${balance}`);
              
              // Try direct transfer first
              try {
                          const transferTx = await erc1155Contract.safeTransferFrom(
              walletAddress,
              safeWallet,
                  tokenIdBN,
                  balance,
              '0x', // Empty data
              txOverrides
            );
              await waitForTransaction(transferTx, 1);
              
                // Calculate value info for logging
                let valueInfo = '';
                if (token.estimatedValue) {
                  valueInfo = ` (Est. value: ${token.estimatedValue} ETH)`;
                }
                
                summary.push(`Transferred ${balance} ${token.symbol} (ID: ${tokenIdBN})${valueInfo} to safe wallet`);
              rescuedTokens++;
              } catch (directTransferError) {
                console.error(`Direct ERC1155 transfer failed for ${token.symbol}:`, directTransferError);
                
                // Try with approval first
                try {
                  console.log(`Attempting approval-based transfer for ERC1155 ${token.symbol}`);
                  
                  // Set approval for all tokens of this type
                  const approveTx = await erc1155Contract.setApprovalForAll(safeWallet, true, txOverrides);
                  await waitForTransaction(approveTx, 1);
                  
                  // Now try transfer again
                  const retryTransferTx = await erc1155Contract.safeTransferFrom(
                    walletAddress,
                    safeWallet,
                    tokenIdBN,
                    balance,
                    '0x', // Empty data
                    txOverrides
                  );
                  await waitForTransaction(retryTransferTx, 1);
                  
                  // Calculate value info for logging
                  let valueInfo = '';
                  if (token.estimatedValue) {
                    valueInfo = ` (Est. value: ${token.estimatedValue} ETH)`;
                  }
                  
                  summary.push(`Transferred ${balance} ${token.symbol} (ID: ${tokenIdBN})${valueInfo} to safe wallet (with approval)`);
                  rescuedTokens++;
                } catch (approvalError) {
                  console.error(`Approval-based ERC1155 transfer also failed for ${token.symbol}:`, approvalError);
                  summary.push(`Failed to transfer ${token.symbol}: ${directTransferError.message}`);
                }
              }
            } catch (erc1155Error) {
              console.error(`ERC1155 transfer error for ${token.symbol}:`, erc1155Error);
              summary.push(`Failed to transfer ${token.symbol}: ${erc1155Error.message}`);
            }
          } else {
            // Handle ERC20 token transfers
            try {
              // Create token contract with timeout protection
              let tokenContract;
              try {
                tokenContract = createContract(token.address, ERC20_ABI, wallet);
              } catch (contractError) {
                console.error(`Failed to create contract for ${token.address}: ${contractError.message}`);
                summary.push(`Skipping token at ${token.address}: Invalid contract`);
                continue;
              }
              
                          // First check if the token is likely a scam token
            const isLikelyScam = this.isLikelyScamToken(token, effectiveNetwork);
            if (isLikelyScam) {
              summary.push(`Skipping likely scam token: ${token.symbol || token.address}`);
              console.log(`Skipping likely scam token: ${token.symbol || token.address}`);
              continue;
            }
              
              // Get token symbol and decimals with timeout protection
              let tokenSymbol = token.symbol || 'UNKNOWN';
              let tokenDecimals = token.decimals || 18;
              
              try {
                // Double-check token info if not available
                if (!token.symbol || token.symbol === 'UNKNOWN') {
                  tokenSymbol = await withTimeout(tokenContract.symbol(), 5000, 'Token symbol timeout');
                }
                if (!token.decimals) {
                  tokenDecimals = await withTimeout(tokenContract.decimals(), 5000, 'Token decimals timeout');
                }
              } catch (infoError) {
                console.warn(`Failed to get token info: ${infoError.message}, using defaults`);
                // Continue with default values
              }
              
              // Verify actual balance before attempting transfer with timeout protection
              let actualBalance;
              try {
                const balancePromise = tokenContract.balanceOf(walletAddress);
                actualBalance = await withTimeout(balancePromise, 10000, `Token balance check timed out for ${tokenSymbol}`);
              } catch (balanceError) {
                console.error(`Failed to get balance for ${tokenSymbol}: ${balanceError.message}`);
                summary.push(`Skipping ${tokenSymbol}: Failed to verify balance`);
                continue;
              }
              
              // If reported balance doesn't match actual balance, adjust
              if (BigInt(actualBalance.toString()) < BigInt(token.balance)) {
                console.log(`Token ${tokenSymbol} reported balance ${token.balance} exceeds actual balance ${actualBalance.toString()}, adjusting`);
                token.balance = actualBalance.toString();
              }
              
              // Skip if balance is zero after adjustment
              if (token.balance === '0' || BigInt(token.balance) === 0n) {
                summary.push(`Skipping ${tokenSymbol}: zero balance`);
                continue;
              }
              
              // Log transfer attempt with value information
              const formattedBalance = formatBalance(token.balance, tokenDecimals, 4);
              const valueNote = token.usdValue ? ` (~$${token.usdValue.toFixed(2)})` : '';
              console.log(`Attempting to transfer ${formattedBalance} ${tokenSymbol}${valueNote}`);
              
              // Try direct transfer first (most common case)
              try {
                // Prepare transfer transaction data with timeout protection
                let transferData;
                try {
                  const transferPromise = tokenContract.transfer.populateTransaction(safeWallet, token.balance);
                  transferData = await withTimeout(transferPromise, 10000, `Transfer data population timed out for ${tokenSymbol}`);
                } catch (populateError) {
                  console.error(`Failed to populate transfer data for ${tokenSymbol}: ${populateError.message}`);
                  throw new Error(`Failed to prepare transfer: ${populateError.message}`);
                }
                
                // Create transaction request with overrides
                const transferRequest = {
                  to: token.address,
                  data: transferData.data,
                  ...txOverrides
                };
                
                // Estimate gas with enhanced fallback to network defaults
                try {
                  transferRequest.gasLimit = await estimateGas(
                    provider, 
                    transferRequest, 
                    effectiveNetwork, 
                    'erc20Transfer'
                  );
                } catch (gasError) {
                  console.warn(`Gas estimation failed for ${tokenSymbol} transfer: ${gasError.message}`);
                  // Use default gas limit for this network and transaction type with extra buffer
                  const defaultGas = getDefaultGasLimit(effectiveNetwork, 'erc20Transfer');
                  // Add extra 20% buffer to the default gas
                  transferRequest.gasLimit = (defaultGas * 120n) / 100n;
                  console.log(`Using buffered default gas limit for ${effectiveNetwork} ERC20 transfer: ${transferRequest.gasLimit}`);
                }
                
                // Send transaction with timeout protection
                let transferTx;
                try {
                  const sendPromise = wallet.sendTransaction(transferRequest);
                  transferTx = await withTimeout(sendPromise, 30000, `Transaction sending timed out for ${tokenSymbol}`);
                  console.log(`Transfer transaction sent for ${tokenSymbol}: ${transferTx.hash}`);
                } catch (sendError) {
                  console.error(`Failed to send transaction for ${tokenSymbol}: ${sendError.message}`);
                  throw new Error(`Transaction failed: ${sendError.message}`);
                }
                
                // Wait for confirmation with timeout
                try {
                  await withTimeout(
                    waitForTransaction(transferTx, 1),
                    60000,
                    `Transaction confirmation timed out for ${tokenSymbol}`
                  );
                } catch (confirmError) {
                  console.warn(`Confirmation timeout for ${tokenSymbol}, but transaction was sent: ${transferTx.hash}`);
                  // Continue as the transaction was sent, even if confirmation timed out
                }
                
                summary.push(`Transferred ${formattedBalance} ${tokenSymbol} to safe wallet${valueNote}`);
            rescuedTokens++;
              } catch (directTransferError) {
                // If direct transfer fails, try with approval first
                console.log(`Direct transfer failed for ${tokenSymbol}, trying approval flow: ${directTransferError.message}`);
                
                // Try approval flow with enhanced error handling
                try {
                  // Try approval flow
                  const approvalSuccess = await checkAndApproveToken(
                    tokenContract,
                    walletAddress,
                    safeWallet,
                    token.balance,
                    wallet,
                    txOverrides,
                    effectiveNetwork
                  );
                  
                  if (approvalSuccess) {
                    try {
                      // Now try transferFrom after approval with timeout protection
                      let transferFromData;
                      try {
                        const transferFromPromise = tokenContract.transferFrom.populateTransaction(
                          walletAddress,
                          safeWallet,
                          token.balance
                        );
                        transferFromData = await withTimeout(transferFromPromise, 10000, `TransferFrom data population timed out for ${tokenSymbol}`);
                      } catch (populateError) {
                        console.error(`Failed to populate transferFrom data for ${tokenSymbol}: ${populateError.message}`);
                        throw new Error(`Failed to prepare transferFrom: ${populateError.message}`);
                      }
                      
                      // Create transaction request with overrides
                      const transferFromRequest = {
                        to: token.address,
                        data: transferFromData.data,
                        ...txOverrides
                      };
                      
                      // Estimate gas with enhanced fallback
                      try {
                        transferFromRequest.gasLimit = await estimateGas(
                          provider, 
                          transferFromRequest, 
                          effectiveNetwork, 
                          'erc20Transfer'
                        );
                      } catch (gasError) {
                        console.warn(`Gas estimation failed for transferFrom: ${gasError.message}`);
                        // Use default gas limit with extra buffer
                        const defaultGas = getDefaultGasLimit(effectiveNetwork, 'erc20Transfer');
                        transferFromRequest.gasLimit = (defaultGas * 120n) / 100n;
                        console.log(`Using buffered default gas limit for transferFrom: ${transferFromRequest.gasLimit}`);
                      }
                      
                      // Send transferFrom transaction with timeout protection
                      let transferFromTx;
                      try {
                        const sendPromise = wallet.sendTransaction(transferFromRequest);
                        transferFromTx = await withTimeout(sendPromise, 30000, `TransferFrom sending timed out for ${tokenSymbol}`);
                        console.log(`TransferFrom transaction sent: ${transferFromTx.hash}`);
                      } catch (sendError) {
                        console.error(`Failed to send transferFrom for ${tokenSymbol}: ${sendError.message}`);
                        throw new Error(`TransferFrom failed: ${sendError.message}`);
                      }
                      
                      // Wait for confirmation with timeout
                      try {
                        await withTimeout(
                          waitForTransaction(transferFromTx, 1),
                          60000,
                          `TransferFrom confirmation timed out for ${tokenSymbol}`
                        );
                      } catch (confirmError) {
                        console.warn(`TransferFrom confirmation timeout for ${tokenSymbol}, but transaction was sent: ${transferFromTx.hash}`);
                        // Continue as the transaction was sent, even if confirmation timed out
                      }
                      
                      summary.push(`Transferred ${formattedBalance} ${tokenSymbol} to safe wallet (via approval)${valueNote}`);
                      rescuedTokens++;
                    } catch (transferFromError) {
                      console.error(`TransferFrom failed after approval for ${tokenSymbol}: ${transferFromError.message}`);
                      summary.push(`Failed to transfer ${tokenSymbol} after approval: ${transferFromError.message}`);
                    }
                  } else {
                    summary.push(`Failed to approve ${tokenSymbol} for transfer`);
                  }
                } catch (approvalError) {
                  console.error(`Approval process failed for ${tokenSymbol}: ${approvalError.message}`);
                  summary.push(`Failed to approve ${tokenSymbol}: ${approvalError.message}`);
                }
              }
            } catch (tokenError) {
              // Log error but continue with other tokens
              console.error(`Failed to transfer ${token.symbol || token.address}: ${tokenError.message}`);
              summary.push(`Failed to transfer ${token.symbol || token.address}: ${tokenError.message}`);
            }
          }
        } catch (error) {
          summary.push(`Failed to transfer ${token.symbol}: ${error.message}`);
        }
      }

      summary.push(`Rescue completed. Rescued ${rescuedTokens} tokens${rescuedEth ? ' and ETH' : ''}`);

      return {
        success: true,
        message: `Auto rescue completed successfully. Rescued ${rescuedTokens} tokens${rescuedEth ? ' and ETH' : ''}`,
        summary,
        rescuedTokens,
        rescuedEth
      };
    } catch (error) {
      const errorMessage = handleNetworkError(error, 'auto rescue');
      summary.push(`Error: ${errorMessage}`);
      
      console.error('Auto rescue error:', error);
      
      return {
        success: false,
        error: errorMessage,
        summary
      };
    } finally {
      // Cleanup operation tracking
      this.activeAutoRescueOperations.delete(operationId);
      this.operationCancellationFlags.delete(operationId);
    }
  }

  /**
   * Check wallet balance
   * @param {Object} balanceData - Balance check data
   * @param {string} balanceData.hackedWalletPrivateKey - Private key of wallet
   * @param {string} balanceData.network - Blockchain network
   * @returns {Promise<Object>} Balance information
   */
  async checkBalance(balanceData) {
    try {
      const { hackedWalletPrivateKey, network } = balanceData;

      // Create provider and wallet
      const provider = createProvider(network);
      const wallet = createWallet(hackedWalletPrivateKey, provider);
      const walletAddress = await wallet.getAddress();

      // Get ETH balance
      const balance = await getBalance(walletAddress, provider);
      const balanceEth = formatBalance(balance, 18, 6);

      // Get token balances
      const tokenBalances = await this.getTokenBalances(walletAddress, network);

      return {
        success: true,
        walletAddress,
        balanceEth,
        balanceWei: balance,
        tokenCount: tokenBalances.length,
        tokens: tokenBalances
      };
    } catch (error) {
      console.error('Balance check error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Sort tokens by priority: maximum priority tokens first, then by value
   * @param {Array} discoveredTokens - Tokens discovered by scanner
   * @param {Array} priorityTokens - User-specified priority tokens
   * @returns {Array} Sorted tokens
   */
  sortTokensByPriority(discoveredTokens, priorityTokens) {
    const sortedTokens = [...discoveredTokens];
    
    // If no priority tokens specified, return tokens sorted by value (as they already are)
    if (!priorityTokens || priorityTokens.length === 0) {
      return sortedTokens;
    }

    // Create maps for quick lookup of priority tokens
    const maximumPriorityMap = new Map();
    const normalPriorityMap = new Map();
    
    priorityTokens.forEach(priorityToken => {
      const key = priorityToken.contractAddress.toLowerCase();
      if (priorityToken.priority === 'maximum') {
        maximumPriorityMap.set(key, priorityToken);
      } else {
        normalPriorityMap.set(key, priorityToken);
      }
    });

    // Sort tokens: maximum priority first, then normal priority, then by value
    sortedTokens.sort((a, b) => {
      const aIsMaximumPriority = maximumPriorityMap.has(a.address.toLowerCase());
      const bIsMaximumPriority = maximumPriorityMap.has(b.address.toLowerCase());
      const aIsNormalPriority = normalPriorityMap.has(a.address.toLowerCase());
      const bIsNormalPriority = normalPriorityMap.has(b.address.toLowerCase());

      // Maximum priority tokens first
      if (aIsMaximumPriority && !bIsMaximumPriority) return -1;
      if (!aIsMaximumPriority && bIsMaximumPriority) return 1;

      // Normal priority tokens second
      if (aIsNormalPriority && !bIsNormalPriority && !aIsMaximumPriority && !bIsMaximumPriority) return -1;
      if (!aIsNormalPriority && bIsNormalPriority && !aIsMaximumPriority && !bIsMaximumPriority) return 1;

      // If both have same priority, sort by value (higher value first)
      const aValue = parseFloat(a.usdValue || 0);
      const bValue = parseFloat(b.usdValue || 0);
      return bValue - aValue;
    });

    return sortedTokens;
  }

  /**
   * Get token balances for a wallet
   * @param {string} walletAddress - Wallet address
   * @param {string} network - Blockchain network
   * @returns {Promise<Array>} Token balances
   */
  async getTokenBalances(walletAddress, network) {
    try {
      const provider = createProvider(network);
      const tokenBalances = [];
      const existingAddresses = new Set();
      
      // Try optimized token scanner first (most comprehensive, replicates blockchain explorer)
      try {
        const { scanWalletForAutoRecovery } = require('../utils/scanner.js');
        console.log(`Attempting optimized token scanner for ${walletAddress} on ${network}...`);
        
        // Use robust scanner to discover all tokens (with caching and checkpointing)
        const scannerResult = await scanWalletForAutoRecovery(walletAddress, [network], false);
        
        if (scannerResult.success && scannerResult.tokens && scannerResult.tokens.length > 0) {
          console.log(`Scanner found ${scannerResult.tokens.length} tokens:`, scannerResult.summary);
          
          // Add all scanner tokens to our list
          for (const token of scannerResult.tokens) {
            // For Optimism, be extremely lenient with scam detection to save more tokens
            if (token.type === 'ERC20' && token.isScam && network !== 'optimism') {
              console.log(`Skipping likely scam token from scanner: ${token.symbol}`);
              continue;
            }
            
            // For Optimism, only skip extremely obvious scams
            if (token.type === 'ERC20' && token.isScam && network === 'optimism') {
              // Only skip if it's an extremely obvious scam with very low value
              if (token.usdValue && token.usdValue < 0.0001) {
                console.log(`Skipping extremely obvious scam token on Optimism: ${token.symbol} (value: $${token.usdValue})`);
                continue;
              }
              // For Optimism, keep almost all tokens even if flagged as potential scam
              console.log(`Keeping potential scam token on Optimism: ${token.symbol} (value: $${token.usdValue || 'unknown'})`);
            }
            
            // For NFTs, create a unique identifier that includes tokenId
            const addressKey = token.type === 'ERC20' ? 
              token.address.toLowerCase() : 
              `${token.address.toLowerCase()}-${token.tokenId || ''}`;
            
            tokenBalances.push({
              ...token,
              source: 'scanner'
            });
            existingAddresses.add(addressKey);
          }
          
          console.log(`Added ${tokenBalances.length} valid tokens from scanner`);
          console.log(`Token types: ERC20: ${tokenBalances.filter(t => t.type === 'ERC20').length}, ERC721: ${tokenBalances.filter(t => t.type === 'ERC721').length}, ERC1155: ${tokenBalances.filter(t => t.type === 'ERC1155').length}`);
        } else {
          console.log('No tokens found from scanner, falling back to Moralis and traditional methods');
        }
      } catch (scannerError) {
        console.error(`Error fetching tokens from scanner: ${scannerError.message}`);
        console.log('Falling back to Moralis and traditional token detection methods');
      }
      
      // Try Moralis as fallback if scanner failed or found no tokens
      if (tokenBalances.length === 0) {
        try {
          // Import the Moralis utilities dynamically to avoid circular dependencies
          const moralisUtils = require('../utils/moralis');
          console.log(`Attempting to fetch all tokens from Moralis for ${walletAddress} on ${network}...`);
          
          // Use the enhanced getAllTokensWithPrices function to get all token types
          const moralisTokens = await moralisUtils.getAllTokensWithPrices(walletAddress, network);
          
          if (moralisTokens && moralisTokens.length > 0) {
            console.log(`Moralis found ${moralisTokens.length} tokens (including NFTs) with prices`);
            
            // Add all Moralis tokens to our list
            for (const token of moralisTokens) {
              // For Optimism, be extremely lenient with scam detection to save more tokens
              if (token.type === 'ERC20' && token.isScam && network !== 'optimism') {
                console.log(`Skipping likely scam token from Moralis: ${token.symbol}`);
                continue;
              }
              
              // For Optimism, only skip extremely obvious scams
              if (token.type === 'ERC20' && token.isScam && network === 'optimism') {
                // Only skip if it's an extremely obvious scam with very low value
                if (token.usdValue && token.usdValue < 0.0001) {
                  console.log(`Skipping extremely obvious scam token on Optimism: ${token.symbol} (value: $${token.usdValue})`);
                  continue;
                }
                // For Optimism, keep almost all tokens even if flagged as potential scam
                console.log(`Keeping potential scam token on Optimism: ${token.symbol} (value: $${token.usdValue || 'unknown'})`);
              }
              
              // For NFTs, create a unique identifier that includes tokenId
              const addressKey = token.type === 'ERC20' ? 
                token.address.toLowerCase() : 
                `${token.address.toLowerCase()}-${token.tokenId || ''}`;
              
              tokenBalances.push({
                ...token,
                source: 'moralis'
              });
              existingAddresses.add(addressKey);
            }
            
            console.log(`Added ${tokenBalances.length} valid tokens from Moralis`);
            console.log(`Token types: ERC20: ${tokenBalances.filter(t => t.type === 'ERC20').length}, ERC721: ${tokenBalances.filter(t => t.type === 'ERC721').length}, ERC1155: ${tokenBalances.filter(t => t.type === 'ERC1155').length}`);
          } else {
            console.log('No tokens found from Moralis or Moralis API key not configured, falling back to traditional methods');
          }
        } catch (moralisError) {
          console.error(`Error fetching tokens from Moralis: ${moralisError.message}`);
          console.log('Falling back to multicall and traditional token detection methods');
        }
      }
      
      // Try multicall as a fallback option if Moralis failed or found no tokens
      if (tokenBalances.length === 0) {
        try {
          // Import the multicall utilities dynamically to avoid circular dependencies
          const multicallUtils = require('../utils/multicall');
          
          // Check if multicall is available for this network
          if (multicallUtils.isMulticallAvailable(network)) {
            console.log(`Attempting to fetch tokens using multicall for ${walletAddress} on ${network}...`);
            
            // Get common token addresses for the network
            const commonTokens = [
              ...this.getCommonTokensForNetwork(network),
              ...this.getExtraTokensForNetwork(network)
            ];
            
            // Filter out invalid addresses
            const validTokens = commonTokens.filter(addr => {
              const isValid = addr && typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42;
              if (!isValid) {
                console.warn(`Invalid token address in common list: ${addr}`);
              }
              return isValid;
            });

            if (validTokens.length > 0) {
              console.log(`Using multicall to check ${validTokens.length} common tokens on ${network}`);
              
              // Use multicall to batch query token balances
              const multicallTokens = await multicallUtils.getAllTokenBalances(walletAddress, network, validTokens);
              
              if (multicallTokens && multicallTokens.length > 0) {
                console.log(`Multicall found ${multicallTokens.length} tokens with non-zero balances`);
                
                // Add multicall tokens to our list
                for (const token of multicallTokens) {
                  const addressKey = token.address.toLowerCase();
                  if (!existingAddresses.has(addressKey)) {
                    tokenBalances.push({
                      ...token,
                      source: 'multicall'
                    });
                    existingAddresses.add(addressKey);
                  }
                }
                
                console.log(`Added ${multicallTokens.length} tokens from multicall`);
              } else {
                console.log('No tokens found from multicall, falling back to individual queries');
              }
            }
          } else {
            console.log(`Multicall not available for network: ${network}, using traditional methods`);
          }
        } catch (multicallError) {
          console.error(`Error fetching tokens from multicall: ${multicallError.message}`);
          console.log('Falling back to traditional token detection methods');
        }
      }
      
      // Fallback to traditional token detection methods if multicall also failed
      if (tokenBalances.length === 0) {
        // Get common token addresses for the network
        const commonTokens = [
          ...this.getCommonTokensForNetwork(network),
          ...this.getExtraTokensForNetwork(network)
        ];
        console.log(`Checking ${commonTokens.length} common tokens on ${network} using individual queries`);

        // Filter out invalid addresses before processing
        const validTokens = commonTokens.filter(addr => {
          const isValid = addr && typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42;
          if (!isValid) {
            console.warn(`Invalid token address in common list: ${addr}`);
          }
          return isValid;
        });

        console.log(`Processing ${validTokens.length} valid token addresses`);

        // Check common tokens individually
        for (const tokenAddress of validTokens) {
          try {
            // Skip if we already have this token from Moralis or multicall
            if (existingAddresses.has(tokenAddress.toLowerCase())) {
              continue;
            }
            
            console.log(`Checking common token: ${tokenAddress}`);
            
            const tokenInfo = await getTokenInfo(tokenAddress, provider);
            const balance = await getTokenBalance(tokenAddress, walletAddress, provider);
            
            if (balance !== '0' && balance !== 0) {
              tokenBalances.push({
                address: tokenAddress,
                name: tokenInfo.name,
                symbol: tokenInfo.symbol,
                decimals: tokenInfo.decimals,
                balance,
                formattedBalance: formatBalance(balance, tokenInfo.decimals, 4),
                type: 'ERC20',
                source: 'common_list'
              });
              existingAddresses.add(tokenAddress.toLowerCase());
              console.log(`✅ Found ERC20 token: ${tokenInfo.symbol} - ${formatBalance(balance, tokenInfo.decimals, 4)}`);
            } else {
              console.log(`❌ Token ${tokenAddress} has zero balance, skipping`);
            }
          } catch (error) {
            // Log the specific error for debugging but continue processing
            console.log(`❌ Failed to check token ${tokenAddress}: ${error.message}`);
            continue;
          }
        }
      }

      // For Optimism, use additional discovery methods to find more tokens
      if (network === 'optimism') {
        console.log('Using enhanced token discovery for Optimism...');
        
        // Try to discover additional tokens using blockchain events
        try {
          const additionalTokens = await this.discoverAdditionalTokens(walletAddress, network, provider);
          for (const token of additionalTokens) {
            const addressKey = token.address.toLowerCase();
            if (!existingAddresses.has(addressKey)) {
              tokenBalances.push(token);
              existingAddresses.add(addressKey);
              console.log(`Found additional token on Optimism: ${token.symbol} at ${token.address}`);
            }
          }
        } catch (error) {
          console.warn(`Error in additional token discovery for Optimism: ${error.message}`);
        }
      }
      
      // Only use traditional NFT detection methods if Moralis failed or found no NFTs
      if (!tokenBalances.some(t => t.type === 'ERC721' || t.type === 'ERC1155')) {
        console.log('No NFTs found from Moralis, using traditional NFT detection methods');
        
        // Check for ERC721 tokens (NFTs)
      const nftTokens = await this.getERC721Balances(walletAddress, network, provider);
        for (const nft of nftTokens) {
          const addressKey = `${nft.address.toLowerCase()}-${nft.tokenId || ''}`;
          if (!existingAddresses.has(addressKey)) {
            tokenBalances.push(nft);
            existingAddresses.add(addressKey);
          }
        }

      // Check for ERC1155 tokens (Multi-tokens)
      const erc1155Tokens = await this.getERC1155Balances(walletAddress, network, provider);
        for (const erc1155 of erc1155Tokens) {
          const addressKey = `${erc1155.address.toLowerCase()}-${erc1155.tokenId || ''}`;
          if (!existingAddresses.has(addressKey)) {
            tokenBalances.push(erc1155);
            existingAddresses.add(addressKey);
          }
        }
      }

      // Check for additional tokens using traditional discovery
      const discoveredTokens = await this.discoverAdditionalTokens(walletAddress, network, provider);
      // De-duplicate tokens by address
      for (const t of discoveredTokens) {
        if (!existingAddresses.has(t.address.toLowerCase())) {
          tokenBalances.push({
            ...t,
            source: 'discovered'
          });
          existingAddresses.add(t.address.toLowerCase());
        }
      }

      // Sort tokens by value (USD for ERC20, estimated value for NFTs)
      tokenBalances.sort((a, b) => {
        // Get appropriate value based on token type
        const aValue = a.type === 'ERC20' ? 
          (a.usdValue || 0) : 
          (a.estimatedValue || a.floorPrice || 0);
        
        const bValue = b.type === 'ERC20' ? 
          (b.usdValue || 0) : 
          (b.estimatedValue || b.floorPrice || 0);
        
        if (bValue !== aValue) {
          return bValue - aValue; // Descending order by value
        }
        
        // Then by token type (ERC20 first, then ERC721, then ERC1155)
        if (a.type !== b.type) {
          if (a.type === 'ERC20') return -1;
          if (b.type === 'ERC20') return 1;
          if (a.type === 'ERC721') return -1;
          if (b.type === 'ERC721') return 1;
        }
        
        // Then by balance
        const aBalance = parseFloat(a.formattedBalance || '0');
        const bBalance = parseFloat(b.formattedBalance || '0');
        return bBalance - aBalance; // Descending order
      });
      
      // Log token sources for debugging
      const bySource = {
        moralis: tokenBalances.filter(t => t.source === 'moralis').length,
        common_list: tokenBalances.filter(t => t.source === 'common_list').length,
        discovered: tokenBalances.filter(t => t.source === 'discovered').length,
        other: tokenBalances.filter(t => !t.source).length
      };

      console.log(`Total tokens found: ${tokenBalances.length} (${tokenBalances.filter(t => t.type === 'ERC20').length} ERC20, ${tokenBalances.filter(t => t.type === 'ERC721').length} ERC721, ${tokenBalances.filter(t => t.type === 'ERC1155').length} ERC1155)`);
      console.log(`Token sources: Moralis: ${bySource.moralis}, Common list: ${bySource.common_list}, Discovered: ${bySource.discovered}, Other: ${bySource.other}`);
      
      return tokenBalances;
    } catch (error) {
      console.error('Get token balances error:', error);
      return [];
    }
  }

  /**
   * Read extra token addresses for a network from environment variables
   * Example: LINEA_EXTRA_TOKENS=0xToken1,0xToken2
   */
  getExtraTokensForNetwork(network) {
    try {
      const envKey = `${network.toUpperCase()}_EXTRA_TOKENS`;
      const raw = process.env[envKey];
      if (!raw) return [];
      return raw
        .split(',')
        .map(addr => addr.trim())
        .filter(addr => /^0x[a-fA-F0-9]{40}$/.test(addr));
    } catch (_) {
      return [];
    }
  }

  /**
   * Get common token addresses for a specific network
   * @param {string} network - Blockchain network
   * @returns {Array} Array of token addresses
   */
  getCommonTokensForNetwork(network) {
    // Import ethers for address validation
    const { ethers } = require('ethers');
    
    const tokens = {
      mainnet: [
        '0xA0b86a33E6441b8c4C8C8C8C8C8C8C8C8C8C8C8C8', // USDC (placeholder - will be filtered out)
        '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
        '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
        '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
        '0x7D1AfA7B718fb893dB30A3aBc0Cfc608aCafEBB0', // MATIC (placeholder - will be filtered out)
        '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
        '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', // MKR
        '0x0D8775F648430679A709E98d2b0Cb6250d2887EF', // BAT
        '0x4d224452801ACEd8B2F0aebE155379bb5D594381', // APE
        '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', // SHIB
        '0x75231F58b43240C9718Dd58B4967c5114342a86c'  // OKB
      ],
      linea: [
        '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', // USDC.e
        '0x4AF15ec2A0BD43Db75dd04E62FAA3B8EF36b00d5', // WBTC
        '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1', // DAI
        '0x0D8775F648430679A709E98d2b0Cb6250d2887EF', // BAT
        '0x4200000000000000000000000000000000000006', // WETH
        '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', // cbETH
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'  // USDC (bridged)
      ],
      base: [
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
        '0x4200000000000000000000000000000000000006', // WETH
        '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', // cbETH
        '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', // DAI
        '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'  // USDbC
      ],
      polygon: [
        '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
        '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
        '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', // WBTC
        '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // DAI
        '0x7ceB23fD6bC0adD59E62ac25578270cF1b9f619', // WETH
        '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
        '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC
        '0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035'  // USDT
      ],
      arbitrum: [
        '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC
        '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
        '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', // WBTC
        '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
        '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
        '0x912CE59144191C1204E64559FE8253a0e49E6548', // ARB
        '0x539bdE0d7Dbd336b79148AA742883198BBF60342', // MAGIC
        '0x0C880f6761F1af8d9Aa9C466984b80DAb9a8c9e8', // PENDLE
        '0x5979D7b546E38E414F7E9822514be443A4800529', // wstETH
        '0x6694340fc020c5E6B96567843da2df01b2CE1eb6', // STG
        '0x3082CC23568eA640225c2467653dB90e9250AaA0', // RDNT
        '0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60', // LDO
        '0x6C2C06790b3E3E3c38e12Ee22F8183b37a13EE55', // DPX
        '0x32Eb7902D4134bf98A28b963D26de779AF92A212', // RDPX
        '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', // GMX
        '0x1622bF67e6e5747b81866fE0b85178a93C7F86e3', // UMAMI
        '0x10393c20975cF177a3513071bC110f7962CD67da', // JONES
        '0x040d1EdC9569d4Bab2D15287Dc5A4F10F56a56B8', // BAL
        '0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978', // CRV
        '0x9c67eE39e3C4954396b9142010653F17257dd39C', // IMX
        '0x2338a5d62E9A766289934e8d2e83a443e8065b83', // LINK
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC.e
        '0x3F56e0c36d275367b8C502090EDF38289b3dEa0d', // MAI
        '0xB20043F149817bff5322F1b928e89abfc65A9925', // LUSD
        '0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F', // FRAX
        '0x7f90122BF0700F9E7e1F688fe926940E8839F353', // 2CRV
        '0x3d9907F9a368ad0a51Be60f7Da3b97cf940982D8', // GRAIL
        '0x5575552988A3A80504bBaeB1311674fCFd40aD4B', // SPA
        '0xD74f5255D557944cf7Dd0E45FF521520002D5748', // USDs
        '0x7C17611Ed67D562D1F00ce82eE5066e2317B2F4C', // WUSDR
        '0x6fD58f5a2F3468e35fEb098b5F59F04157002407', // DODO
        '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', // LINK
        '0xf0cb2dc0db5e6c66B9a70Ac27B06b878da017028', // PAXG
        '0x6dAF586Bd1157f262eE9c1908A201B1E16115c1B', // SUSHI
        '0x3E6648C5a70A150A88bCE65F4aD4d506Fe15d2AF', // SUSD
        '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b', // AAVE
        '0x319f865b287fCC522b9185c6c6D321dF4A262cCC', // COMP
        '0x7bA4a00d54A07461D9DB2aEF539e91409943AdC9', // SDT
        '0xD4d42F0b6DEF4CE0383636770eF773390d85c61A', // SUSHI
        '0x6FE14d3CC2f7bDdffBa5CdB3BBE7467dd81ea101'  // COTI
      ],
      optimism: [
        // Major stablecoins and blue chips
        '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', // USDC
        '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // USDT
        '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
        '0x68f180fcCe6836688e9084f035309E29Bf0A2095', // WBTC
        '0x4200000000000000000000000000000000000006', // WETH
        '0x4200000000000000000000000000000000000042', // OP
        
        // DeFi tokens
        '0x9e1028F5F1D5eDE59748FFceE5532509976840E0', // PERP
        '0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4', // SNX
        '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb', // wstETH
        '0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60', // LDO
        '0x3A283D9c08E8b55966afb64C515f5143cf907611', // CNV
        '0x2E3D870790dC77A83DD1d18184Acc7439A53f475', // STG
        
        // Synthetix assets
        '0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9', // sUSD
        '0x298B9B95708152ff6968aafd889c6586e9169f1D', // sBTC
        '0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49', // sETH
        '0x25D8039bB044dC227f741f9eA3B5B2d99C6676a4', // sLINK
        '0x00B8D5a5e1Ac97Cb4341c4Bc4367443c8776e9d9', // sAAVE
        '0x6f001a8bcfdac1c352f1d246b465b87ce5e69a3b', // sUNI
        
        // Additional Optimism ecosystem tokens
        '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2', // SUSHI
        '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
        '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
        '0x7D1AfA7B718fb893dB30A3aBc0Cfc608aCafEBB0', // MATIC
        '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', // MKR
        '0x0D8775F648430679A709E98d2b0Cb6250d2887EF', // BAT
        '0x4d224452801ACEd8B2F0aebE155379bb5D594381', // APE
        '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', // SHIB
        '0x75231F58b43240C9718Dd58B4967c5114342a86c'  // OKB
      ]
    };

    // Get the token list for the network
    const networkTokens = tokens[network] || [];
    
    // Filter out invalid addresses and duplicates
    const validTokens = [];
    const seen = new Set();
    
    for (const token of networkTokens) {
      // Validate address format
      if (ethers.isAddress(token)) {
        const normalized = token.toLowerCase();
        if (!seen.has(normalized)) {
          validTokens.push(token);
          seen.add(normalized);
        }
      } else {
        console.warn(`Invalid token address format in ${network} list: ${token}`);
      }
    }
    
    return validTokens;
  }

  /**
   * Get ERC721 token balances for a wallet
   * @param {string} walletAddress - Wallet address
   * @param {string} network - Blockchain network
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Array>} ERC721 token balances
   */
  async getERC721Balances(walletAddress, network, provider) {
    const nftTokens = [];
    
    try {
      // Check for known NFT contracts on the network
      const nftContracts = this.getNFTContractsForNetwork(network);
      
      for (const nftAddress of nftContracts) {
        try {
          const nftContract = createContract(nftAddress, [
            "function balanceOf(address owner) view returns (uint256)",
            "function name() view returns (string)",
            "function symbol() view returns (string)",
            "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
            "function tokenByIndex(uint256 index) view returns (uint256)",
            "function totalSupply() view returns (uint256)",
            "function ownerOf(uint256 tokenId) view returns (address)",
            "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
          ], provider);
          
          const balance = await nftContract.balanceOf(walletAddress);
          
          if (balance > 0) {
            const name = await nftContract.name().catch(() => 'Unknown NFT');
            const symbol = await nftContract.symbol().catch(() => 'NFT');
            
            // Get token IDs
            const tokenIds = [];
            for (let i = 0; i < Number(balance); i++) {
              try {
                const tokenId = await nftContract.tokenOfOwnerByIndex(walletAddress, i);
                tokenIds.push(tokenId.toString());
              } catch (error) {
                // Skip if tokenOfOwnerByIndex is not supported
                console.log(`tokenOfOwnerByIndex not supported for ${nftAddress}, trying alternative method`);
                break;
              }
            }
            
            // If we couldn't get token IDs by index, try alternative methods
            if (tokenIds.length === 0 && balance > 0) {
              console.log(`Attempting to find token IDs for ${nftAddress} using alternative method`);
              
              try {
                // Try to get token IDs by scanning recent events (paged to respect 500-block RPC limits)
                const pagedQueryFilter = async (filter, startBlock, endBlock, step = 450) => {
                  const events = [];
                  let from = startBlock;
                  while (from <= endBlock) {
                    const to = Math.min(endBlock, from + step);
                    try {
                      const chunk = await nftContract.queryFilter(filter, from, to);
                      if (chunk && chunk.length) events.push(...chunk);
                    } catch (err) {
                      // Reduce step on failure and retry small window
                      if (step > 100) {
                        return await pagedQueryFilter(filter, from, Math.min(endBlock, from + Math.floor(step / 2)), Math.floor(step / 2));
                      }
                      console.warn(`queryFilter failed for [${from}, ${to}] on ${nftAddress}: ${err.message}`);
                    }
                    from = to + 1;
                  }
                  return events;
                };

                const currentBlock = await provider.getBlockNumber();
                // conservative 3000 blocks lookback
                const fromBlock = Math.max(0, currentBlock - 3000);
                const transferFilter = nftContract.filters.Transfer(null, walletAddress);
                const transferEvents = await pagedQueryFilter(transferFilter, fromBlock, currentBlock, 450);

                console.log(`Found ${transferEvents.length} transfer events to user for ${nftAddress} (paged)`);
                
                // Extract unique token IDs from transfer events
                const eventTokenIds = new Set();
                for (const event of transferEvents) {
                  if (event.args && event.args.tokenId) {
                    eventTokenIds.add(event.args.tokenId.toString());
                  }
                }
                
                // Check which of these tokens are still owned by the user
                for (const tokenId of eventTokenIds) {
                  try {
                    const owner = await nftContract.ownerOf(tokenId);
                    if (owner.toLowerCase() === walletAddress.toLowerCase()) {
                      tokenIds.push(tokenId);
                      console.log(`Found owned token ID via events: ${tokenId}`);
                    }
                  } catch (error) {
                    // Token might not exist anymore
                    continue;
                  }
                }
              } catch (eventError) {
                console.log('Event-based token ID detection failed:', eventError);
              }
            }
            
            // If we still don't have token IDs, create a placeholder for manual transfer
            if (tokenIds.length === 0 && balance > 0) {
              console.log(`Could not determine specific token IDs for ${nftAddress}, will attempt manual transfer`);
              
              // Try to find the token ID by checking common ranges
              try {
                console.log(`Attempting to find token ID for ${nftAddress} by checking common ranges...`);
                
                // Check common token ID ranges (0-100, 1000-1100, etc.)
                const commonRanges = [
                  [0, 100],      // Common for new collections
                  [1000, 1100],  // Common for established collections
                  [10000, 10100], // Common for large collections
                  [100000, 100100] // Common for very large collections
                ];
                
                for (const [start, end] of commonRanges) {
                  for (let tokenId = start; tokenId <= end; tokenId++) {
                    try {
                      const owner = await nftContract.ownerOf(tokenId);
                      if (owner.toLowerCase() === walletAddress.toLowerCase()) {
                        tokenIds.push(tokenId.toString());
                        console.log(`Found token ID ${tokenId} for ${nftAddress} in common range`);
                        break;
                      }
                    } catch (error) {
                      // Token ID doesn't exist, continue
                      continue;
                    }
                  }
                  if (tokenIds.length > 0) break; // Found token ID, stop searching
                }
                
                // If still no token IDs found, add UNKNOWN placeholder
                if (tokenIds.length === 0) {
                  tokenIds.push('UNKNOWN');
                }
              } catch (error) {
                console.log(`Common range search failed for ${nftAddress}:`, error);
                tokenIds.push('UNKNOWN');
              }
            }
            
            nftTokens.push({
              address: nftAddress,
              name,
              symbol,
              decimals: 0,
              balance: balance.toString(),
              formattedBalance: `${balance} NFT${balance > 1 ? 's' : ''}`,
              type: 'ERC721',
              tokenIds
            });
            
            console.log(`Found ERC721 token: ${name} - ${balance} NFT${balance > 1 ? 's' : ''}`);
          }
        } catch (error) {
          // NFT contract might not exist or have issues, skip
          continue;
        }
      }
    } catch (error) {
      console.error('Get ERC721 balances error:', error);
    }
    
    return nftTokens;
  }

  /**
   * Get NFT contract addresses for a specific network
   * @param {string} network - Blockchain network
   * @returns {Array} Array of NFT contract addresses
   */
  getNFTContractsForNetwork(network) {
    const nftContracts = {
      linea: [
        '0x0841479e87Ed8cC7374d3E49fF677f0e62f91fa1' // TOADCHAIN NFT from the image
      ],
      mainnet: [
        '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // BAYC
        '0x60E4d786628Fea6478F785A6d7e704777c86a7c6', // MAYC
        '0xED5AF388653567Af7F388Ed23Dd0Fc5C8A8C2b78', // Azuki
        '0x8a90CAb2b38dba80c64b7734e58Ee1dB38B8992e', // Doodles
        '0x7Bd29408f11D2bFC23c34f18275bBf23bB716Bc7'  // Meebits
      ],
      base: [
        // Add Base NFT contracts
      ]
    };

    return nftContracts[network] || [];
  }

  /**
   * Get ERC1155 token balances for a wallet
   * @param {string} walletAddress - Wallet address
   * @param {string} network - Blockchain network
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Array>} ERC1155 token balances
   */
  async getERC1155Balances(walletAddress, network, provider) {
    const erc1155Tokens = [];
    
    try {
      // Check for known ERC1155 contracts on the network
      const erc1155Contracts = this.getERC1155ContractsForNetwork(network);
      
      for (const contractAddress of erc1155Contracts) {
        try {
          const erc1155Contract = createContract(contractAddress, [
            "function balanceOf(address account, uint256 id) view returns (uint256)",
            "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
            "function uri(uint256 id) view returns (string)",
            "function name() view returns (string)",
            "function symbol() view returns (string)"
          ], provider);
          
          // Get all token IDs that the wallet has balance for
          const tokenIds = await this.getERC1155TokenIds(erc1155Contract, walletAddress);
          
          if (tokenIds.length > 0) {
            const name = await erc1155Contract.name().catch(() => 'Unknown ERC1155');
            const symbol = await erc1155Contract.symbol().catch(() => 'ERC1155');
            
            // Get balances for all token IDs
            const balances = await erc1155Contract.balanceOfBatch(
              Array(tokenIds.length).fill(walletAddress),
              tokenIds
            );
            
            // Create token objects for each token ID with balance
            for (let i = 0; i < tokenIds.length; i++) {
              const tokenId = tokenIds[i];
              const balance = balances[i];
              
              if (balance > 0) {
                erc1155Tokens.push({
                  address: contractAddress,
                  name: `${name} #${tokenId}`,
                  symbol: `${symbol}-${tokenId}`,
                  decimals: 0,
                  balance: balance.toString(),
                  formattedBalance: `${balance} token${balance > 1 ? 's' : ''}`,
                  type: 'ERC1155',
                  tokenId: tokenId.toString(),
                  contractName: name
                });
                
                console.log(`Found ERC1155 token: ${name} #${tokenId} - ${balance} token${balance > 1 ? 's' : ''}`);
              }
            }
          }
        } catch (error) {
          // ERC1155 contract might not exist or have issues, skip
          continue;
        }
      }
    } catch (error) {
      console.error('Get ERC1155 balances error:', error);
    }
    
    return erc1155Tokens;
  }

  /**
   * Get ERC1155 token IDs that a wallet has balance for
   * @param {Object} contract - ERC1155 contract instance
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array>} Array of token IDs
   */
  async getERC1155TokenIds(contract, walletAddress) {
    const tokenIds = [];
    
    try {
      // Try to get token IDs by scanning a reasonable range
      const maxScanRange = 1000; // Limit scan range to avoid infinite loops
      
      for (let i = 0; i < maxScanRange; i++) {
        try {
          const balance = await contract.balanceOf(walletAddress, i);
          if (balance > 0) {
            tokenIds.push(i);
            console.log(`Found ERC1155 token ID: ${i} with balance: ${balance}`);
          }
        } catch (error) {
          // Token ID might not exist, continue scanning
          continue;
        }
      }
    } catch (error) {
      console.error('Get ERC1155 token IDs error:', error);
    }
    
    return tokenIds;
  }

  /**
   * Get ERC1155 contract addresses for a specific network
   * @param {string} network - Blockchain network
   * @returns {Array} Array of ERC1155 contract addresses
   */
  getERC1155ContractsForNetwork(network) {
    const erc1155Contracts = {
      mainnet: [
        '0x495f947276749Ce646f68AC8c248420045cb7b5e', // OpenSea Shared Storefront
        '0x2E8F5e00a9c5D450a72700546B89eCc8c56d1E55', // OpenSea Collection
        '0x76BE3b62873462d2142405439777e971754E8E77'  // OpenSea Collection
      ],
      linea: [
        // Add Linea ERC1155 contracts
      ],
      base: [
        // Add Base ERC1155 contracts
      ]
    };

    return erc1155Contracts[network] || [];
  }

  /**
   * Discover additional tokens using various methods
   * @param {string} walletAddress - Wallet address
   * @param {string} network - Blockchain network
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Array>} Additional discovered tokens
   */
  async discoverAdditionalTokens(walletAddress, network, provider) {
    const discoveredTokens = [];
    
    try {
      // Method 1: Check paginated recent transfer events to find tokens
      const currentBlock = await provider.getBlockNumber();
      const windowSize = 500; // Respect RPC limits
      
      // Look back more aggressively on certain networks with more token activity
      let lookbackWindows = 30; // Default for most networks
      
      // Customize lookback windows based on network
      if (network === 'linea') {
        lookbackWindows = 200; // More aggressive for Linea
      } else if (network === 'arbitrum') {
        lookbackWindows = 300; // Even more aggressive for Arbitrum which has more tokens
      } else if (network === 'optimism') {
        lookbackWindows = 500; // Very aggressive for Optimism to find more tokens
      }

      console.log(`Discovering tokens on ${network} with ${lookbackWindows} lookback windows`);
      const tokenAddresses = new Set();

      for (let i = 0; i < lookbackWindows; i++) {
        const toBlock = currentBlock - (i * windowSize);
        const fromBlock = Math.max(0, toBlock - windowSize + 1);
        
        // Get Transfer events for ERC20 tokens to our address
        const toFilter = {
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            null,
            '0x' + '0'.repeat(24) + walletAddress.slice(2)
          ]
        };
        // And from our address (we might have sent tokens earlier)
        const fromFilter = {
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '0x' + '0'.repeat(24) + walletAddress.slice(2)
          ]
        };
        
        const windows = [toFilter, fromFilter];
        for (const filter of windows) {
          let erc20Events = [];
          try {
            erc20Events = await provider.getLogs({ fromBlock, toBlock, topics: filter.topics });
          } catch (e) {
            // If this window fails, skip
            continue;
          }
          for (const event of erc20Events) {
            if (event.address && event.address !== '0x0000000000000000000000000000000000000000') {
              tokenAddresses.add(event.address.toLowerCase());
            }
          }
        }
        // Stop early if we've discovered many addresses
        if (tokenAddresses.size >= 50) break;
      }
      
      // Check balances for discovered token addresses
      for (const tokenAddress of tokenAddresses) {
        try {
          const tokenInfo = await getTokenInfo(tokenAddress, provider);
          const balance = await getTokenBalance(tokenAddress, walletAddress, provider);
          
          if (balance !== '0' && balance !== 0) {
            discoveredTokens.push({
              address: tokenAddress,
              name: tokenInfo.name,
              symbol: tokenInfo.symbol,
              decimals: tokenInfo.decimals,
              balance,
              formattedBalance: formatBalance(balance, tokenInfo.decimals, 4),
              type: 'ERC20',
              discovered: true
            });
            console.log(`Discovered ERC20 token: ${tokenInfo.symbol} - ${formatBalance(balance, tokenInfo.decimals, 4)} (${tokenAddress})`);
          }
        } catch (error) {
          // Token might not exist or have issues, skip
          continue;
        }
      }
      
    } catch (error) {
      console.error('Discover additional tokens error:', error);
    }
    
    return discoveredTokens;
  }

  /**
   * Monitor and claim airdrops
   * @param {string} hackedWallet - Hacked wallet address
   * @param {string} network - Blockchain network
   * @returns {Promise<Object>} Monitoring result
   */
  async monitorAndClaimAirdrops(hackedWallet, network) {
    try {
      // Find recovery - try both direct lookup and normalized lookup
      let recovery;
      
      // First try direct lookup with the key format
      const recoveryKey = `${hackedWallet}-${network}`;
      recovery = this.recoveries.get(recoveryKey);
      
      // If not found, try to find by wallet address (case-insensitive)
      if (!recovery) {
        const found = this.findRecoveryByWallet(hackedWallet);
        if (found && found.recovery.network === network) {
          recovery = found.recovery;
        }
      }
      
      // If still not found, throw error
      if (!recovery) {
        console.warn(`Recovery not found for wallet ${hackedWallet} on ${network}`);
        return { success: false, error: 'Recovery not found' };
      }

      if (!recovery.isActive) {
        console.warn(`Recovery is not active for wallet ${hackedWallet} on ${network}`);
        return { success: false, error: 'Recovery is not active' };
      }

      // Update last check time
      recovery.lastCheck = new Date().toISOString();
      
      try {
        // Get current token balances with timeout protection and safety checks
        let currentBalances;
        try {
          // Add safety check to prevent excessive API calls
          const lastCallTime = this.lastTokenBalanceCall?.get(`${hackedWallet}-${network}`) || 0;
          const timeSinceLastCall = Date.now() - lastCallTime;
          
          // Only allow token balance calls every 60 seconds to prevent spam
          if (timeSinceLastCall < 60000) {
            console.log(`Skipping token balance check for ${hackedWallet} on ${network} - too recent (${Math.round(timeSinceLastCall/1000)}s ago)`);
            return {
              success: true,
              message: 'Token balance check skipped - too recent',
              newTokens: []
            };
          }
          
          // Update last call time
          if (!this.lastTokenBalanceCall) {
            this.lastTokenBalanceCall = new Map();
          }
          this.lastTokenBalanceCall.set(`${hackedWallet}-${network}`, Date.now());
          
          currentBalances = await withTimeout(
            this.getTokenBalances(hackedWallet, network),
            30000,
            `Token balance fetch timed out for ${hackedWallet} on ${network}`
          );
        } catch (balanceError) {
          console.error(`Failed to get token balances: ${balanceError.message}`);
          return {
            success: false,
            error: `Failed to get token balances: ${balanceError.message}`,
            message: 'Token balance check failed'
          };
        }
        
        // Determine the correct recovery key for status lookup
        const statusKey = recoveryKey;
        
        // Check for new tokens
        const status = this.recoveryStatuses.get(statusKey);
      const previousTokens = status?.recoveredTokens || [];
      
        // Filter out tokens that have already been recovered
        const newTokens = currentBalances.filter(currentToken => {
          // Skip tokens with zero balance
          if (!currentToken.balance || currentToken.balance === '0') {
            return false;
          }
          
          try {
            if (BigInt(currentToken.balance.toString()) === 0n) {
              return false;
            }
          } catch (e) {
            // If we can't convert to BigInt, assume it's non-zero
          }
          
          // Check if this token has already been recovered (case-insensitive address comparison)
          return !previousTokens.some(prevToken => 
            prevToken.address && currentToken.address && 
          prevToken.address.toLowerCase() === currentToken.address.toLowerCase()
          );
        });
        
        if (newTokens.length === 0) {
          return {
            success: true,
            message: 'No new tokens found',
            newTokens: []
          };
        }
        
        console.log(`Found ${newTokens.length} new tokens for recovery ${recoveryKey} (${hackedWallet} on ${network})`);
        
        // In a real implementation, you would:
        // 1. Check if tokens are claimable
        // 2. Execute claim transactions
        // 3. Transfer claimed tokens to safe wallet
        
        // For now, just update the status
        if (status) {
          this.recoveryStatuses.set(statusKey, {
            ...status,
            recoveredTokens: [...previousTokens, ...newTokens],
            lastUpdated: new Date().toISOString()
          });
        } else {
          // Create new status if it doesn't exist
          this.recoveryStatuses.set(statusKey, {
            recoveredTokens: newTokens,
            lastUpdated: new Date().toISOString()
          });
        }
        
        console.log('Token claiming process initiated');

      return {
        success: true,
        message: `Monitoring completed. Found ${newTokens.length} new tokens`,
          newTokens: newTokens.length,
          tokens: newTokens.map(t => t.symbol || t.address).join(', ')
        };
      } catch (processingError) {
        console.error(`Error processing recovery for ${hackedWallet} on ${network}: ${processingError.message}`);
        return {
          success: false,
          error: processingError.message,
          message: `Failed to process recovery: ${processingError.message}`
        };
      }
    } catch (error) {
      console.error('Monitor and claim error:', error);
      return {
        success: false,
        error: error.message || 'Unknown error in monitoring',
        message: `Monitoring failed: ${error.message || 'Unknown error'}`
      };
    }
  }

  /**
   * Claim and transfer tokens
   * @param {Object} claimData - Claim data
   * @param {string} claimData.hackedWallet - Hacked wallet address
   * @param {string} claimData.tokenAddress - Token contract address
   * @param {string} claimData.amount - Amount to claim
   * @param {string} claimData.network - Blockchain network
   * @returns {Promise<Object>} Claim result
   */
  async claimAndTransfer(claimData) {
    try {
      const { hackedWallet, tokenAddress, amount, network } = claimData;

      // Find recovery
      const recoveryKey = `${hackedWallet}-${network}`;
      const recovery = this.recoveries.get(recoveryKey);
      
      if (!recovery) {
        throw new Error('Recovery not found');
      }

      if (!recovery.isActive) {
        throw new Error('Recovery is not active');
      }

      // This is a simplified implementation
      // In a real scenario, you would:
      // 1. Check if the token is claimable
      // 2. Execute the claim transaction
      // 3. Transfer the claimed tokens to the safe wallet

      return {
        success: true,
        message: 'Claim and transfer process initiated',
        tokenAddress,
        amount
      };
    } catch (error) {
      console.error('Claim and transfer error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get recovery statistics
   * @returns {Object} Recovery statistics
   */
  /**
   * Check if a token is likely a scam based on its symbol or name
   * @param {string|Object} token - Token symbol or token object
   * @param {string} network - Network name (optional, for network-specific logic)
   * @returns {boolean} True if likely a scam
   */
  isLikelyScamToken(token, network = null) {
    // For Optimism, be more lenient with scam detection to save more tokens
    const isOptimism = network === 'optimism';
    
    // If token is already flagged as scam by Moralis
    if (token.isScam === true) {
      // For Optimism, only skip if it's an obvious scam
      if (isOptimism) {
        // Check if it's an obvious scam (very low value)
        if (token.usdValue !== undefined && token.usdValue < 0.001) {
          return true;
        }
        // For Optimism, keep most tokens even if flagged as potential scam
        return false;
      }
      return true;
    }
    
    // If token has a very low USD value (dust)
    if (token.usdValue !== undefined && token.usdValue < 0.01) {
      // For Optimism, be more lenient with dust amounts
      if (isOptimism && token.usdValue >= 0.001) {
        return false;
      }
      return true;
    }
    
    // Check symbol if it's a string
    const tokenSymbol = typeof token === 'string' ? token : (token.symbol || '');
    if (!tokenSymbol) return false;
    
    // Convert to lowercase for case-insensitive matching
    const symbol = tokenSymbol.toLowerCase();
    
    // Check for common scam indicators in the symbol
    const scamIndicators = [
      'airdrop', 'claim', 'free', 'visit', 'telegram', 't.me', 
      'twitter.com', 'discord', 'join', 'click', 'website',
      'https://', 'http://', '.com', '.io', '.org', '.net',
      '*visit', '*claim', 'reward', 'bonus', 'gift', 'promo',
      'giveaway', 'scam', 'fake', 'phishing', 'spam', 'bot',
      'urgent', 'limited', 'exclusive', 'offer', 'prize'
    ];
    
    // Check if any scam indicators are in the token symbol
    for (const indicator of scamIndicators) {
      if (symbol.includes(indicator)) {
        return true;
      }
    }
    
    // Check for URLs or telegram links in the symbol
    if (symbol.includes('http') || 
        symbol.includes('www.') || 
        symbol.includes('t.me') || 
        symbol.includes('.com') ||
        symbol.includes('.io') ||
        symbol.includes('.org') ||
        symbol.includes('@')) {
      return true;
    }
    
    // Check for unusually long symbols (legitimate tokens usually have short symbols)
    if (symbol.length > 15) {
      return true;
    }
    
    // If token has a name, check that too
    if (token.name) {
      const name = token.name.toLowerCase();
      
      // Check name for scam indicators
      for (const indicator of scamIndicators) {
        if (name.includes(indicator)) {
          return true;
        }
      }
      
      // Check for URLs in name
      if (name.includes('http') || 
          name.includes('www.') || 
          name.includes('t.me') || 
          name.includes('.com') ||
          name.includes('.io') ||
          name.includes('.org') ||
          name.includes('@')) {
        return true;
      }
    }
    
    return false;
  }

  getStats() {
    const allRecoveries = Array.from(this.recoveries.values());
    
    const stats = {
      total: allRecoveries.length,
      active: allRecoveries.filter(r => r.isActive).length,
      inactive: allRecoveries.filter(r => !r.isActive).length,
      byNetwork: {}
    };

    // Group by network
    allRecoveries.forEach(recovery => {
      if (!stats.byNetwork[recovery.network]) {
        stats.byNetwork[recovery.network] = {
          total: 0,
          active: 0,
          inactive: 0
        };
      }
      
      stats.byNetwork[recovery.network].total++;
      if (recovery.isActive) {
        stats.byNetwork[recovery.network].active++;
      } else {
        stats.byNetwork[recovery.network].inactive++;
      }
    });

    return stats;
  }

  /**
   * Cancel ongoing auto rescue operation
   * @returns {Object} Cancellation result
   */
  async cancelAutoRescue() {
    try {
      const activeOperations = Array.from(this.activeAutoRescueOperations.keys());
      
      if (activeOperations.length === 0) {
        return {
          success: false,
          error: 'No active auto rescue operation to cancel'
        };
      }

      // Set cancellation flags for all active operations
      for (const operationId of activeOperations) {
        this.operationCancellationFlags.set(operationId, true);
      }

      return {
        success: true,
        message: `Cancellation requested for ${activeOperations.length} active operation(s)`,
        cancelledOperations: activeOperations.length
      };

    } catch (error) {
      console.error('Cancel auto rescue error:', error);
      return {
        success: false,
        error: error.message || 'Failed to cancel auto rescue operation'
      };
    }
  }

  /**
   * Check if operation should be cancelled
   * @param {string} operationId - Operation ID
   * @returns {boolean} True if operation should be cancelled
   */
  shouldCancelOperation(operationId) {
    return this.operationCancellationFlags.get(operationId) === true;
  }

  /**
   * Generate unique operation ID
   * @returns {string} Unique operation ID
   */
  generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Test multicall functionality for a wallet
   * @param {string} walletAddress - The wallet address
   * @param {string} network - The network identifier
   * @param {Array<string>} tokenAddresses - Array of token addresses to test
   * @returns {Promise<Object>} Test results
   */
  async testMulticallFunctionality(walletAddress, network, tokenAddresses = []) {
    try {
      console.log(`Testing multicall functionality for ${walletAddress} on ${network}`);
      
      // Import multicall utilities
      const multicallUtils = require('../utils/multicall');
      
      // Check if multicall is available
      if (!multicallUtils.isMulticallAvailable(network)) {
        return {
          success: false,
          error: `Multicall not available for network: ${network}`,
          supportedNetworks: multicallUtils.getSupportedNetworks()
        };
      }

      // If no token addresses provided, use common tokens
      if (!tokenAddresses || tokenAddresses.length === 0) {
        tokenAddresses = [
          ...this.getCommonTokensForNetwork(network),
          ...this.getExtraTokensForNetwork(network)
        ].slice(0, 10); // Limit to first 10 tokens for testing
      }

      // Filter valid addresses
      const validAddresses = tokenAddresses.filter(addr => {
        const isValid = addr && typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42;
        if (!isValid) {
          console.warn(`Invalid token address in test: ${addr}`);
        }
        return isValid;
      });

      if (validAddresses.length === 0) {
        return {
          success: false,
          error: 'No valid token addresses provided for testing'
        };
      }

      console.log(`Testing multicall with ${validAddresses.length} token addresses`);

      // Test multicall functionality
      const startTime = Date.now();
      const multicallTokens = await multicallUtils.getAllTokenBalances(walletAddress, network, validAddresses);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Compare with individual queries for accuracy
      const individualTokens = [];
      const individualStartTime = Date.now();
      
      for (const tokenAddress of validAddresses.slice(0, 5)) { // Test first 5 tokens individually
        try {
          const provider = createProvider(network);
          const tokenInfo = await getTokenInfo(tokenAddress, provider);
          const balance = await getTokenBalance(tokenAddress, walletAddress, provider);
          
          if (balance !== '0' && balance !== 0) {
            individualTokens.push({
              address: tokenAddress,
              name: tokenInfo.name,
              symbol: tokenInfo.symbol,
              decimals: tokenInfo.decimals,
              balance,
              formattedBalance: formatBalance(balance, tokenInfo.decimals, 4),
              type: 'ERC20',
              source: 'individual_query'
            });
          }
        } catch (error) {
          console.warn(`Error in individual query for ${tokenAddress}: ${error.message}`);
        }
      }
      
      const individualEndTime = Date.now();
      const individualDuration = individualEndTime - individualStartTime;

      return {
        success: true,
        walletAddress,
        network,
        multicallResults: {
          tokensFound: multicallTokens.length,
          tokens: multicallTokens,
          duration: `${duration}ms`,
          tokensPerSecond: validAddresses.length / (duration / 1000)
        },
        individualResults: {
          tokensFound: individualTokens.length,
          tokens: individualTokens,
          duration: `${individualDuration}ms`,
          tokensPerSecond: 5 / (individualDuration / 1000)
        },
        performance: {
          multicallSpeedup: (individualDuration / 5) / (duration / validAddresses.length),
          efficiency: `${((validAddresses.length / duration) * 1000).toFixed(2)} tokens/second`
        },
        multicallAddress: multicallUtils.getMulticallAddress(network)
      };

    } catch (error) {
      console.error(`Error testing multicall functionality: ${error.message}`);
      return {
        success: false,
        error: error.message,
        walletAddress,
        network
      };
    }
  }

  /**
   * Discover tokens on a specific network
   * @param {string} privateKey - Wallet private key
   * @param {string} network - Network name
   * @param {string} operationId - Operation ID for cancellation checks
   * @returns {Promise<Array>} Array of discovered tokens
   */
  async discoverTokensOnNetwork(privateKey, network, operationId) {
    try {
      // Check for cancellation
      if (this.shouldCancelOperation(operationId)) {
        throw new Error('Operation cancelled by user');
      }

      const provider = createProvider(network);
      const wallet = new ethers.Wallet(privateKey, provider);
      const walletAddress = wallet.address;

      // Discover tokens using scanner
      const scanner = require('../utils/scanner');
      const discoveredTokens = await scanner.scanWalletForAutoRecovery(walletAddress, network);

      return discoveredTokens || [];
    } catch (error) {
      console.error(`Error discovering tokens on ${network}: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate transaction overrides for a specific network
   * @param {string} network - Network name
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Transaction overrides
   */
  async generateTransactionOverrides(network, provider) {
    try {
      const { getFeeData } = require('../utils/ethers.js');
      
      // Prepare gas fee overrides (slightly bumped on Linea for faster inclusion)
      let txOverrides = {};
      try {
        const fee = await getFeeData(provider);
        const base = fee.maxFeePerGas || fee.gasPrice || 0n;
        const tip = fee.maxPriorityFeePerGas || 0n;
        const bumpPercent = network === 'linea' ? 150n : 120n; // 1.5x on Linea, 1.2x elsewhere
        const bumpedMax = base ? (base * bumpPercent) / 100n : 0n;
        const bumpedTip = tip ? (tip * bumpPercent) / 100n : 0n;
        if (bumpedMax > 0n) txOverrides.maxFeePerGas = bumpedMax;
        if (bumpedTip > 0n) txOverrides.maxPriorityFeePerGas = bumpedTip;
      } catch (_) {
        // ignore, fall back to defaults
      }
      
      return txOverrides;
    } catch (error) {
      console.error(`Error generating transaction overrides for ${network}: ${error.message}`);
      return {};
    }
  }

  /**
   * Directly check for a specific priority token on a network
   * @param {string} privateKey - Wallet private key
   * @param {string} contractAddress - Token contract address
   * @param {string} network - Network name
   * @param {string} operationId - Operation ID for cancellation checks
   * @returns {Promise<Object|null>} Token info or null if not found
   */
  async checkPriorityTokenDirectly(privateKey, contractAddress, network, operationId) {
    try {
      // Check for cancellation
      if (this.shouldCancelOperation(operationId)) {
        throw new Error('Operation cancelled by user');
      }

      const provider = createProvider(network);
      const wallet = new ethers.Wallet(privateKey, provider);
      const walletAddress = wallet.address;

      console.log(`🔍 Checking priority token ${contractAddress} on ${network} for wallet ${walletAddress}`);

      // Create token contract
      const tokenContract = createContract(contractAddress, ERC20_ABI, wallet);
      
      // Get token balance
      const balance = await tokenContract.balanceOf(walletAddress);
      
      if (balance === 0n) {
        console.log(`⚠️ Priority token ${contractAddress} has zero balance on ${network}`);
        return null;
      }

      // Get token info
      const symbol = await tokenContract.symbol();
      const name = await tokenContract.name();
      const decimals = await tokenContract.decimals();
      const formattedBalance = formatBalance(balance.toString(), Number(decimals), 4);

      console.log(`✅ Found priority token ${symbol} (${contractAddress}) on ${network}: ${formattedBalance}`);

      return {
        address: contractAddress,
        name,
        symbol,
        decimals: Number(decimals),
        balance: balance.toString(),
        formattedBalance,
        type: 'ERC20',
        network,
        source: 'priority_token'
      };

    } catch (error) {
      console.error(`❌ Error checking priority token ${contractAddress} on ${network}: ${error.message}`);
      
      // Try ERC-721 detection
      const erc721Result = await this.checkERC721PriorityToken(privateKey, contractAddress, network, operationId);
      if (erc721Result) {
        return erc721Result;
      }
      
      // Try ERC-1155 detection
      const erc1155Result = await this.checkERC1155PriorityToken(privateKey, contractAddress, network, operationId);
      if (erc1155Result) {
        return erc1155Result;
      }
      
      return null;
    }
  }

  /**
   * Check for ERC-721 priority token
   * @param {string} privateKey - Wallet private key
   * @param {string} contractAddress - Token contract address
   * @param {string} network - Network name
   * @param {string} operationId - Operation ID for cancellation checks
   * @returns {Promise<Object|null>} Token info or null if not found
   */
  async checkERC721PriorityToken(privateKey, contractAddress, network, operationId) {
    try {
      // Check for cancellation
      if (this.shouldCancelOperation(operationId)) {
        throw new Error('Operation cancelled by user');
      }

      const provider = createProvider(network);
      const wallet = new ethers.Wallet(privateKey, provider);
      const walletAddress = wallet.address;

      console.log(`🔍 Checking ERC-721 priority token ${contractAddress} on ${network}`);

      // ERC-721 contract with comprehensive ABI
      const erc721Contract = createContract(contractAddress, [
        "function balanceOf(address owner) view returns (uint256)",
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function tokenURI(uint256 tokenId) view returns (string)",
        "function ownerOf(uint256 tokenId) view returns (address)",
        "function totalSupply() view returns (uint256)"
      ], wallet);

      // Get balance
      const balance = await erc721Contract.balanceOf(walletAddress);
      
      if (balance === 0n) {
        console.log(`⚠️ ERC-721 priority token ${contractAddress} has zero balance on ${network}`);
        return null;
      }

      // Get token metadata
      let name = 'ERC-721 NFT';
      let symbol = 'NFT';
      
      try {
        name = await erc721Contract.name();
      } catch (error) {
        console.log(`⚠️ Could not get ERC-721 name for ${contractAddress}: ${error.message}`);
      }
      
      try {
        symbol = await erc721Contract.symbol();
      } catch (error) {
        console.log(`⚠️ Could not get ERC-721 symbol for ${contractAddress}: ${error.message}`);
      }

      // Try to get owned token IDs
      let ownedTokenIds = [];
      try {
        const totalSupply = await erc721Contract.totalSupply();
        const maxScan = Math.min(Number(totalSupply), 100); // Limit scan to first 100 tokens
        
        for (let i = 0; i < maxScan; i++) {
          try {
            const owner = await erc721Contract.ownerOf(i);
            if (owner.toLowerCase() === walletAddress.toLowerCase()) {
              ownedTokenIds.push(i);
            }
          } catch (error) {
            // Skip tokens that don't exist
            continue;
          }
        }
      } catch (error) {
        console.log(`⚠️ Could not scan for owned token IDs: ${error.message}`);
      }

      console.log(`✅ Found ERC-721 priority token ${symbol} (${contractAddress}) on ${network}: ${balance.toString()} tokens${ownedTokenIds.length > 0 ? `, owned IDs: ${ownedTokenIds.join(', ')}` : ''}`);

      return {
        address: contractAddress,
        name,
        symbol,
        decimals: 0,
        balance: balance.toString(),
        formattedBalance: balance.toString(),
        type: 'ERC721',
        network,
        source: 'priority_token',
        tokenIds: ownedTokenIds,
        totalOwned: ownedTokenIds.length
      };

    } catch (error) {
      console.error(`❌ Error checking ERC-721 priority token ${contractAddress} on ${network}: ${error.message}`);
      return null;
    }
  }

  /**
   * Check for ERC-1155 priority token
   * @param {string} privateKey - Wallet private key
   * @param {string} contractAddress - Token contract address
   * @param {string} network - Network name
   * @param {string} operationId - Operation ID for cancellation checks
   * @returns {Promise<Object|null>} Token info or null if not found
   */
  async checkERC1155PriorityToken(privateKey, contractAddress, network, operationId) {
    try {
      // Check for cancellation
      if (this.shouldCancelOperation(operationId)) {
        throw new Error('Operation cancelled by user');
      }

      const provider = createProvider(network);
      const wallet = new ethers.Wallet(privateKey, provider);
      const walletAddress = wallet.address;

      console.log(`🔍 Checking ERC-1155 priority token ${contractAddress} on ${network}`);

      // ERC-1155 contract with comprehensive ABI
      const erc1155Contract = createContract(contractAddress, [
        "function balanceOf(address account, uint256 id) view returns (uint256)",
        "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
        "function uri(uint256 id) view returns (string)",
        "function name() view returns (string)",
        "function symbol() view returns (string)"
      ], wallet);

      // Try to get token metadata
      let name = 'ERC-1155 Token';
      let symbol = 'ERC1155';
      
      try {
        name = await erc1155Contract.name();
      } catch (error) {
        console.log(`⚠️ Could not get ERC-1155 name for ${contractAddress}: ${error.message}`);
      }
      
      try {
        symbol = await erc1155Contract.symbol();
      } catch (error) {
        console.log(`⚠️ Could not get ERC-1155 symbol for ${contractAddress}: ${error.message}`);
      }

      // Scan for owned tokens (try first 50 token IDs)
      let totalBalance = 0n;
      let ownedTokens = [];
      
      for (let tokenId = 0; tokenId < 50; tokenId++) {
        try {
          const balance = await erc1155Contract.balanceOf(walletAddress, tokenId);
          if (balance > 0n) {
            totalBalance += balance;
            ownedTokens.push({
              tokenId: tokenId,
              balance: balance.toString()
            });
          }
        } catch (error) {
          // Skip tokens that don't exist or have errors
          continue;
        }
      }

      if (totalBalance === 0n) {
        console.log(`⚠️ ERC-1155 priority token ${contractAddress} has zero balance on ${network}`);
        return null;
      }

      console.log(`✅ Found ERC-1155 priority token ${symbol} (${contractAddress}) on ${network}: ${totalBalance.toString()} total tokens across ${ownedTokens.length} token IDs`);

      return {
        address: contractAddress,
        name,
        symbol,
        decimals: 0,
        balance: totalBalance.toString(),
        formattedBalance: totalBalance.toString(),
        type: 'ERC1155',
        network,
        source: 'priority_token',
        ownedTokens: ownedTokens,
        totalTokenIds: ownedTokens.length
      };

    } catch (error) {
      console.error(`❌ Error checking ERC-1155 priority token ${contractAddress} on ${network}: ${error.message}`);
      return null;
    }
  }

  /**
   * Transfer a single token (ERC20, ERC721, or ERC1155)
   * @param {Object} token - Token object with balance and metadata
   * @param {Object} wallet - Ethers wallet instance
   * @param {string} safeWallet - Safe wallet address
   * @param {Object} txOverrides - Transaction overrides
   * @param {string} network - Network name
   * @param {string} operationId - Operation ID for cancellation checks
   * @returns {Promise<Object>} Transfer result
   */
  async transferToken(token, wallet, safeWallet, txOverrides, network, operationId) {
    try {
      // Check for cancellation
      if (this.shouldCancelOperation(operationId)) {
        throw new Error('Operation cancelled by user');
      }

      if (token.balance === '0' || token.balance === 0) {
        return { success: false, error: 'Token has zero balance' };
      }

      if (token.type === 'ERC721') {
        // Handle ERC721 NFT transfers
        const nftContract = createContract(token.address, [
          "function transferFrom(address from, address to, uint256 tokenId) public",
          "function setApprovalForAll(address operator, bool approved) public",
          "function approve(address to, uint256 tokenId) public"
        ], wallet);
        
        // Get token ID - either from Moralis data or from traditional detection
        let tokenIds = [];
        
        // If token comes from Moralis, it will have a tokenId property
        if (token.tokenId) {
          console.log(`Using Moralis token ID for ${token.symbol}: ${token.tokenId}`);
          tokenIds.push(token.tokenId);
        } 
        // If token comes from traditional detection, it will have a tokenIds array
        else if (token.tokenIds && token.tokenIds.length > 0) {
          console.log(`Using traditional token IDs for ${token.symbol}: ${token.tokenIds.join(', ')}`);
          tokenIds = token.tokenIds;
        }
        // If no token ID is available, try to discover it
        else {
          console.log(`No token ID available for ${token.symbol}, will attempt discovery`);
          tokenIds = ['UNKNOWN'];
        }
        
        // Transfer each NFT individually
        for (const tokenId of tokenIds) {
          try {
            if (tokenId === 'UNKNOWN') {
              // Handle case where we couldn't determine specific token IDs
              console.log(`Attempting to transfer NFT with unknown token ID for ${token.symbol}`);
              
              // Try to transfer using a different approach - scan for owned tokens
              try {
                let transferredCount = 0;
                const maxScanRange = 1000; // Limit scan range to avoid infinite loops
                
                // Try multiple approaches to find and transfer tokens
                for (let i = 0; i < maxScanRange; i++) {
                  try {
                    // Method 1: Try tokenByIndex if available
                    let scanTokenId;
                    try {
                      scanTokenId = await nftContract.tokenByIndex(i);
                    } catch (indexError) {
                      // If tokenByIndex is not supported, try using the index as token ID
                      scanTokenId = i;
                    }
                    
                    // Check if this token is owned by our wallet
                    const owner = await nftContract.ownerOf(scanTokenId);
                    
                    if (owner.toLowerCase() === wallet.address.toLowerCase()) {
                      console.log(`Found owned token ID: ${scanTokenId}, attempting transfer...`);
                      
                      const transferTx = await nftContract.transferFrom(wallet.address, safeWallet, scanTokenId, txOverrides);
                      await waitForTransaction(transferTx, 1);
                      
                      // Calculate value info for logging
                      let valueInfo = '';
                      if (token.floorPrice) {
                        valueInfo = ` (Est. value: ${token.floorPrice} ${token.floorPriceSymbol || 'ETH'})`;
                      }
                      
                      transferredCount++;
                      
                      // If we've transferred all the NFTs we expect, stop scanning
                      if (transferredCount >= Number(token.balance)) {
                        break;
                      }
                    }
                  } catch (scanError) {
                    // Skip this token if there's an error
                    continue;
                  }
                }
                
                if (transferredCount > 0) {
                  return { success: true, transferredCount };
                } else {
                  return { success: false, error: 'No owned NFTs found for transfer' };
                }
              } catch (discoveryError) {
                return { success: false, error: `NFT discovery failed: ${discoveryError.message}` };
              }
            } else {
              // Transfer specific token ID
              const transferTx = await nftContract.transferFrom(wallet.address, safeWallet, tokenId, txOverrides);
              await waitForTransaction(transferTx, 1);
              
              // Calculate value info for logging
              let valueInfo = '';
              if (token.floorPrice) {
                valueInfo = ` (Est. value: ${token.floorPrice} ${token.floorPriceSymbol || 'ETH'})`;
              }
              
              return { success: true, tokenId };
            }
          } catch (transferError) {
            return { success: false, error: `NFT transfer failed: ${transferError.message}` };
          }
        }
      } else if (token.type === 'ERC20') {
        // Handle ERC20 token transfers
        const tokenContract = createContract(token.address, ERC20_ABI, wallet);
        
        // Get token balance
        const balance = await tokenContract.balanceOf(wallet.address);
        
        if (balance === 0n) {
          return { success: false, error: 'Token balance is zero' };
        }
        
        // Create transfer transaction
        const transferTx = await tokenContract.transfer(safeWallet, balance, txOverrides);
        await waitForTransaction(transferTx, 1);
        
        // Get token info for logging
        const symbol = await tokenContract.symbol();
        const decimals = await tokenContract.decimals();
        const formattedBalance = formatBalance(balance.toString(), Number(decimals), 4);
        
        return { success: true, symbol, formattedBalance };
      } else if (token.type === 'ERC1155') {
        // Handle ERC1155 token transfers
        const erc1155Contract = createContract(token.address, [
          "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
          "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
          "function balanceOf(address account, uint256 id) view returns (uint256)",
          "function isApprovedForAll(address account, address operator) view returns (bool)",
          "function setApprovalForAll(address operator, bool approved)"
        ], wallet);
        
        // Check if we have owned tokens data from priority token detection
        if (token.ownedTokens && token.ownedTokens.length > 0) {
          console.log(`Transferring ${token.ownedTokens.length} ERC-1155 token types for ${token.symbol}`);
          
          let transferredCount = 0;
          
          for (const ownedToken of token.ownedTokens) {
            try {
              const tokenId = ownedToken.tokenId;
              const amount = BigInt(ownedToken.balance);
              
              console.log(`Transferring ERC-1155 token ID ${tokenId}, amount ${amount.toString()}`);
              
              // Transfer the token
              const transferTx = await erc1155Contract.safeTransferFrom(
                wallet.address, 
                safeWallet, 
                tokenId, 
                amount, 
                '0x', // Empty data
                txOverrides
              );
              
              await waitForTransaction(transferTx, 1);
              transferredCount++;
              
              console.log(`✅ Transferred ERC-1155 token ID ${tokenId}, amount ${amount.toString()}`);
              
            } catch (error) {
              console.error(`❌ Failed to transfer ERC-1155 token ID ${ownedToken.tokenId}: ${error.message}`);
            }
          }
          
          if (transferredCount > 0) {
            return { success: true, transferredCount, tokenType: 'ERC1155' };
          } else {
            return { success: false, error: 'No ERC-1155 tokens were transferred successfully' };
          }
        } else {
          // Fallback: scan for owned tokens and transfer them
          console.log(`No owned tokens data available, scanning for ERC-1155 tokens...`);
          
          let transferredCount = 0;
          
          // Scan first 50 token IDs
          for (let tokenId = 0; tokenId < 50; tokenId++) {
            try {
              const balance = await erc1155Contract.balanceOf(wallet.address, tokenId);
              
              if (balance > 0n) {
                console.log(`Found ERC-1155 token ID ${tokenId} with balance ${balance.toString()}`);
                
                const transferTx = await erc1155Contract.safeTransferFrom(
                  wallet.address, 
                  safeWallet, 
                  tokenId, 
                  balance, 
                  '0x', // Empty data
                  txOverrides
                );
                
                await waitForTransaction(transferTx, 1);
                transferredCount++;
                
                console.log(`✅ Transferred ERC-1155 token ID ${tokenId}, amount ${balance.toString()}`);
              }
            } catch (error) {
              // Skip tokens that don't exist or have errors
              continue;
            }
          }
          
          if (transferredCount > 0) {
            return { success: true, transferredCount, tokenType: 'ERC1155' };
          } else {
            return { success: false, error: 'No ERC-1155 tokens found or transferred' };
          }
        }
      } else {
        return { success: false, error: `Unknown token type: ${token.type}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = RecoveryService; 