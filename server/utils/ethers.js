/**
 * Server-side ethers.js utility functions
 * Centralized ethers v6 handling with proper error management
 */

const { ethers } = require('ethers');
const { getNetworkConfig, getRpcUrl } = require('../config/networks.js');

/**
 * Create a provider instance for a given network
 * @param {string} networkId - The network identifier
 * @param {string} rpcUrl - Optional custom RPC URL
 * @returns {ethers.Provider} Provider instance
 */
const createProvider = (networkId, rpcUrl = null) => {
  try {
    const network = getNetworkConfig(networkId);
    if (!network) {
      throw new Error(`Unsupported network: ${networkId}`);
    }

    const url = rpcUrl || network.rpcUrl;
    return new ethers.JsonRpcProvider(url);
  } catch (error) {
    throw new Error(`Failed to create provider for ${networkId}: ${error.message}`);
  }
};

/**
 * Create a fallback provider with multiple RPC endpoints
 * @param {string} networkId - The network identifier
 * @returns {ethers.FallbackProvider} Fallback provider instance
 */
const createFallbackProvider = (networkId) => {
  try {
    const network = getNetworkConfig(networkId);
    if (!network) {
      throw new Error(`Unsupported network: ${networkId}`);
    }

    const providers = [];
    
    // Primary RPC
    if (network.rpcUrl) {
      providers.push(new ethers.JsonRpcProvider(network.rpcUrl));
    }
    
    // Secondary RPC
    if (network.rpcUrl2) {
      providers.push(new ethers.JsonRpcProvider(network.rpcUrl2));
    }

    if (providers.length === 0) {
      throw new Error(`No RPC URLs configured for network: ${networkId}`);
    }

    if (providers.length === 1) {
      return providers[0];
    }

    // Create fallback provider with weights
    const weights = providers.map((_, index) => index === 0 ? 2 : 1); // Primary gets higher weight
    return new ethers.FallbackProvider(providers, 1); // Require at least 1 provider
  } catch (error) {
    throw new Error(`Failed to create fallback provider for ${networkId}: ${error.message}`);
  }
};

/**
 * Create a wallet instance from private key
 * @param {string} privateKey - The private key
 * @param {ethers.Provider} provider - The provider instance
 * @returns {ethers.Wallet} Wallet instance
 */
const createWallet = (privateKey, provider) => {
  try {
    if (!privateKey) {
      throw new Error('Private key is required');
    }
    
    if (!provider) {
      throw new Error('Provider is required');
    }

    return new ethers.Wallet(privateKey, provider);
  } catch (error) {
    throw new Error(`Failed to create wallet: ${error.message}`);
  }
};

/**
 * Create a contract instance
 * @param {string} contractAddress - The contract address
 * @param {Array} abi - The contract ABI
 * @param {ethers.Signer|ethers.Provider} signerOrProvider - Signer or provider
 * @returns {ethers.Contract} Contract instance
 */
const createContract = (contractAddress, abi, signerOrProvider) => {
  try {
    if (!ethers.isAddress(contractAddress)) {
      throw new Error(`Invalid contract address: ${contractAddress}`);
    }

    if (!Array.isArray(abi)) {
      throw new Error('ABI must be an array');
    }

    if (!signerOrProvider) {
      throw new Error('Signer or provider is required');
    }

    return new ethers.Contract(contractAddress, abi, signerOrProvider);
  } catch (error) {
    throw new Error(`Failed to create contract: ${error.message}`);
  }
};

/**
 * Get wallet balance in ETH
 * @param {string} address - The wallet address
 * @param {ethers.Provider} provider - The provider instance
 * @returns {Promise<string>} Balance in wei as string
 */
const getBalance = async (address, provider) => {
  try {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }

    const balance = await provider.getBalance(address);
    return balance.toString();
  } catch (error) {
    throw new Error(`Failed to get balance for ${address}: ${error.message}`);
  }
};

/**
 * Get transaction count (nonce) for an address
 * @param {string} address - The wallet address
 * @param {ethers.Provider} provider - The provider instance
 * @returns {Promise<number>} Transaction count
 */
const getTransactionCount = async (address, provider) => {
  try {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }

    return await provider.getTransactionCount(address);
  } catch (error) {
    throw new Error(`Failed to get transaction count for ${address}: ${error.message}`);
  }
};

/**
 * Get fee data for a network
 * @param {ethers.Provider} provider - The provider instance
 * @returns {Promise<Object>} Fee data object
 */
const getFeeData = async (provider) => {
  try {
    return await provider.getFeeData();
  } catch (error) {
    throw new Error(`Failed to get fee data: ${error.message}`);
  }
};

/**
 * Wait for a transaction to be mined
 * @param {ethers.ContractTransactionResponse} transaction - The transaction response
 * @param {number} confirmations - Number of confirmations to wait for
 * @returns {Promise<ethers.ContractTransactionReceipt>} Transaction receipt
 */
const waitForTransaction = async (transaction, confirmations = 1) => {
  try {
    if (!transaction) {
      throw new Error('Transaction is required');
    }

    return await transaction.wait(confirmations);
  } catch (error) {
    throw new Error(`Failed to wait for transaction: ${error.message}`);
  }
};

/**
 * Format balance from wei to a readable format
 * @param {string|bigint} balance - Balance in wei
 * @param {number} decimals - Token decimals (default: 18)
 * @param {number} displayDecimals - Number of decimal places to display (default: 4)
 * @returns {string} Formatted balance
 */
const formatBalance = (balance, decimals = 18, displayDecimals = 4) => {
  try {
    if (!balance) return '0';
    
    // Ensure decimals is a number
    const numDecimals = Number(decimals);
    const numDisplayDecimals = Number(displayDecimals);
    
    // Convert balance to BigInt safely
    let balanceBigInt;
    if (typeof balance === 'bigint') {
      balanceBigInt = balance;
    } else if (typeof balance === 'string') {
      balanceBigInt = BigInt(balance);
    } else {
      balanceBigInt = BigInt(balance.toString());
    }
    
    const divisor = BigInt(10 ** numDecimals);
    const whole = balanceBigInt / divisor;
    const fraction = balanceBigInt % divisor;
    
    if (fraction === 0n) {
      return whole.toString();
    }
    
    const fractionStr = fraction.toString().padStart(numDecimals, '0');
    const displayFraction = fractionStr.slice(0, numDisplayDecimals).replace(/0+$/, '');
    
    return displayFraction ? `${whole}.${displayFraction}` : whole.toString();
  } catch (error) {
    console.error('Error formatting balance:', error);
    return '0';
  }
};

/**
 * Parse balance from human readable format to wei
 * @param {string} amount - Amount in human readable format
 * @param {number} decimals - Token decimals (default: 18)
 * @returns {bigint} Amount in wei
 */
const parseBalance = (amount, decimals = 18) => {
  try {
    if (!amount || amount === '0') return 0n;
    
    return ethers.parseUnits(amount, decimals);
  } catch (error) {
    throw new Error(`Failed to parse balance: ${error.message}`);
  }
};

/**
 * Validate Ethereum address
 * @param {string} address - The address to validate
 * @returns {boolean} True if valid, false otherwise
 */
const isValidAddress = (address) => {
  try {
    return ethers.isAddress(address);
  } catch {
    return false;
  }
};

/**
 * Get checksummed address
 * @param {string} address - The address to checksum
 * @returns {string} Checksummed address
 */
const getChecksumAddress = (address) => {
  try {
    if (!isValidAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }
    return ethers.getAddress(address);
  } catch (error) {
    throw new Error(`Failed to get checksum address: ${error.message}`);
  }
};

/**
 * Create a transaction request object
 * @param {Object} params - Transaction parameters
 * @param {string} params.to - Recipient address
 * @param {string|bigint} params.value - Value in wei
 * @param {string} params.data - Transaction data (optional)
 * @param {bigint} params.gasLimit - Gas limit (optional)
 * @param {bigint} params.gasPrice - Gas price (optional)
 * @param {bigint} params.maxFeePerGas - Max fee per gas (optional)
 * @param {bigint} params.maxPriorityFeePerGas - Max priority fee per gas (optional)
 * @returns {Object} Transaction request object
 */
const createTransactionRequest = (params) => {
  const request = {};
  
  if (params.to) {
    request.to = getChecksumAddress(params.to);
  }
  
  if (params.value) {
    request.value = typeof params.value === 'string' ? BigInt(params.value) : params.value;
  }
  
  if (params.data) {
    request.data = params.data;
  }
  
  if (params.gasLimit) {
    request.gasLimit = typeof params.gasLimit === 'string' ? BigInt(params.gasLimit) : params.gasLimit;
  }
  
  if (params.gasPrice) {
    request.gasPrice = typeof params.gasPrice === 'string' ? BigInt(params.gasPrice) : params.gasPrice;
  }
  
  if (params.maxFeePerGas) {
    request.maxFeePerGas = typeof params.maxFeePerGas === 'string' ? BigInt(params.maxFeePerGas) : params.maxFeePerGas;
  }
  
  if (params.maxPriorityFeePerGas) {
    request.maxPriorityFeePerGas = typeof params.maxPriorityFeePerGas === 'string' ? BigInt(params.maxPriorityFeePerGas) : params.maxPriorityFeePerGas;
  }
  
  return request;
};

/**
 * Estimate gas for a transaction
 * @param {ethers.Provider} provider - The provider instance
 * @param {Object} transactionRequest - The transaction request
 * @returns {Promise<bigint>} Estimated gas limit
 */
/**
 * Network-specific default gas limits for different transaction types
 */
const DEFAULT_GAS_LIMITS = {
  // Default gas limits by network
  mainnet: {
    erc20Transfer: 100000n,      // Increased for better reliability
    erc721Transfer: 250000n,     // Increased for better reliability
    erc1155Transfer: 300000n,    // Increased for better reliability
    ethTransfer: 30000n,         // Increased from 21000 to handle potential complexity
    approve: 70000n,             // Increased for better reliability
    default: 150000n             // Increased general default
  },
  arbitrum: {
    erc20Transfer: 800000n,      // Significantly increased for Arbitrum's complexity
    erc721Transfer: 1200000n,    // Significantly increased for Arbitrum's complexity
    erc1155Transfer: 1500000n,   // Significantly increased for Arbitrum's complexity
    ethTransfer: 200000n,        // Doubled for safety
    approve: 600000n,            // Increased for better reliability
    default: 1000000n            // Increased general default
  },
  optimism: {
    erc20Transfer: 500000n,      // Even more aggressive for Optimism
    erc721Transfer: 700000n,     // Even more aggressive for Optimism
    erc1155Transfer: 900000n,    // Even more aggressive for Optimism
    ethTransfer: 150000n,        // More aggressive for Optimism
    approve: 350000n,            // More aggressive for Optimism
    default: 600000n             // More aggressive general default for Optimism
  },
  base: {
    erc20Transfer: 350000n,      // Significantly increased for better reliability
    erc721Transfer: 500000n,     // Significantly increased for better reliability
    erc1155Transfer: 650000n,    // Significantly increased for better reliability
    ethTransfer: 100000n,        // Doubled for safety
    approve: 250000n,            // Increased for better reliability
    default: 400000n             // Increased general default
  },
  linea: {
    erc20Transfer: 250000n,      // Significantly increased for better reliability
    erc721Transfer: 400000n,     // Significantly increased for better reliability
    erc1155Transfer: 550000n,    // Significantly increased for better reliability
    ethTransfer: 80000n,         // Doubled for safety
    approve: 200000n,            // Increased for better reliability
    default: 300000n             // Increased general default
  },
  polygon: {
    erc20Transfer: 200000n,      // Doubled for better reliability
    erc721Transfer: 350000n,     // Significantly increased for better reliability
    erc1155Transfer: 500000n,    // Significantly increased for better reliability
    ethTransfer: 60000n,         // Doubled for safety
    approve: 150000n,            // Significantly increased for better reliability
    default: 250000n             // Increased general default
  },
  // Default fallback for any network not listed
  default: {
    erc20Transfer: 200000n,      // Doubled for better reliability
    erc721Transfer: 400000n,     // Significantly increased for better reliability
    erc1155Transfer: 550000n,    // Significantly increased for better reliability
    ethTransfer: 60000n,         // Doubled for safety
    approve: 150000n,            // Increased for better reliability
    default: 300000n             // Increased general default
  }
};

/**
 * Get default gas limit for a transaction type on a specific network
 * @param {string} network - Network name
 * @param {string} txType - Transaction type
 * @returns {bigint} Default gas limit
 */
const getDefaultGasLimit = (network, txType = 'default') => {
  const networkDefaults = DEFAULT_GAS_LIMITS[network] || DEFAULT_GAS_LIMITS.default;
  return networkDefaults[txType] || networkDefaults.default;
};

/**
 * Estimate gas for a transaction with fallback to default values
 * @param {ethers.Provider} provider - The provider instance
 * @param {Object} transactionRequest - The transaction request
 * @param {string} network - Network name for fallback defaults
 * @param {string} txType - Transaction type for fallback defaults
 * @returns {Promise<bigint>} Estimated gas limit
 */
const estimateGas = async (provider, transactionRequest, network = 'default', txType = 'default') => {
  // Get the default gas limit first as a fallback
  const defaultGas = getDefaultGasLimit(network, txType);
  
  try {
    // Try to estimate gas using the provider with a timeout
    const estimatePromise = provider.estimateGas(transactionRequest);
    let estimatedGas;
    
    try {
      // Add a timeout to the estimation to prevent hanging
      estimatedGas = await withTimeout(estimatePromise, 10000, `Gas estimation timed out for ${txType} on ${network}`);
      
      // Validate the estimated gas is reasonable
      if (estimatedGas <= 21000n) {
        // If estimated gas is suspiciously low for non-ETH transfers, use default
        if (txType !== 'ethTransfer') {
          console.warn(`Estimated gas (${estimatedGas}) seems too low for ${txType}, using default: ${defaultGas}`);
          return defaultGas;
        }
      }
      
      // Add 20% buffer to the estimated gas for extra safety (increased from 10%)
      const bufferedGas = (estimatedGas * 120n) / 100n;
      console.log(`Gas estimated successfully: ${estimatedGas} (with 20% buffer: ${bufferedGas})`);
      
      // Use the higher of buffered gas or default gas to ensure transaction success
      const finalGas = bufferedGas > defaultGas ? bufferedGas : defaultGas;
      console.log(`Final gas limit: ${finalGas} (${finalGas > bufferedGas ? 'using default' : 'using estimated + buffer'})`);
      return finalGas;
    } catch (timeoutError) {
      // Timeout occurred during estimation
      console.warn(`Gas estimation timed out: ${timeoutError.message}. Using default ${txType} gas limit for ${network}: ${defaultGas}`);
      return defaultGas;
    }
  } catch (error) {
    // If estimation fails for any reason, use default gas limits
    console.warn(`Gas estimation failed: ${error.message}. Using default ${txType} gas limit for ${network}: ${defaultGas}`);
    
    // Add additional 10% buffer to the default gas for extra safety
    const bufferedDefaultGas = (defaultGas * 110n) / 100n;
    console.log(`Using buffered default gas limit: ${bufferedDefaultGas}`);
    return bufferedDefaultGas;
  }
};

/**
 * Send a transaction
 * @param {ethers.Signer} signer - The signer instance
 * @param {Object} transactionRequest - The transaction request
 * @returns {Promise<ethers.ContractTransactionResponse>} Transaction response
 */
const sendTransaction = async (signer, transactionRequest) => {
  try {
    return await signer.sendTransaction(transactionRequest);
  } catch (error) {
    throw new Error(`Failed to send transaction: ${error.message}`);
  }
};

/**
 * Check token allowance and approve if needed
 * @param {Object} tokenContract - The token contract instance
 * @param {string} ownerAddress - The token owner address
 * @param {string} spenderAddress - The address to approve
 * @param {string|bigint} amount - The amount to approve
 * @param {Object} wallet - The wallet to sign the transaction
 * @param {Object} txOverrides - Transaction overrides
 * @param {string} network - Network name for gas estimation fallback
 * @returns {Promise<boolean>} True if approved or already has allowance
 */
const checkAndApproveToken = async (tokenContract, ownerAddress, spenderAddress, amount, wallet, txOverrides = {}, network = 'default') => {
  try {
    console.log(`Checking allowance for token ${await tokenContract.symbol()} (${tokenContract.target})...`);
    
    // Check current allowance
    const currentAllowance = await tokenContract.allowance(ownerAddress, spenderAddress);
    
    // Convert amount to BigInt if it's a string
    const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
    
    // If current allowance is sufficient, no need to approve
    if (currentAllowance >= amountBigInt) {
      console.log(`Allowance already sufficient: ${currentAllowance} >= ${amountBigInt}`);
      return true;
    }
    
    console.log(`Approving token ${await tokenContract.symbol()} for ${amountBigInt} tokens...`);
    
    // Create approval transaction
    const approveTx = await tokenContract.approve.populateTransaction(spenderAddress, amountBigInt);
    
    // Merge with provided overrides
    const txRequest = { ...approveTx, ...txOverrides };
    
    // Estimate gas with fallback
    try {
      const provider = wallet.provider;
      txRequest.gasLimit = await estimateGas(provider, txRequest, network, 'approve');
    } catch (gasError) {
      console.warn(`Failed to estimate gas for approval: ${gasError.message}`);
      // Use default gas limit from overrides or set a reasonable default
      txRequest.gasLimit = txOverrides.gasLimit || getDefaultGasLimit(network, 'approve');
    }
    
    // Send approval transaction
    const tx = await wallet.sendTransaction(txRequest);
    console.log(`Approval transaction sent: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait(1);
    console.log(`Approval confirmed in block ${receipt.blockNumber}`);
    
    return true;
  } catch (error) {
    console.error(`Token approval failed: ${error.message}`);
    return false;
  }
};

/**
 * Common ERC20 token ABI
 */
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

/**
 * Check if address has contract code
 * @param {string} address - The address to check
 * @param {ethers.Provider} provider - The provider instance
 * @returns {Promise<boolean>} True if address has contract code
 */
const hasContractCode = async (address, provider) => {
  try {
    const code = await provider.getCode(address);
    return code && code !== '0x' && code.length > 2;
  } catch (error) {
    console.warn(`Error checking contract code for ${address}: ${error.message}`);
    return false;
  }
};

/**
 * Check if a contract implements ERC20 interface by testing key methods
 * @param {string} tokenAddress - The token contract address
 * @param {ethers.Provider} provider - The provider instance
 * @returns {Promise<boolean>} True if contract appears to implement ERC20
 */
const isERC20Contract = async (tokenAddress, provider) => {
  try {
    const contract = createContract(tokenAddress, [
      'function totalSupply() view returns (uint256)',
      'function decimals() view returns (uint8)'
    ], provider);
    
    // Try to call basic ERC20 methods with timeout
    await Promise.race([
      contract.totalSupply(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ]);
    
    return true;
  } catch (error) {
    console.log(`Contract ${tokenAddress} does not appear to be ERC20: ${error.message}`);
    return false;
  }
};

/**
 * Get ERC20 token information
 * @param {string} tokenAddress - The token contract address
 * @param {ethers.Provider} provider - The provider instance
 * @returns {Promise<Object>} Token information
 */
const getTokenInfo = async (tokenAddress, provider) => {
  try {
    // Validate address format first
    if (!isValidAddress(tokenAddress)) {
      throw new Error(`Invalid token address format: ${tokenAddress}`);
    }

    // Check if address has contract code
    const hasCode = await hasContractCode(tokenAddress, provider);
    if (!hasCode) {
      throw new Error(`No contract code found at address ${tokenAddress}`);
    }

    // Check if it's a valid ERC20 contract
    const isERC20 = await isERC20Contract(tokenAddress, provider);
    if (!isERC20) {
      throw new Error(`Contract at ${tokenAddress} does not implement ERC20 interface`);
    }

    const contract = createContract(tokenAddress, ERC20_ABI, provider);
    
    // Read metadata with fallbacks and timeouts
    let name = 'Unknown Token';
    let symbol = 'TKN';
    let decimals = 18;

    try { 
      name = await Promise.race([
        contract.name(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);
    } catch (error) {
      console.log(`Failed to get name for ${tokenAddress}: ${error.message}`);
    }
    
    try { 
      symbol = await Promise.race([
        contract.symbol(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);
    } catch (error) {
      console.log(`Failed to get symbol for ${tokenAddress}: ${error.message}`);
    }
    
    try { 
      const decimalResult = await Promise.race([
        contract.decimals(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);
      decimals = Number(decimalResult);
      if (isNaN(decimals) || decimals < 0 || decimals > 77) {
        console.warn(`Invalid decimals ${decimals} for ${tokenAddress}, using default 18`);
        decimals = 18;
      }
    } catch (error) {
      console.log(`Failed to get decimals for ${tokenAddress}: ${error.message}`);
    }

    return {
      address: getChecksumAddress(tokenAddress),
      name,
      symbol,
      decimals
    };
  } catch (error) {
    throw new Error(`Failed to get token info for ${tokenAddress}: ${error.message}`);
  }
};

/**
 * Get ERC20 token balance
 * @param {string} tokenAddress - The token contract address
 * @param {string} walletAddress - The wallet address
 * @param {ethers.Provider} provider - The provider instance
 * @returns {Promise<string>} Token balance as string
 */
const getTokenBalance = async (tokenAddress, walletAddress, provider) => {
  try {
    // Validate addresses first
    if (!isValidAddress(tokenAddress)) {
      console.warn(`Invalid token address format: ${tokenAddress}`);
      return '0';
    }
    if (!isValidAddress(walletAddress)) {
      console.warn(`Invalid wallet address format: ${walletAddress}`);
      return '0';
    }

    // Check if address has contract code
    const hasCode = await hasContractCode(tokenAddress, provider);
    if (!hasCode) {
      console.log(`No contract code found at ${tokenAddress}, skipping balance check`);
      return '0';
    }

    const contract = createContract(tokenAddress, ERC20_ABI, provider);
    
    // Use a timeout to prevent hanging on malicious contracts
    try {
      const balance = await Promise.race([
        contract.balanceOf(walletAddress),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Balance check timeout')), 8000)
        )
      ]);
      
      // Handle the case where the contract call returns empty data
      if (balance === undefined || balance === null) {
        console.warn(`Empty response from balanceOf for token ${tokenAddress}`);
        return '0';
      }
      
      // Validate the balance is a proper number
      const balanceStr = balance.toString();
      if (balanceStr === 'NaN' || balanceStr === 'Infinity' || !balanceStr.match(/^\d+$/)) {
        console.warn(`Invalid balance returned for token ${tokenAddress}: ${balanceStr}`);
        return '0';
      }
      
      return balanceStr;
    } catch (balanceError) {
      // Handle specific ethers errors
      if (balanceError.code === 'BAD_DATA' && balanceError.value === '0x') {
        console.warn(`Token ${tokenAddress} returned empty data for balanceOf - likely not a valid ERC20 token`);
        return '0';
      }
      
      if (balanceError.code === 'CALL_EXCEPTION') {
        console.warn(`Contract call exception for ${tokenAddress}: ${balanceError.reason || balanceError.message}`);
        return '0';
      }
      
      if (balanceError.message?.includes('timeout') || balanceError.message?.includes('Timeout')) {
        console.warn(`Balance check timed out for ${tokenAddress}`);
        return '0';
      }
      
      console.warn(`Token balance check failed for ${tokenAddress}: ${balanceError.message}`);
      return '0';
    }
  } catch (error) {
    console.error(`Failed to get token balance for ${tokenAddress}: ${error.message}`);
    return '0'; // Return 0 instead of throwing to make the function more resilient
  }
};

/**
 * Helper function to add a timeout to a promise
 * @param {Promise} promise - The promise to add timeout to
 * @param {number} ms - Timeout in milliseconds
 * @param {string} errorMessage - Custom error message
 * @returns {Promise} Promise with timeout
 */
const withTimeout = (promise, ms, errorMessage = 'Timeout') => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms))
  ]);
};

/**
 * Enhanced timeout function with retry logic for network issues
 * @param {Promise} promise - The promise to execute
 * @param {number} ms - Timeout in milliseconds
 * @param {string} errorMessage - Custom error message
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise} Promise with retry logic
 */
const withRetryTimeout = async (promise, ms, errorMessage = 'Timeout', maxRetries = 2) => {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(promise, ms, errorMessage);
    } catch (error) {
      lastError = error;
      // Check if it's a network connectivity issue
      if (error.message.includes('ETIMEDOUT') || 
          error.message.includes('ENOTFOUND') || 
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('connect ETIMEDOUT') ||
          error.message.includes('request timeout') ||
          error.message.includes('TIMEOUT')) {
        console.log(`Network error on attempt ${attempt + 1}/${maxRetries + 1}: ${error.message}`);
        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }
      }
      // For non-network errors or final attempt, throw immediately
      throw error;
    }
  }
  throw lastError;
};

/**
 * Helper function to handle network connectivity issues gracefully
 * @param {Error} error - The error to handle
 * @param {string} operation - The operation that failed
 * @returns {string} Formatted error message
 */
const handleNetworkError = (error, operation) => {
  const errorMsg = error.message || error.toString();
  if (errorMsg.includes('ETIMEDOUT') || 
      errorMsg.includes('ENOTFOUND') || 
      errorMsg.includes('ECONNREFUSED') ||
      errorMsg.includes('connect ETIMEDOUT') ||
      errorMsg.includes('request timeout') ||
      errorMsg.includes('TIMEOUT')) {
    return `Network connectivity issue during ${operation}: ${errorMsg}`;
  }
  return `${operation} failed: ${errorMsg}`;
};

/**
 * Helper function to check if a transaction was successful despite "already known" error
 * @param {ethers.Provider} provider - The provider instance
 * @param {ethers.Signer} signer - The signer instance
 * @param {number} nonce - The nonce to check
 * @returns {Promise<boolean>} True if transaction was successful
 */
const checkTransactionSuccess = async (provider, signer, nonce) => {
  try {
    const currentNonce = await provider.getTransactionCount(await signer.getAddress(), 'latest');
    return currentNonce > nonce;
  } catch (error) {
    console.error('Error checking transaction success:', error);
    return false;
  }
};

/**
 * Helper function to create a mock transaction for testing
 * @returns {Object} Mock transaction object
 */
const createMockTransaction = () => {
  return {
    hash: '0x' + '0'.repeat(64),
    to: '0x' + '0'.repeat(40),
    from: '0x' + '0'.repeat(40),
    nonce: 0,
    gasLimit: ethers.parseUnits('21000', 'wei'),
    gasPrice: ethers.parseUnits('20', 'gwei'),
    data: '0x',
    value: ethers.parseUnits('0', 'ether'),
    chainId: 1
  };
};

/**
 * Helper function to check if a transaction is pending
 * @param {ethers.Provider} provider - The provider instance
 * @param {ethers.Signer} signer - The signer instance
 * @param {number} nonce - The nonce to check
 * @returns {Promise<boolean>} True if transaction is pending
 */
const checkPendingTransaction = async (provider, signer, nonce) => {
  try {
    const address = await signer.getAddress();
    const currentNonce = await provider.getTransactionCount(address, 'latest');
    const pendingNonce = await provider.getTransactionCount(address, 'pending');
    
    return pendingNonce > currentNonce && currentNonce === nonce;
  } catch (error) {
    console.error('Error checking pending transaction:', error);
    return false;
  }
};

module.exports = {
  createProvider,
  createFallbackProvider,
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
  hasContractCode,
  isERC20Contract,
  getTokenInfo,
  getTokenBalance,
  withTimeout,
  withRetryTimeout,
  handleNetworkError,
  checkTransactionSuccess,
  createMockTransaction,
  checkPendingTransaction,
  checkAndApproveToken,
  getDefaultGasLimit,
  DEFAULT_GAS_LIMITS
}; 