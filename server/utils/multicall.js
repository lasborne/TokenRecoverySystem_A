/**
 * Multicall utility service for fetching token balances
 * Alternative to Moralis for efficient batch token balance queries
 */

const { ethers } = require('ethers');
const { getNetworkConfig, getRpcUrl } = require('../config/networks.js');

// Multicall contract addresses for different networks
const MULTICALL_ADDRESSES = {
  mainnet: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
  base: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
  polygon: '0x275617327c958bD06b5D6b871E7f491D76113dd8',
  linea: process.env.LINEA_MULTICALL_ADDRESS || '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
  arbitrum: process.env.ARBITRUM_MULTICALL_ADDRESS || '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
  optimism: process.env.OPTIMISM_MULTICALL_ADDRESS || '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
  goerli: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696'
};

// Multicall ABI (minimal for aggregate function)
const MULTICALL_ABI = [
  "function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"
];

// ERC20 ABI for balance and metadata queries
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)"
];

// ERC721 ABI for NFT balance queries
const ERC721_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function tokenURI(uint256 tokenId) view returns (string)"
];

// ERC1155 ABI for multi-token balance queries
const ERC1155_ABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
  "function uri(uint256 id) view returns (string)"
];

/**
 * Get multicall address for a network
 * @param {string} networkId - The network identifier
 * @returns {string} Multicall contract address
 */
const getMulticallAddress = (networkId) => {
  const address = MULTICALL_ADDRESSES[networkId];
  if (!address) {
    throw new Error(`Multicall address not configured for network: ${networkId}`);
  }
  console.log(`Multicall address for ${networkId}: ${address}`);
  return address;
};

/**
 * Create multicall contract instance
 * @param {string} networkId - The network identifier
 * @param {ethers.Provider} provider - The provider instance
 * @returns {ethers.Contract} Multicall contract instance
 */
const createMulticallContract = (networkId, provider) => {
  try {
    const address = getMulticallAddress(networkId);
    return new ethers.Contract(address, MULTICALL_ABI, provider);
  } catch (error) {
    throw new Error(`Failed to create multicall contract: ${error.message}`);
  }
};

/**
 * Batch query ERC20 token balances using multicall
 * @param {string} walletAddress - The wallet address
 * @param {Array<string>} tokenAddresses - Array of token contract addresses
 * @param {string} networkId - The network identifier
 * @returns {Promise<Array>} Array of token balance data
 */
const getERC20BalancesBatch = async (walletAddress, tokenAddresses, networkId) => {
  try {
    const provider = new ethers.JsonRpcProvider(getRpcUrl(networkId));
    const multicall = createMulticallContract(networkId, provider);
    
    if (!tokenAddresses || tokenAddresses.length === 0) {
      return [];
    }

    console.log(`Fetching ${tokenAddresses.length} ERC20 token balances using multicall on ${networkId}`);

    // Prepare calls for balanceOf, decimals, name, and symbol
    const calls = [];
    const erc20Interface = new ethers.Interface(ERC20_ABI);

    for (const tokenAddress of tokenAddresses) {
      // Validate address
      if (!ethers.isAddress(tokenAddress)) {
        console.warn(`Invalid token address: ${tokenAddress}`);
        continue;
      }

      // Add calls for balanceOf, decimals, name, symbol
      calls.push({
        target: tokenAddress,
        callData: erc20Interface.encodeFunctionData("balanceOf", [walletAddress])
      });
      calls.push({
        target: tokenAddress,
        callData: erc20Interface.encodeFunctionData("decimals", [])
      });
      calls.push({
        target: tokenAddress,
        callData: erc20Interface.encodeFunctionData("name", [])
      });
      calls.push({
        target: tokenAddress,
        callData: erc20Interface.encodeFunctionData("symbol", [])
      });
    }

    if (calls.length === 0) {
      return [];
    }

    // Execute multicall with robust error handling
    let returnData = [];
    try {
      const [, data] = await multicall.aggregate(calls);
      returnData = data;
    } catch (multicallError) {
      console.warn(`Multicall aggregate failed, falling back to individual queries: ${multicallError.message}`);
      return await getERC20BalancesIndividually(walletAddress, tokenAddresses, networkId);
    }
    
    // Process results with bulletproof error handling
    const tokens = [];
    const callsPerToken = 4; // balanceOf, decimals, name, symbol
    
    for (let i = 0; i < tokenAddresses.length; i++) {
      try {
        const tokenAddress = tokenAddresses[i];
        const startIndex = i * callsPerToken;
        
        // Validate return data exists and is not empty
        if (!returnData[startIndex] || returnData[startIndex] === '0x') {
          console.warn(`Empty return data for token ${tokenAddress}, skipping`);
          continue;
        }
        
        // Decode balance with error handling
        let balance = 0n;
        try {
          const balanceData = returnData[startIndex];
          balance = erc20Interface.decodeFunctionResult("balanceOf", balanceData)[0];
        } catch (error) {
          console.warn(`Failed to decode balance for ${tokenAddress}: ${error.message}`);
          continue;
        }
        
        // Skip tokens with zero balance
        if (balance === 0n) {
          continue;
        }

        // Decode other fields with fallbacks
        let decimals = 18;
        let name = 'Unknown Token';
        let symbol = 'UNKNOWN';
        
        try {
          if (returnData[startIndex + 1] && returnData[startIndex + 1] !== '0x') {
            decimals = erc20Interface.decodeFunctionResult("decimals", returnData[startIndex + 1])[0];
          }
        } catch (error) {
          console.warn(`Failed to decode decimals for ${tokenAddress}, using default 18`);
        }
        
        try {
          if (returnData[startIndex + 2] && returnData[startIndex + 2] !== '0x') {
            name = erc20Interface.decodeFunctionResult("name", returnData[startIndex + 2])[0];
          }
        } catch (error) {
          console.warn(`Failed to decode name for ${tokenAddress}, using default`);
        }
        
        try {
          if (returnData[startIndex + 3] && returnData[startIndex + 3] !== '0x') {
            symbol = erc20Interface.decodeFunctionResult("symbol", returnData[startIndex + 3])[0];
          }
        } catch (error) {
          console.warn(`Failed to decode symbol for ${tokenAddress}, using default`);
        }

        // Format balance
        const formattedBalance = formatTokenBalance(balance.toString(), decimals);

        tokens.push({
          address: tokenAddress,
          name: name || 'Unknown Token',
          symbol: symbol || 'UNKNOWN',
          decimals: Number(decimals),
          balance: balance.toString(),
          formattedBalance,
          type: 'ERC20',
          source: 'multicall'
        });

      } catch (error) {
        console.warn(`Error processing token ${tokenAddresses[i]}: ${error.message}`);
        continue;
      }
    }

    console.log(`Successfully fetched ${tokens.length} ERC20 tokens with non-zero balances`);
    return tokens;

  } catch (error) {
    console.error(`Error in multicall ERC20 batch query: ${error.message}`);
    return [];
  }
};

/**
 * Get ERC20 token balances using individual queries (fallback method)
 * @param {string} walletAddress - The wallet address
 * @param {Array<string>} tokenAddresses - Array of token addresses
 * @param {string} networkId - The network identifier
 * @returns {Promise<Array>} Array of token balance data
 */
const getERC20BalancesIndividually = async (walletAddress, tokenAddresses, networkId) => {
  try {
    console.log(`Falling back to individual queries for ${tokenAddresses.length} tokens on ${networkId}`);
    
    const provider = new ethers.JsonRpcProvider(getRpcUrl(networkId));
    const tokens = [];
    
    for (const tokenAddress of tokenAddresses) {
      try {
        // Validate address
        if (!ethers.isAddress(tokenAddress)) {
          console.warn(`Invalid token address: ${tokenAddress}`);
          continue;
        }
        
        // Create contract instance
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        
        // Get balance
        const balance = await contract.balanceOf(walletAddress);
        
        // Skip tokens with zero balance
        if (balance === 0n) {
          continue;
        }
        
        // Get token metadata with fallbacks
        let decimals = 18;
        let name = 'Unknown Token';
        let symbol = 'UNKNOWN';
        
        try {
          decimals = await contract.decimals();
        } catch (error) {
          console.warn(`Failed to get decimals for ${tokenAddress}, using default 18`);
        }
        
        try {
          name = await contract.name();
        } catch (error) {
          console.warn(`Failed to get name for ${tokenAddress}, using default`);
        }
        
        try {
          symbol = await contract.symbol();
        } catch (error) {
          console.warn(`Failed to get symbol for ${tokenAddress}, using default`);
        }
        
        // Format balance
        const formattedBalance = formatTokenBalance(balance.toString(), decimals);
        
        tokens.push({
          address: tokenAddress,
          name: name || 'Unknown Token',
          symbol: symbol || 'UNKNOWN',
          decimals: Number(decimals),
          balance: balance.toString(),
          formattedBalance,
          type: 'ERC20',
          source: 'individual_query'
        });
        
      } catch (error) {
        console.warn(`Error querying token ${tokenAddress}: ${error.message}`);
        continue;
      }
    }
    
    console.log(`Successfully fetched ${tokens.length} ERC20 tokens using individual queries`);
    return tokens;
    
  } catch (error) {
    console.error(`Error in individual ERC20 queries: ${error.message}`);
    return [];
  }
};

/**
 * Batch query ERC721 token balances using multicall
 * @param {string} walletAddress - The wallet address
 * @param {Array<string>} nftAddresses - Array of NFT contract addresses
 * @param {string} networkId - The network identifier
 * @returns {Promise<Array>} Array of NFT balance data
 */
const getERC721BalancesBatch = async (walletAddress, nftAddresses, networkId) => {
  try {
    const provider = new ethers.JsonRpcProvider(getRpcUrl(networkId));
    const multicall = createMulticallContract(networkId, provider);
    
    if (!nftAddresses || nftAddresses.length === 0) {
      return [];
    }

    console.log(`Fetching ${nftAddresses.length} ERC721 token balances using multicall on ${networkId}`);

    // Prepare calls for balanceOf, name, and symbol
    const calls = [];
    const erc721Interface = new ethers.Interface(ERC721_ABI);

    for (const nftAddress of nftAddresses) {
      // Validate address
      if (!ethers.isAddress(nftAddress)) {
        console.warn(`Invalid NFT address: ${nftAddress}`);
        continue;
      }

      // Add calls for balanceOf, name, symbol
      calls.push({
        target: nftAddress,
        callData: erc721Interface.encodeFunctionData("balanceOf", [walletAddress])
      });
      calls.push({
        target: nftAddress,
        callData: erc721Interface.encodeFunctionData("name", [])
      });
      calls.push({
        target: nftAddress,
        callData: erc721Interface.encodeFunctionData("symbol", [])
      });
    }

    if (calls.length === 0) {
      return [];
    }

    // Execute multicall
    const [, returnData] = await multicall.aggregate(calls);
    
    // Process results
    const nfts = [];
    const callsPerNFT = 3; // balanceOf, name, symbol
    
    for (let i = 0; i < nftAddresses.length; i++) {
      try {
        const nftAddress = nftAddresses[i];
        const startIndex = i * callsPerNFT;
        
        // Decode balance
        const balanceData = returnData[startIndex];
        const balance = erc721Interface.decodeFunctionResult("balanceOf", balanceData)[0];
        
        // Skip NFTs with zero balance
        if (balance === 0n) {
          continue;
        }

        // Decode name
        const nameData = returnData[startIndex + 1];
        const name = erc721Interface.decodeFunctionResult("name", nameData)[0];

        // Decode symbol
        const symbolData = returnData[startIndex + 2];
        const symbol = erc721Interface.decodeFunctionResult("symbol", symbolData)[0];

        nfts.push({
          address: nftAddress,
          name: name || 'Unknown NFT',
          symbol: symbol || 'NFT',
          balance: balance.toString(),
          formattedBalance: balance.toString(),
          type: 'ERC721',
          source: 'multicall'
        });

      } catch (error) {
        console.warn(`Error processing NFT ${nftAddresses[i]}: ${error.message}`);
        continue;
      }
    }

    console.log(`Successfully fetched ${nfts.length} ERC721 tokens with non-zero balances`);
    return nfts;

  } catch (error) {
    console.error(`Error in multicall ERC721 batch query: ${error.message}`);
    return [];
  }
};

/**
 * Get all token balances using multicall (alternative to Moralis)
 * @param {string} walletAddress - The wallet address
 * @param {string} networkId - The network identifier
 * @param {Array<string>} tokenAddresses - Array of token addresses to check
 * @returns {Promise<Array>} Array of token balance data
 */
const getAllTokenBalances = async (walletAddress, networkId, tokenAddresses = []) => {
  try {
    console.log(`Using multicall to fetch token balances for ${walletAddress} on ${networkId}`);

    // If no token addresses provided, return empty array
    if (!tokenAddresses || tokenAddresses.length === 0) {
      console.log('No token addresses provided for multicall query');
      return [];
    }

    // Validate wallet address
    if (!ethers.isAddress(walletAddress)) {
      throw new Error(`Invalid wallet address: ${walletAddress}`);
    }

    // Filter valid addresses
    const validAddresses = tokenAddresses.filter(addr => ethers.isAddress(addr));
    console.log(`Processing ${validAddresses.length} valid token addresses out of ${tokenAddresses.length} provided`);

    if (validAddresses.length === 0) {
      return [];
    }

    // Try multicall first, then fall back to individual queries if needed
    let erc20Tokens = await getERC20BalancesBatch(walletAddress, validAddresses, networkId);
    
    // If multicall returned no tokens, try individual queries as final fallback
    if (erc20Tokens.length === 0) {
      console.log('No tokens found from multicall, trying individual queries as final fallback');
      erc20Tokens = await getERC20BalancesIndividually(walletAddress, validAddresses, networkId);
    }

    // TODO: Add ERC721 and ERC1155 detection logic here
    // This would require additional logic to determine token types

    return erc20Tokens;

  } catch (error) {
    console.error(`Error in multicall getAllTokenBalances: ${error.message}`);
    return [];
  }
};

/**
 * Format token balance with proper decimals
 * @param {string} balance - Raw balance
 * @param {number} decimals - Token decimals
 * @returns {string} Formatted balance
 */
const formatTokenBalance = (balance, decimals) => {
  if (!balance) return '0';
  
  try {
    const divisor = BigInt(10) ** BigInt(decimals);
    const balanceBigInt = BigInt(balance);
    
    // Integer part
    const integerPart = (balanceBigInt / divisor).toString();
    
    // Fractional part (if any)
    const remainder = balanceBigInt % divisor;
    if (remainder === BigInt(0)) {
      return integerPart;
    }
    
    // Format with up to 4 decimal places
    let fractionalPart = remainder.toString().padStart(decimals, '0');
    fractionalPart = fractionalPart.substring(0, 4); // Take up to 4 decimal places
    
    // Trim trailing zeros
    fractionalPart = fractionalPart.replace(/0+$/, '');
    
    if (fractionalPart.length > 0) {
      return `${integerPart}.${fractionalPart}`;
    }
    return integerPart;
  } catch (error) {
    console.error(`Error formatting token balance: ${error.message}`);
    return '0';
  }
};

/**
 * Check if multicall is available for a network
 * @param {string} networkId - The network identifier
 * @returns {boolean} True if multicall is available
 */
const isMulticallAvailable = (networkId) => {
  return !!MULTICALL_ADDRESSES[networkId];
};

/**
 * Get supported networks for multicall
 * @returns {Array<string>} Array of supported network IDs
 */
const getSupportedNetworks = () => {
  return Object.keys(MULTICALL_ADDRESSES);
};

module.exports = {
  getMulticallAddress,
  createMulticallContract,
  getERC20BalancesBatch,
  getERC721BalancesBatch,
  getAllTokenBalances,
  formatTokenBalance,
  isMulticallAvailable,
  getSupportedNetworks,
  MULTICALL_ADDRESSES
};
