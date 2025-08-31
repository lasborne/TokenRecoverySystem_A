/**
 * Moralis API integration for token detection and price retrieval
 * Provides comprehensive token discovery across multiple networks
 * Supports ERC20, ERC721, and ERC1155 token standards
 */

const fetch = require('node-fetch');
const { ethers } = require('ethers');

// Environment variable for Moralis API key
// In production, this should be set in .env file
const MORALIS_API_KEY = process.env.MORALIS_API_KEY || '';

// Mapping from our network names to Moralis chain identifiers
const NETWORK_TO_MORALIS_CHAIN = {
  mainnet: 'eth',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  base: 'base',
  linea: 'linea',
  polygon: 'polygon'
};

// Network-specific configuration for enhanced token detection
const NETWORK_CONFIG = {
  optimism: {
    // Optimism has many tokens, so we need very aggressive pagination
    tokensPerPage: 500,
    maxTokens: 2000,
    nftFetchLimit: 500,
    maxNFTs: 1500,
    // Optimism-specific retry settings - more aggressive
    maxRetries: 8,
    retryDelay: 500,
    // Optimism has good API support, so we can be very aggressive
    timeout: 30000,
    // Additional Optimism-specific settings
    includeZeroBalances: true,
    includeSpamTokens: true,
    maxConcurrentRequests: 10
  },
  arbitrum: {
    tokensPerPage: 200,
    maxTokens: 1000,
    nftFetchLimit: 200,
    maxNFTs: 800,
    maxRetries: 5,
    retryDelay: 1000,
    timeout: 20000
  },
  base: {
    tokensPerPage: 150,
    maxTokens: 600,
    nftFetchLimit: 100,
    maxNFTs: 500,
    maxRetries: 3,
    retryDelay: 1500,
    timeout: 15000
  },
  linea: {
    tokensPerPage: 100,
    maxTokens: 400,
    nftFetchLimit: 100,
    maxNFTs: 300,
    maxRetries: 3,
    retryDelay: 2000,
    timeout: 15000
  },
  mainnet: {
    tokensPerPage: 100,
    maxTokens: 500,
    nftFetchLimit: 100,
    maxNFTs: 400,
    maxRetries: 3,
    retryDelay: 1500,
    timeout: 15000
  },
  polygon: {
    tokensPerPage: 100,
    maxTokens: 400,
    nftFetchLimit: 100,
    maxNFTs: 300,
    maxRetries: 3,
    retryDelay: 1500,
    timeout: 15000
  },
  // Default configuration
  default: {
    tokensPerPage: 100,
    maxTokens: 300,
    nftFetchLimit: 100,
    maxNFTs: 200,
    maxRetries: 3,
    retryDelay: 2000,
    timeout: 15000
  }
};

// Maximum number of NFTs to fetch per request
const NFT_FETCH_LIMIT = 100;

/**
 * Get all ERC20 tokens for a wallet using Moralis API with pagination and retry
 * @param {string} walletAddress - The wallet address
 * @param {string} network - Network name in our system
 * @returns {Promise<Array>} Array of token data
 */
async function getWalletTokens(walletAddress, network) {
  try {
    if (!MORALIS_API_KEY) {
      console.warn('Moralis API key not set. Skipping Moralis token detection.');
      return [];
    }
    
    // Add safety check to prevent excessive API calls
    const cacheKey = `${walletAddress}-${network}`;
    const lastCallTime = getWalletTokens.lastCallTime?.get(cacheKey) || 0;
    const timeSinceLastCall = Date.now() - lastCallTime;
    
    // Only allow API calls every 30 seconds to prevent spam
    if (timeSinceLastCall < 30000) {
      console.log(`Skipping Moralis API call for ${walletAddress} on ${network} - too recent (${Math.round(timeSinceLastCall/1000)}s ago)`);
      return [];
    }
    
    // Update last call time
    if (!getWalletTokens.lastCallTime) {
      getWalletTokens.lastCallTime = new Map();
    }
    getWalletTokens.lastCallTime.set(cacheKey, Date.now());

    // Convert our network name to Moralis chain identifier
    const chain = NETWORK_TO_MORALIS_CHAIN[network] || network;
    
    // Get network-specific configuration
    const networkConfig = NETWORK_CONFIG[network] || NETWORK_CONFIG.default;
    const { tokensPerPage, maxTokens, maxRetries, retryDelay, timeout } = networkConfig;
    
    // Use pagination to get all tokens
    let allTokens = [];
    let cursor = null;
    let hasMore = true;
    let retryCount = 0;
    let pageCount = 0;
    const maxPages = 50; // Safety limit to prevent infinite loops
    
    console.log(`Fetching ERC20 tokens from Moralis for ${walletAddress} on ${network} (${chain}) with config:`, {
      tokensPerPage,
      maxTokens,
      maxRetries,
      timeout
    });
    
    while (hasMore && retryCount < maxRetries && pageCount < maxPages) {
      try {
        // Build URL with pagination
        let url = `https://deep-index.moralis.io/api/v2.2/${walletAddress}/erc20?chain=${chain}&limit=${tokensPerPage}`;
        if (cursor) {
          url += `&cursor=${cursor}`;
        }
        
        // Add a timeout to the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(url, {
          headers: {
            'X-API-Key': MORALIS_API_KEY
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Moralis API error (${response.status}): ${errorText}`);
          
          // If we get a rate limit error, wait and retry
          if (response.status === 429) {
            retryCount++;
            console.log(`Rate limited by Moralis API, retrying in ${retryDelay}ms (attempt ${retryCount}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          }
          
          // For other errors, stop pagination
          break;
        }
        
        const data = await response.json();
        const pageTokens = data.result || [];
        
        // Add tokens from this page to our collection
        allTokens = [...allTokens, ...pageTokens];
        
        // Check if we need to fetch more pages
        cursor = data.cursor;
        hasMore = cursor !== null && cursor !== '';
        
        pageCount++;
        console.log(`Fetched ${pageTokens.length} tokens from Moralis (page ${pageCount})${hasMore ? ', fetching more...' : ''}`);
        
        // CRITICAL FIX: Stop pagination if we get 0 tokens and have a cursor
        // This prevents infinite loops when Moralis returns empty pages but still provides cursors
        if (pageTokens.length === 0 && hasMore) {
          console.log(`Received 0 tokens but cursor exists. Stopping pagination to prevent infinite loop.`);
          break;
        }
        
        // If we have a lot of tokens already, stop pagination to avoid timeouts
        if (allTokens.length >= maxTokens) {
          console.log(`Reached ${maxTokens} tokens, stopping pagination to avoid timeouts`);
          break;
        }
        
        // Add a small delay between requests to avoid rate limiting
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (pageError) {
        // If we get an error during pagination, log and continue with what we have
        console.error(`Error during token pagination: ${pageError.message}`);
        retryCount++;
        
        if (retryCount < maxRetries) {
          console.log(`Retrying in ${retryDelay}ms (attempt ${retryCount}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          console.log(`Max retries reached, continuing with ${allTokens.length} tokens`);
          break;
        }
      }
    }
    
    console.log(`Moralis found ${allTokens.length} ERC20 tokens for ${walletAddress} on ${network}`);
    
    // Process the token data and filter out invalid tokens
    const processedTokens = allTokens
      .map(token => {
        try {
          // Skip tokens with invalid or missing data
          if (!token.token_address || !ethers.isAddress(token.token_address)) {
            return null;
          }
          
                     // For Optimism, include tokens with zero balance to catch all possible tokens
           const balance = token.balance || '0';
           if (network !== 'optimism' && (balance === '0' || BigInt(balance) === 0n)) {
             return null;
           }
          
          return {
            address: token.token_address,
            name: token.name || 'Unknown Token',
            symbol: token.symbol || 'UNKNOWN',
            decimals: parseInt(token.decimals) || 18,
            balance: token.balance || '0',
            formattedBalance: formatTokenBalance(token.balance, token.decimals),
            type: 'ERC20',
            source: 'moralis',
            // Store additional metadata if available
            logo: token.logo,
            thumbnail: token.thumbnail,
            contractType: token.contract_type || 'ERC20'
          };
        } catch (tokenError) {
          console.warn(`Error processing token ${token.token_address}: ${tokenError.message}`);
          return null;
        }
      })
      .filter(token => token !== null); // Remove null entries
    
    return processedTokens;
  } catch (error) {
    console.error(`Error fetching tokens from Moralis: ${error.message}`);
    return [];
  }
}

/**
 * Get token price from Moralis API
 * @param {string} tokenAddress - Token contract address
 * @param {string} network - Network name in our system
 * @returns {Promise<Object>} Token price data
 */
async function getTokenPrice(tokenAddress, network) {
  try {
    if (!MORALIS_API_KEY) {
      return { usdPrice: 0, error: 'Moralis API key not set' };
    }

    // Convert our network name to Moralis chain identifier
    const chain = NETWORK_TO_MORALIS_CHAIN[network] || network;
    
    const url = `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/price?chain=${chain}`;
    
    const response = await fetch(url, {
      headers: {
        'X-API-Key': MORALIS_API_KEY
      }
    });
    
    if (!response.ok) {
      // 404 often means no price data available (likely a scam token)
      if (response.status === 404) {
        return { usdPrice: 0, error: 'No price data available' };
      }
      
      const errorText = await response.text();
      console.error(`Moralis price API error (${response.status}): ${errorText}`);
      return { usdPrice: 0, error: errorText };
    }
    
    const priceData = await response.json();
    return { 
      usdPrice: priceData.usdPrice || 0,
      nativePrice: priceData.nativePrice?.value,
      exchangeAddress: priceData.exchangeAddress,
      exchangeName: priceData.exchangeName
    };
  } catch (error) {
    console.error(`Error fetching token price from Moralis: ${error.message}`);
    return { usdPrice: 0, error: error.message };
  }
}

/**
 * Format token balance with proper decimals
 * @param {string} balance - Raw balance
 * @param {number|string} decimals - Token decimals
 * @returns {string} Formatted balance
 */
function formatTokenBalance(balance, decimals) {
  if (!balance) return '0';
  
  const dec = parseInt(decimals) || 18;
  try {
    // Convert from wei to token units
    const divisor = BigInt(10) ** BigInt(dec);
    const balanceBigInt = BigInt(balance);
    
    // Integer part
    const integerPart = (balanceBigInt / divisor).toString();
    
    // Fractional part (if any)
    const remainder = balanceBigInt % divisor;
    if (remainder === BigInt(0)) {
      return integerPart;
    }
    
    // Format with up to 4 decimal places
    let fractionalPart = remainder.toString().padStart(dec, '0');
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
}

/**
 * Check if a token is likely a scam based on Moralis data
 * @param {Object} tokenData - Token data from Moralis
 * @param {Object} priceData - Price data from Moralis
 * @returns {boolean} True if likely a scam
 */
function isLikelyScamToken(tokenData, priceData = {}, network = null) {
  // For Optimism, be much more lenient with scam detection
  if (network === 'optimism') {
    // Only flag as scam if it's extremely obvious
    const name = (tokenData.name || '').toLowerCase();
    const symbol = (tokenData.symbol || '').toLowerCase();
    
    // Only check for the most obvious scam indicators on Optimism
    const obviousScamIndicators = [
      'scam', 'fake', 'phishing', 'spam', 'bot', 'urgent',
      't.me', 'telegram', 'claim', 'airdrop', 'free'
    ];
    
    // Check for obvious scam indicators in name or symbol
    for (const indicator of obviousScamIndicators) {
      if (name.includes(indicator) || symbol.includes(indicator)) {
        return true;
      }
    }
    
    // For Optimism, don't flag based on price data or symbol length
    // Many legitimate tokens on Optimism might not have price data yet
    return false;
  }
  
  // For other networks, use the original logic
  // No price data available (very common for scam tokens)
  if (!priceData.usdPrice) {
    return true;
  }
  
  // Extremely low USD value (dust)
  if (priceData.usdPrice && tokenData.formattedBalance) {
    const usdValue = parseFloat(priceData.usdPrice) * parseFloat(tokenData.formattedBalance);
    if (usdValue < 0.01) {
      return true;
    }
  }
  
  // Check token name and symbol for suspicious patterns
  const name = (tokenData.name || '').toLowerCase();
  const symbol = (tokenData.symbol || '').toLowerCase();
  
  const scamIndicators = [
    'airdrop', 'claim', 'free', 'visit', 'telegram', 't.me', 
    'twitter.com', 'discord', 'join', 'click', 'website',
    'https://', 'http://', '.com', '.io', '.org', '.net',
    '*visit', '*claim', 'reward', 'bonus', 'gift', 'promo',
    'giveaway', 'scam', 'fake', 'phishing', 'spam', 'bot',
    'urgent', 'limited', 'exclusive', 'offer', 'prize'
  ];
  
  // Check for scam indicators in name or symbol
  for (const indicator of scamIndicators) {
    if (name.includes(indicator) || symbol.includes(indicator)) {
      return true;
    }
  }
  
  // Check for unusually long symbols (legitimate tokens usually have short symbols)
  if (symbol.length > 15) {
    return true;
  }
  
  return false;
}

/**
 * Get all ERC20 tokens with prices and scam detection
 * @param {string} walletAddress - The wallet address
 * @param {string} network - Network name in our system
 * @returns {Promise<Array>} Array of token data with prices and scam detection
 */
async function getTokensWithPrices(walletAddress, network) {
  try {
    // Get all tokens from Moralis
    const tokens = await getWalletTokens(walletAddress, network);
    
    // Get price data for each token
    const tokensWithPrices = [];
    
    for (const token of tokens) {
      try {
        // Get price data
        const priceData = await getTokenPrice(token.address, network);
        
        // Calculate USD value
        const balance = parseFloat(token.formattedBalance) || 0;
        const usdValue = balance * (priceData.usdPrice || 0);
        
        // Check if token is likely a scam (pass network for Optimism-specific logic)
        const isScam = isLikelyScamToken(token, priceData, network);
        
        tokensWithPrices.push({
          ...token,
          usdPrice: priceData.usdPrice || 0,
          usdValue: usdValue,
          exchangeName: priceData.exchangeName,
          isScam
        });
      } catch (error) {
        console.error(`Error processing token ${token.symbol}: ${error.message}`);
        tokensWithPrices.push({
          ...token,
          usdPrice: 0,
          usdValue: 0,
          isScam: true,
          error: error.message
        });
      }
    }
    
    // Sort tokens by USD value (descending)
    tokensWithPrices.sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
    
    return tokensWithPrices;
  } catch (error) {
    console.error(`Error getting tokens with prices: ${error.message}`);
    return [];
  }
}

/**
 * Get all NFTs (ERC721 and ERC1155) for a wallet using Moralis API with enhanced reliability
 * @param {string} walletAddress - The wallet address
 * @param {string} network - Network name in our system
 * @returns {Promise<Array>} Array of NFT data
 */
async function getWalletNFTs(walletAddress, network) {
  try {
    if (!MORALIS_API_KEY) {
      console.warn('Moralis API key not set. Skipping Moralis NFT detection.');
      return [];
    }
    
    // Add safety check to prevent excessive API calls
    const cacheKey = `${walletAddress}-${network}-nfts`;
    const lastCallTime = getWalletNFTs.lastCallTime?.get(cacheKey) || 0;
    const timeSinceLastCall = Date.now() - lastCallTime;
    
    // Only allow API calls every 30 seconds to prevent spam
    if (timeSinceLastCall < 30000) {
      console.log(`Skipping Moralis NFT API call for ${walletAddress} on ${network} - too recent (${Math.round(timeSinceLastCall/1000)}s ago)`);
      return [];
    }
    
    // Update last call time
    if (!getWalletNFTs.lastCallTime) {
      getWalletNFTs.lastCallTime = new Map();
    }
    getWalletNFTs.lastCallTime.set(cacheKey, Date.now());

    // Convert our network name to Moralis chain identifier
    const chain = NETWORK_TO_MORALIS_CHAIN[network] || network;
    
    // Get network-specific configuration
    const networkConfig = NETWORK_CONFIG[network] || NETWORK_CONFIG.default;
    const { nftFetchLimit, maxNFTs, maxRetries, retryDelay, timeout } = networkConfig;
    
    // We'll need to handle pagination for NFTs as there could be many
    let cursor = null;
    let allNFTs = [];
    let hasMore = true;
    let retryCount = 0;
    let pageCount = 0;
    const maxPages = 50; // Safety limit to prevent infinite loops
    
    console.log(`Fetching NFTs from Moralis for ${walletAddress} on ${network} (${chain}) with config:`, {
      nftFetchLimit,
      maxNFTs,
      maxRetries,
      timeout
    });
    
    while (hasMore && retryCount < maxRetries && pageCount < maxPages) {
      try {
        // Build URL with pagination parameters
        let url = `https://deep-index.moralis.io/api/v2.2/${walletAddress}/nft?chain=${chain}&limit=${nftFetchLimit}`;
        if (cursor) {
          url += `&cursor=${cursor}`;
        }
        
        // Add a timeout to the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(url, {
          headers: {
            'X-API-Key': MORALIS_API_KEY
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Moralis NFT API error (${response.status}): ${errorText}`);
          
          // If we get a rate limit error, wait and retry
          if (response.status === 429) {
            retryCount++;
            console.log(`Rate limited by Moralis API, retrying in ${retryDelay}ms (attempt ${retryCount}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          }
          
          // For other errors, stop pagination
          break;
        }
        
        const data = await response.json();
        const pageNFTs = data.result || [];
        
        // Add NFTs from this page to our collection
        allNFTs = [...allNFTs, ...pageNFTs];
        
        // Check if we need to fetch more pages
        cursor = data.cursor;
        hasMore = cursor !== null && cursor !== '';
        
        pageCount++;
        console.log(`Fetched ${pageNFTs.length} NFTs from Moralis (page ${pageCount})${hasMore ? ', fetching more...' : ''}`);
        
        // CRITICAL FIX: Stop pagination if we get 0 NFTs and have a cursor
        // This prevents infinite loops when Moralis returns empty pages but still provides cursors
        if (pageNFTs.length === 0 && hasMore) {
          console.log(`Received 0 NFTs but cursor exists. Stopping pagination to prevent infinite loop.`);
          break;
        }
        
        // Limit to maxNFTs for performance
        if (allNFTs.length >= maxNFTs) {
          console.log(`Reached ${maxNFTs} NFTs, stopping pagination to avoid performance issues`);
          break;
        }
        
        // Add a small delay between requests to avoid rate limiting
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (pageError) {
        // If we get an error during pagination, log and continue with what we have
        console.error(`Error during NFT pagination: ${pageError.message}`);
        retryCount++;
        
        if (retryCount < maxRetries) {
          console.log(`Retrying in ${retryDelay}ms (attempt ${retryCount}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          console.log(`Max retries reached, continuing with ${allNFTs.length} NFTs`);
          break;
        }
      }
    }
    
    console.log(`Moralis found ${allNFTs.length} NFTs for ${walletAddress} on ${network}`);
    
    // Process and categorize NFTs by type (ERC721 or ERC1155)
    const processedNFTs = allNFTs
      .map(nft => {
        try {
          // Skip NFTs with invalid or missing data
          if (!nft.token_address || !nft.token_id) {
            return null;
          }
          
          const tokenType = nft.contract_type === 'ERC1155' ? 'ERC1155' : 'ERC721';
          let tokenIdHex;
          
          try {
            // Handle different token ID formats safely
            if (nft.token_id.startsWith('0x')) {
              // Already in hex format
              tokenIdHex = nft.token_id;
            } else {
              // Convert to hex format
              tokenIdHex = `0x${BigInt(nft.token_id).toString(16)}`;
            }
          } catch (idError) {
            console.warn(`Error converting token ID ${nft.token_id} to hex: ${idError.message}`);
            tokenIdHex = nft.token_id; // Use as-is if conversion fails
          }
          
          // Parse metadata if available, but handle errors
          let metadata = null;
          if (nft.metadata) {
            try {
              if (typeof nft.metadata === 'string') {
                metadata = JSON.parse(nft.metadata);
              } else if (typeof nft.metadata === 'object') {
                metadata = nft.metadata;
              }
            } catch (metadataError) {
              console.warn(`Error parsing metadata for NFT ${nft.token_id}: ${metadataError.message}`);
            }
          }
          
          // Extract image URL from metadata if available
          let imageUrl = '';
          if (metadata && (metadata.image || metadata.image_url)) {
            imageUrl = metadata.image || metadata.image_url;
          }
          
          return {
            address: nft.token_address,
            name: nft.name || `${tokenType} #${nft.token_id}`,
            symbol: nft.symbol || tokenType,
            tokenId: nft.token_id,
            tokenUri: nft.token_uri || '',
            metadata,
            imageUrl,
            balance: nft.amount || '1',
            formattedBalance: nft.amount || '1',
            type: tokenType,
            source: 'moralis',
            tokenIdHex,
            // Store additional metadata if available
            contractType: nft.contract_type,
            tokenHash: nft.token_hash,
            lastMetadataSync: nft.last_metadata_sync,
            lastTokenUriSync: nft.last_token_uri_sync
          };
        } catch (nftError) {
          console.warn(`Error processing NFT: ${nftError.message}`);
          return null;
        }
      })
      .filter(nft => nft !== null); // Remove null entries
    
    return processedNFTs;
  } catch (error) {
    console.error(`Error fetching NFTs from Moralis: ${error.message}`);
    return [];
  }
}

/**
 * Get NFT floor price from Moralis API (if available)
 * @param {string} contractAddress - NFT contract address
 * @param {string} network - Network name in our system
 * @returns {Promise<Object>} NFT floor price data
 */
async function getNFTFloorPrice(contractAddress, network) {
  try {
    if (!MORALIS_API_KEY) {
      return { floorPrice: 0, error: 'Moralis API key not set' };
    }

    // Convert our network name to Moralis chain identifier
    const chain = NETWORK_TO_MORALIS_CHAIN[network] || network;
    
    // Note: This endpoint might not be available for all NFT collections
    const url = `https://deep-index.moralis.io/api/v2.2/nft/${contractAddress}/stats?chain=${chain}`;
    
    const response = await fetch(url, {
      headers: {
        'X-API-Key': MORALIS_API_KEY
      }
    });
    
    if (!response.ok) {
      // 404 often means no price data available
      if (response.status === 404) {
        return { floorPrice: 0, error: 'No floor price data available' };
      }
      
      const errorText = await response.text();
      console.error(`Moralis NFT floor price API error (${response.status}): ${errorText}`);
      return { floorPrice: 0, error: errorText };
    }
    
    const statsData = await response.json();
    return { 
      floorPrice: statsData.floor_price || 0,
      floorPriceSymbol: 'ETH', // Usually in ETH/native currency
      volume24h: statsData.volume_24h || 0
    };
  } catch (error) {
    console.error(`Error fetching NFT floor price from Moralis: ${error.message}`);
    return { floorPrice: 0, error: error.message };
  }
}

/**
 * Get additional token data using different Moralis endpoints (Optimism-specific)
 * @param {string} walletAddress - The wallet address
 * @param {string} network - Network name in our system
 * @returns {Promise<Array>} Array of additional token data
 */
async function getAdditionalTokenData(walletAddress, network) {
  try {
    if (!MORALIS_API_KEY || network !== 'optimism') {
      return [];
    }

    const chain = NETWORK_TO_MORALIS_CHAIN[network] || network;
    const networkConfig = NETWORK_CONFIG[network] || NETWORK_CONFIG.default;
    const { timeout } = networkConfig;
    
    console.log(`Fetching additional token data for ${walletAddress} on ${network}...`);
    
    // Try different Moralis endpoints to get more comprehensive data
    const additionalTokens = [];
    
    // 1. Get token transfers (might reveal tokens not in balance)
    try {
      const transfersUrl = `https://deep-index.moralis.io/api/v2.2/${walletAddress}/erc20/transfers?chain=${chain}&limit=100`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(transfersUrl, {
        headers: { 'X-API-Key': MORALIS_API_KEY },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        const transfers = data.result || [];
        
        // Extract unique token addresses from transfers
        const tokenAddresses = new Set();
        for (const transfer of transfers) {
          if (transfer.token_address && ethers.isAddress(transfer.token_address)) {
            tokenAddresses.add(transfer.token_address.toLowerCase());
          }
        }
        
        console.log(`Found ${tokenAddresses.size} unique token addresses from transfer history`);
        
        // Get token info for each address
        for (const address of tokenAddresses) {
          try {
            const tokenInfoUrl = `https://deep-index.moralis.io/api/v2.2/erc20/${address}?chain=${chain}`;
            const tokenResponse = await fetch(tokenInfoUrl, {
              headers: { 'X-API-Key': MORALIS_API_KEY }
            });
            
            if (tokenResponse.ok) {
              const tokenData = await tokenResponse.json();
              additionalTokens.push({
                address: address,
                name: tokenData.name || 'Unknown Token',
                symbol: tokenData.symbol || 'UNKNOWN',
                decimals: parseInt(tokenData.decimals) || 18,
                balance: '0', // We don't have current balance, but we know the wallet interacted with it
                formattedBalance: '0',
                type: 'ERC20',
                source: 'transfer_history',
                contractType: 'ERC20'
              });
            }
          } catch (error) {
            console.warn(`Error fetching token info for ${address}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.warn(`Error fetching transfer history: ${error.message}`);
    }
    
    // 2. Get token approvals (might reveal tokens the wallet has approved)
    try {
      const approvalsUrl = `https://deep-index.moralis.io/api/v2.2/${walletAddress}/erc20/approvals?chain=${chain}&limit=100`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(approvalsUrl, {
        headers: { 'X-API-Key': MORALIS_API_KEY },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        const approvals = data.result || [];
        
        // Extract unique token addresses from approvals
        const approvalAddresses = new Set();
        for (const approval of approvals) {
          if (approval.token_address && ethers.isAddress(approval.token_address)) {
            approvalAddresses.add(approval.token_address.toLowerCase());
          }
        }
        
        console.log(`Found ${approvalAddresses.size} unique token addresses from approval history`);
        
        // Get token info for each approval address
        for (const address of approvalAddresses) {
          try {
            const tokenInfoUrl = `https://deep-index.moralis.io/api/v2.2/erc20/${address}?chain=${chain}`;
            const tokenResponse = await fetch(tokenInfoUrl, {
              headers: { 'X-API-Key': MORALIS_API_KEY }
            });
            
            if (tokenResponse.ok) {
              const tokenData = await tokenResponse.json();
              additionalTokens.push({
                address: address,
                name: tokenData.name || 'Unknown Token',
                symbol: tokenData.symbol || 'UNKNOWN',
                decimals: parseInt(tokenData.decimals) || 18,
                balance: '0', // We don't have current balance, but we know the wallet approved it
                formattedBalance: '0',
                type: 'ERC20',
                source: 'approval_history',
                contractType: 'ERC20'
              });
            }
          } catch (error) {
            console.warn(`Error fetching token info for approval ${address}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.warn(`Error fetching approval history: ${error.message}`);
    }
    
    // Remove duplicates
    const uniqueTokens = [];
    const seenAddresses = new Set();
    
    for (const token of additionalTokens) {
      if (!seenAddresses.has(token.address.toLowerCase())) {
        uniqueTokens.push(token);
        seenAddresses.add(token.address.toLowerCase());
      }
    }
    
    console.log(`Found ${uniqueTokens.length} additional unique tokens from transfer/approval history`);
    return uniqueTokens;
    
  } catch (error) {
    console.error(`Error getting additional token data: ${error.message}`);
    return [];
  }
}

/**
 * Get all tokens (ERC20, ERC721, ERC1155) with prices and scam detection
 * @param {string} walletAddress - The wallet address
 * @param {string} network - Network name in our system
 * @returns {Promise<Array>} Array of token data with prices and scam detection
 */
async function getAllTokensWithPrices(walletAddress, network) {
  try {
    console.log(`Getting all tokens with prices for ${walletAddress} on ${network}...`);
    
    // For Optimism, also get additional token data from transfer/approval history
    const promises = [
      getTokensWithPrices(walletAddress, network),
      getWalletNFTs(walletAddress, network)
    ];
    
    // Add additional token data promise for Optimism
    if (network === 'optimism') {
      promises.push(getAdditionalTokenData(walletAddress, network));
    }
    
    // Run all promises in parallel for better performance
    const results = await Promise.allSettled(promises);
    const [erc20TokensPromise, nftsPromise, additionalTokensPromise] = results;
    
    // Process ERC20 tokens
    let erc20Tokens = [];
    if (erc20TokensPromise.status === 'fulfilled') {
      erc20Tokens = erc20TokensPromise.value;
      console.log(`Successfully fetched ${erc20Tokens.length} ERC20 tokens with prices`);
    } else {
      console.error(`Failed to fetch ERC20 tokens: ${erc20TokensPromise.reason}`);
    }
    
         // Process NFTs
     let nfts = [];
     if (nftsPromise.status === 'fulfilled') {
       nfts = nftsPromise.value;
       console.log(`Successfully fetched ${nfts.length} NFTs`);
     } else {
       console.error(`Failed to fetch NFTs: ${nftsPromise.reason}`);
     }
     
     // Process additional tokens (Optimism only)
     let additionalTokens = [];
     if (network === 'optimism' && additionalTokensPromise && additionalTokensPromise.status === 'fulfilled') {
       additionalTokens = additionalTokensPromise.value;
       console.log(`Successfully fetched ${additionalTokens.length} additional tokens from transfer/approval history`);
     } else if (network === 'optimism' && additionalTokensPromise && additionalTokensPromise.status === 'rejected') {
       console.error(`Failed to fetch additional tokens: ${additionalTokensPromise.reason}`);
     }
    
    // Process NFTs to add price data where available
    const nftsWithPrices = [];
    const nftBatchSize = 10; // Process NFTs in batches to avoid rate limiting
    
    console.log(`Processing ${nfts.length} NFTs in batches of ${nftBatchSize}...`);
    
    // Process NFTs in batches
    for (let i = 0; i < nfts.length; i += nftBatchSize) {
      const batch = nfts.slice(i, i + nftBatchSize);
      const batchPromises = batch.map(async (nft) => {
        try {
          // Try to get floor price for the NFT collection
          const priceData = await getNFTFloorPrice(nft.address, network);
          
          // Estimate value (floor price * quantity for ERC1155)
          const quantity = parseInt(nft.balance) || 1;
          const estimatedValue = quantity * (priceData.floorPrice || 0);
          
          // NFTs are rarely scams in the traditional sense, but we can flag suspicious ones
          // For now, we don't apply scam detection to NFTs
          const isScam = false;
          
          return {
            ...nft,
            floorPrice: priceData.floorPrice || 0,
            floorPriceSymbol: priceData.floorPriceSymbol || 'ETH',
            estimatedValue: estimatedValue,
            isScam,
            usdValue: estimatedValue // Use estimated value as usdValue for consistent sorting
          };
        } catch (error) {
          console.warn(`Error processing NFT ${nft.name || nft.tokenId}: ${error.message}`);
          return {
            ...nft,
            floorPrice: 0,
            estimatedValue: 0,
            isScam: false,
            usdValue: 0,
            error: error.message
          };
        }
      });
      
      // Wait for all NFTs in the batch to be processed
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Add successfully processed NFTs to the result
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          nftsWithPrices.push(result.value);
        }
      }
      
      // Add a small delay between batches to avoid rate limiting
      if (i + nftBatchSize < nfts.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`Successfully processed ${nftsWithPrices.length} NFTs with price data`);
    
         // Combine ERC20 tokens, NFTs, and additional tokens
     const allTokens = [...erc20Tokens, ...nftsWithPrices, ...additionalTokens];
    
    // Sort all tokens by value (descending)
    // For ERC20 tokens, use usdValue
    // For NFTs, use estimatedValue (which is now also in usdValue)
    allTokens.sort((a, b) => {
      const aValue = a.usdValue || 0;
      const bValue = b.usdValue || 0;
      
      if (bValue !== aValue) {
        return bValue - aValue; // Sort by value first
      }
      
      // If values are equal, prioritize by token type
      if (a.type !== b.type) {
        // Prioritize ERC20 over NFTs for equal value
        if (a.type === 'ERC20') return -1;
        if (b.type === 'ERC20') return 1;
      }
      
      return 0;
    });
    
         const erc20Count = allTokens.filter(t => t.type === 'ERC20').length;
     const erc721Count = allTokens.filter(t => t.type === 'ERC721').length;
     const erc1155Count = allTokens.filter(t => t.type === 'ERC1155').length;
     const additionalCount = allTokens.filter(t => t.source === 'transfer_history' || t.source === 'approval_history').length;
     
     console.log(`Total tokens found: ${allTokens.length} (${erc20Count} ERC20, ${erc721Count} ERC721, ${erc1155Count} ERC1155, ${additionalCount} additional from history)`);
    
    return allTokens;
  } catch (error) {
    console.error(`Error getting all tokens with prices: ${error.message}`);
    return [];
  }
}

module.exports = {
  getWalletTokens,
  getTokenPrice,
  getTokensWithPrices,
  getWalletNFTs,
  getNFTFloorPrice,
  getAllTokensWithPrices,
  getAdditionalTokenData,
  isLikelyScamToken,
  formatTokenBalance,
  NETWORK_TO_MORALIS_CHAIN
};