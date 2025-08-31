/**
 * Optimized Token Scanner - Comprehensive token discovery utility
 * Consolidates all scanner functionality into a single, efficient implementation
 * 
 * Features:
 * - Multicall-based token discovery for known tokens
 * - Event log scanning for comprehensive coverage
 * - Etherscan API integration for historical data
 * - Native token balance checking
 * - ERC-20, ERC-721, and ERC-1155 support
 * - Robust error handling and rate limiting
 * - Multi-network support
 */

const { ethers } = require('ethers');
const { getRpcUrl } = require('../config/networks.js');

// Use node-fetch for HTTP requests (if available) or fallback
let fetch;
try {
  fetch = require('node-fetch');
} catch {
  fetch = global.fetch;
}

// Event topics for different token types
const TOPIC_TRANSFER = ethers.id("Transfer(address,address,uint256)");
const TOPIC_1155_TRANSFER_SINGLE = ethers.id("TransferSingle(address,address,address,uint256,uint256)");
const TOPIC_1155_TRANSFER_BATCH = ethers.id("TransferBatch(address,address,address,uint256[],uint256[])");

// ABIs for different token types
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const ERC20_BYTES32_ABI = [
  "function symbol() view returns (bytes32)",
  "function name() view returns (bytes32)",
];

const ERC165_ABI = [
  "function supportsInterface(bytes4) view returns (bool)"
];

const ERC721_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
];

const ERC1155_ABI = [
  "function balanceOf(address,uint256) view returns (uint256)"
];

// Multicall ABI for batch calls
const MULTICALL_ABI = [
  "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)",
  "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] results)"
];

// Known token addresses by network (major tokens with proper checksums)
const KNOWN_TOKENS = {
  optimism: [
    "0x4200000000000000000000000000000000000006", // WETH
    "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", // USDC
    "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", // USDT
    "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", // DAI
    "0x68f180fcCe6836688e9084f035309E29Bf0A2095", // WBTC
    "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6", // LINK
    "0x9e1028F5F1D5eDE59748FFceE5532509976840E0", // PERP
    "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4", // SNX
    "0x217D47011b23BB961eB6D93cA9945B7501a5BB11", // THALES
    "0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49", // sETH
    "0x298B9B95708152ff6968aafd889c6586E9169f1D", // sBTC
    "0x25D8039bB044dC227f741a9e381CA4cEAE2E6aE8", // hUSDC
    "0x2057C8ECB70Afd7Bee667d76B4CD373A325b1a20", // hUSDT
    "0xE7798f023fC62146e8Aa1b36Da45fb70855a77Ea", // hDAI
    "0x062Bf725dC4cDF947aa79Ca2aaCCD4F385b13b5c", // hETH
    "0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9", // sUSD
  ],
  mainnet: [
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    "0xA0b86a33E6441b8C4C8C8C8C8C8C8C8C8C8C8C8", // USDC
    "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
    "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
    "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
    "0x514910771AF9Ca656af840dff83E8264EcF986CA", // LINK
  ],
  base: [
    "0x4200000000000000000000000000000000000006", // WETH
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
    "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
    "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // cbETH
    "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", // DOLA
  ],
  polygon: [
    "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
    "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC
    "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // USDT
    "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", // DAI
  ],
  arbitrum: [
    "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
    "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // USDC
    "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // USDT
    "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", // DAI
  ],
  linea: [
    "0xe5D7C2a6Ff4cc1428C5C4c5C4c5C4c5C4c5C4c5", // WETH
    "0xA0b86a33E6441b8C4C8C8C8C8C8C8C8C8C8C8C8", // USDC
  ]
};

// Multicall contract addresses
const MULTICALL_ADDRESSES = {
  optimism: "0xcA11bde05977b3631167028862bE2a173976CA11",
  mainnet: "0xcA11bde05977b3631167028862bE2a173976CA11",
  base: "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696",
  polygon: "0xcA11bde05977b3631167028862bE2a173976CA11",
  arbitrum: "0xcA11bde05977b3631167028862bE2a173976CA11",
  linea: "0xcA11bde05977b3631167028862bE2a173976CA11"
};

// Network symbols for native tokens
const NATIVE_SYMBOLS = {
  optimism: 'ETH',
  mainnet: 'ETH',
  base: 'ETH',
  polygon: 'MATIC',
  arbitrum: 'ETH',
  linea: 'ETH'
};

/**
 * Rate limiting utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get token metadata (name, symbol, decimals) with fallbacks
 * @param {string} addr - Token contract address
 * @param {string} type - Token type ('erc20' or 'erc721')
 * @param {Object} provider - Ethers provider
 * @returns {Promise<Object>} Token metadata
 */
async function getNameSymbolDecimals(addr, type, provider) {
  const res = { 
    name: null, 
    symbol: null, 
    decimals: (type === 'erc20' ? 18 : null) 
  };
  
  if (type === 'erc20') {
    const c20 = new ethers.Contract(addr, ERC20_ABI, provider);
    const c20b = new ethers.Contract(addr, ERC20_BYTES32_ABI, provider);
    
    try { 
      res.decimals = await c20.decimals(); 
    } catch {} 
    
    try { 
      res.symbol = await c20.symbol(); 
    } catch { 
      try {
        const raw = await c20b.symbol();
        res.symbol = ethers.toUtf8String(ethers.stripZerosRight(raw));
      } catch {}
    }
    
    try { 
      res.name = await c20.name(); 
    } catch { 
      try {
        const raw = await c20b.name();
        res.name = ethers.toUtf8String(ethers.stripZerosRight(raw));
      } catch {}
    }
  } else {
    const c721 = new ethers.Contract(addr, ERC721_ABI, provider);
    try { 
      res.symbol = await c721.symbol(); 
    } catch {}
    try { 
      res.name = await c721.name(); 
    } catch {}
  }
  
  return res;
}

/**
 * Check if contract supports ERC165 interface
 * @param {string} addr - Contract address
 * @param {string} ifaceIdHex - Interface ID
 * @param {Object} provider - Ethers provider
 * @returns {Promise<boolean>} True if interface is supported
 */
async function supportsInterface(addr, ifaceIdHex, provider) {
  try {
    const c = new ethers.Contract(addr, ERC165_ABI, provider);
    return await c.supportsInterface(ifaceIdHex);
  } catch {
    return false; // not ERC165
  }
}

/**
 * Discover tokens using multicall for known tokens
 * @param {string} walletAddress - Wallet address to scan
 * @param {string} network - Network ID
 * @returns {Promise<Object>} Discovered tokens
 */
async function discoverWithMulticall(walletAddress, network) {
  const provider = new ethers.JsonRpcProvider(getRpcUrl(network));
  const target = ethers.getAddress(walletAddress);
  
  console.log(`🔍 Multicall discovery for ${target} on ${network}`);
  
  const knownTokens = KNOWN_TOKENS[network] || [];
  const multicallAddress = MULTICALL_ADDRESSES[network];
  
  if (!multicallAddress) {
    console.log(`  ❌ No multicall address for ${network}`);
    return { erc20: [], erc721: [], erc1155: [] };
  }
  
  console.log(`  📋 Checking ${knownTokens.length} known tokens with multicall...`);
  
  const multicall = new ethers.Contract(multicallAddress, MULTICALL_ABI, provider);
  const erc20Interface = new ethers.Interface(ERC20_ABI);
  
  // Prepare multicall data for ERC-20 balance checks (with proper checksums)
  const calls = knownTokens.map(tokenAddr => {
    try {
      const checksumAddr = ethers.getAddress(tokenAddr);
      return {
        target: checksumAddr,
        callData: erc20Interface.encodeFunctionData("balanceOf", [target])
      };
    } catch (e) {
      console.log(`    ⚠️  Skipping invalid address: ${tokenAddr}`);
      return null;
    }
  }).filter(call => call !== null);
  
  if (calls.length === 0) {
    console.log(`  ❌ No valid token addresses to check`);
    return { erc20: [], erc721: [], erc1155: [] };
  }
  
  try {
    const [blockNumber, returnData] = await multicall.aggregate(calls);
    console.log(`  ✅ Multicall completed at block ${blockNumber}`);
    
    const results = {
      erc20: [],
      erc721: [],
      erc1155: []
    };
    
    // Process results
    for (let i = 0; i < calls.length; i++) {
      const tokenAddr = calls[i].target;
      const returnDataBytes = returnData[i];
      
      try {
        const balance = erc20Interface.decodeFunctionResult("balanceOf", returnDataBytes)[0];
        
        if (balance > 0n) {
          console.log(`    Found balance for ${tokenAddr}: ${balance}`);
          
          // Get token metadata
          const meta = await getNameSymbolDecimals(tokenAddr, 'erc20', provider);
          const decimals = meta.decimals ?? 18;
          const human = Number(ethers.formatUnits(balance, decimals)).toString();
          
          results.erc20.push({
            address: tokenAddr,
            name: meta.name,
            symbol: meta.symbol,
            decimals: Number(decimals),
            balance: balance.toString(),
            formattedBalance: human,
            type: 'ERC20',
            source: 'multicall'
          });
          
          console.log(`    ✅ Found ERC-20 token: ${meta.symbol || 'Unknown'} (${human})`);
        }
      } catch (e) {
        console.log(`    Error processing ${tokenAddr}: ${e.message}`);
      }
    }
    
    console.log(`  📊 Multicall found ${results.erc20.length} ERC-20 tokens with balances`);
    return results;
    
     } catch (error) {
     console.error(`  ❌ Multicall failed: ${error.message}`);
     console.log(`  🔄 Falling back to individual token checks...`);
     
     // Fallback to individual token checks
     const results = {
       erc20: [],
       erc721: [],
       erc1155: []
     };
     
     for (const tokenAddr of knownTokens) {
       try {
         const checksumAddr = ethers.getAddress(tokenAddr);
         const token = new ethers.Contract(checksumAddr, ERC20_ABI, provider);
         const balance = await token.balanceOf(target);
         
         if (balance > 0n) {
           console.log(`    Found balance for ${checksumAddr}: ${balance}`);
           
           // Get token metadata
           const meta = await getNameSymbolDecimals(checksumAddr, 'erc20', provider);
           const decimals = meta.decimals ?? 18;
           const human = Number(ethers.formatUnits(balance, decimals)).toString();
           
           results.erc20.push({
             address: checksumAddr,
             name: meta.name,
             symbol: meta.symbol,
             decimals: Number(decimals),
             balance: balance.toString(),
             formattedBalance: human,
             type: 'ERC20',
             source: 'individual_check'
           });
           
           console.log(`    ✅ Found ERC-20 token: ${meta.symbol || 'Unknown'} (${human})`);
         }
       } catch (e) {
         console.log(`    Error checking ${tokenAddr}: ${e.message}`);
       }
     }
     
     console.log(`  📊 Individual checks found ${results.erc20.length} ERC-20 tokens with balances`);
     return results;
   }
}

/**
 * Discover tokens using event log scanning
 * @param {string} walletAddress - Wallet address to scan
 * @param {string} network - Network ID
 * @returns {Promise<Object>} Discovered tokens
 */
async function discoverWithEventLogs(walletAddress, network) {
  const provider = new ethers.JsonRpcProvider(getRpcUrl(network));
  const target = ethers.getAddress(walletAddress);
  
  console.log(`🔍 Event log scanning for ${target} on ${network}`);
  
  try {
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 2000); // Reduced to 2k blocks to avoid RPC limits
    
    console.log(`  📋 Scanning blocks ${fromBlock} to ${latestBlock}...`);
    
    // Use chunked approach to avoid RPC limits
    const chunkSize = 500; // Small chunks to stay within RPC limits
    const transferLogs = [];
    
    for (let startBlock = fromBlock; startBlock <= latestBlock; startBlock += chunkSize) {
      const endBlock = Math.min(startBlock + chunkSize - 1, latestBlock);
      
      try {
        const chunkLogs = await provider.getLogs({
          topics: [TOPIC_TRANSFER, null, ethers.zeroPadValue(target, 32)],
          fromBlock: startBlock,
          toBlock: endBlock
        });
        transferLogs.push(...chunkLogs);
        
        // Add small delay to avoid overwhelming the RPC
        await sleep(100);
      } catch (chunkError) {
        console.log(`    ⚠️  Skipping chunk ${startBlock}-${endBlock}: ${chunkError.message}`);
        continue;
      }
    }
    
    console.log(`  📊 Found ${transferLogs.length} transfer events`);
    
    const uniqueTokens = new Map();
    
    for (const log of transferLogs) {
      const tokenAddr = log.address;
      if (!uniqueTokens.has(tokenAddr)) {
        try {
          // Check if it's an ERC-20 token
          const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
          const balance = await token.balanceOf(target);
          
          if (balance > 0n) {
            const meta = await getNameSymbolDecimals(tokenAddr, 'erc20', provider);
            const decimals = meta.decimals ?? 18;
            const human = Number(ethers.formatUnits(balance, decimals)).toString();
            
            uniqueTokens.set(tokenAddr, {
              address: tokenAddr,
              name: meta.name,
              symbol: meta.symbol,
              decimals: Number(decimals),
              balance: balance.toString(),
              formattedBalance: human,
              type: 'ERC20',
              source: 'event_logs'
            });
          }
        } catch (e) {
          // Skip invalid tokens
        }
      }
    }
    
    const results = {
      erc20: Array.from(uniqueTokens.values()),
      erc721: [],
      erc1155: []
    };
    
    console.log(`  📊 Event logs found ${results.erc20.length} unique tokens`);
    return results;
    
  } catch (error) {
    console.error(`  ❌ Event log scanning failed: ${error.message}`);
    return { erc20: [], erc721: [], erc1155: [] };
  }
}

/**
 * Discover tokens using Etherscan API
 * @param {string} walletAddress - Wallet address to scan
 * @param {string} network - Network ID
 * @returns {Promise<Object>} Discovered tokens
 */
async function discoverWithEtherscan(walletAddress, network) {
  console.log(`🔍 Etherscan API discovery for ${walletAddress} on ${network}`);
  
  // Use Etherscan API for comprehensive token data
  const etherscanUrls = {
    optimism: `https://api-optimistic.etherscan.io/api?module=account&action=tokentx&address=${walletAddress}&startblock=0&endblock=99999999&sort=asc&apikey=YourApiKeyToken`,
    mainnet: `https://api.etherscan.io/api?module=account&action=tokentx&address=${walletAddress}&startblock=0&endblock=99999999&sort=asc&apikey=YourApiKeyToken`,
    base: `https://api.basescan.org/api?module=account&action=tokentx&address=${walletAddress}&startblock=0&endblock=99999999&sort=asc&apikey=YourApiKeyToken`,
    polygon: `https://api.polygonscan.com/api?module=account&action=tokentx&address=${walletAddress}&startblock=0&endblock=99999999&sort=asc&apikey=YourApiKeyToken`,
    arbitrum: `https://api.arbiscan.io/api?module=account&action=tokentx&address=${walletAddress}&startblock=0&endblock=99999999&sort=asc&apikey=YourApiKeyToken`,
    linea: `https://api.lineascan.build/api?module=account&action=tokentx&address=${walletAddress}&startblock=0&endblock=99999999&sort=asc&apikey=YourApiKeyToken`
  };
  
  const url = etherscanUrls[network];
  if (!url) {
    console.log(`  ❌ No Etherscan API for ${network}`);
    return { erc20: [], erc721: [], erc1155: [] };
  }
  
  try {
    console.log(`  📋 Querying Etherscan API...`);
    const response = await fetch(url);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`  ✅ Etherscan API returned data`);
      
      const results = {
        erc20: [],
        erc721: [],
        erc1155: []
      };
      
      // Process Etherscan data
      if (data.result && Array.isArray(data.result)) {
        const uniqueTokens = new Map();
        
        for (const tx of data.result) {
          const tokenAddr = tx.contractAddress;
          if (!uniqueTokens.has(tokenAddr)) {
            uniqueTokens.set(tokenAddr, {
              address: tokenAddr,
              name: tx.tokenName,
              symbol: tx.tokenSymbol,
              decimals: parseInt(tx.tokenDecimal) || 18,
              type: 'ERC20', // Etherscan primarily shows ERC-20
              source: 'etherscan'
            });
          }
        }
        
        // Convert to array
        results.erc20 = Array.from(uniqueTokens.values());
        console.log(`  📊 Etherscan found ${results.erc20.length} unique tokens`);
      }
      
      return results;
    } else {
      console.log(`  ❌ Etherscan API failed: ${response.status}`);
    }
  } catch (error) {
    console.log(`  ❌ Etherscan API failed: ${error.message}`);
  }
  
  return { erc20: [], erc721: [], erc1155: [] };
}

/**
 * Discover native token balance
 * @param {string} walletAddress - Wallet address to scan
 * @param {string} network - Network ID
 * @returns {Promise<Object>} Native token info
 */
async function discoverNativeToken(walletAddress, network) {
  const provider = new ethers.JsonRpcProvider(getRpcUrl(network));
  const target = ethers.getAddress(walletAddress);
  
  console.log(`🔍 Native token check for ${target} on ${network}`);
  
  try {
    const nativeBalance = await provider.getBalance(target);
    console.log(`  📊 Native token balance: ${ethers.formatEther(nativeBalance)}`);
    
    if (nativeBalance > 0n) {
      const symbol = NATIVE_SYMBOLS[network] || 'Native';
      
      return {
        erc20: [{
          address: '0x0000000000000000000000000000000000000000',
          name: symbol,
          symbol: symbol,
          decimals: 18,
          balance: nativeBalance.toString(),
          formattedBalance: ethers.formatEther(nativeBalance),
          type: 'NATIVE',
          source: 'native_check'
        }],
        erc721: [],
        erc1155: []
      };
    }
  } catch (error) {
    console.log(`  ❌ Error checking native balance: ${error.message}`);
  }
  
  return { erc20: [], erc721: [], erc1155: [] };
}

/**
 * Discover tokens using comprehensive block-by-block scanning
 * @param {string} walletAddress - Wallet address to scan
 * @param {string} network - Network ID
 * @returns {Promise<Object>} Discovered tokens
 */
async function discoverWithBlockScanning(walletAddress, network) {
  const provider = new ethers.JsonRpcProvider(getRpcUrl(network));
  const target = ethers.getAddress(walletAddress);
  
  console.log(`🔍 Block-by-block scanning for ${target} on ${network}`);
  
  // Add timeout to prevent infinite scanning
  const startTime = Date.now();
  const maxScanTime = 180000; // Increased to 3 minutes for comprehensive scanning
  
  try {
    // Step 1: Get current block number
    const currentBlock = await provider.getBlockNumber();
    console.log(`  📊 Current block: ${currentBlock}`);
    
    // Step 2: First, try a quick test to see if we can get any logs at all
    console.log(`  🔍 Testing log retrieval capability...`);
    try {
      const testLogs = await provider.getLogs({
        topics: [TOPIC_TRANSFER, null, ethers.zeroPadValue(target, 32)],
        fromBlock: currentBlock - 500, // Reduced to 500 blocks to respect RPC limit
        toBlock: currentBlock
      });
      console.log(`  ✅ Test logs retrieved: ${testLogs.length} events found`);
    } catch (testError) {
      console.log(`  ⚠️  Test log retrieval failed: ${testError.message}`);
    }
    
    // Step 3: Use a more conservative approach - scan recent blocks first
    const recentBlocks = 10000; // Reduced to 10k blocks to avoid RPC limits
    const startBlock = Math.max(0, currentBlock - recentBlocks);
    
    console.log(`  📋 Scanning recent blocks ${startBlock} to ${currentBlock} (${currentBlock - startBlock + 1} blocks)`);
    
    // Step 4: Scan recent blocks for token transfers
    let discoveredTokens = await scanBlocksForTokens(provider, target, startBlock, currentBlock);
    
    // If we found tokens, great! If not, try scanning more blocks (but limit total)
    if (discoveredTokens.size === 0) {
      console.log(`  🔄 No tokens found in recent blocks, trying extended scan...`);
      
      // Try scanning the last 50k blocks (reduced from 100k)
      const extendedBlocks = 50000;
      const extendedStartBlock = Math.max(0, currentBlock - extendedBlocks);
      discoveredTokens = await scanBlocksForTokens(provider, target, extendedStartBlock, currentBlock);
    }
    
    // Step 5: Check current balances for discovered tokens
    const tokensWithBalances = await checkCurrentBalances(provider, target, discoveredTokens);
    
    console.log(`  📊 Block scanning found ${tokensWithBalances.length} tokens with balances`);
    
    // If block scanning found no tokens, try Moralis API as fallback
    if (tokensWithBalances.length === 0) {
      console.log(`  🔄 Block scanning found no tokens, trying Moralis API fallback...`);
      try {
        const moralis = require('./moralis.js');
        const moralisResult = await moralis.getAllTokensWithPrices(walletAddress, network);
        
        if (moralisResult && moralisResult.length > 0) {
          console.log(`  ✅ Moralis API found ${moralisResult.length} tokens`);
          return {
            erc20: moralisResult.filter(t => t.type === 'ERC20'),
            erc721: moralisResult.filter(t => t.type === 'ERC721'),
            erc1155: moralisResult.filter(t => t.type === 'ERC1155')
          };
        }
      } catch (moralisError) {
        console.log(`  ⚠️  Moralis API fallback failed: ${moralisError.message}`);
      }
    }
    
    return {
      erc20: tokensWithBalances.filter(t => t.type === 'ERC20'),
      erc721: tokensWithBalances.filter(t => t.type === 'ERC721'),
      erc1155: tokensWithBalances.filter(t => t.type === 'ERC1155')
    };
    
  } catch (error) {
    console.error(`  ❌ Block scanning failed: ${error.message}`);
    return { erc20: [], erc721: [], erc1155: [] };
  }
}

/**
 * Find the first transaction block for a wallet using binary search
 * @param {Object} provider - Ethers provider
 * @param {string} walletAddress - Wallet address
 * @param {number} currentBlock - Current block number
 * @returns {Promise<number|null>} First transaction block or null
 */
async function findFirstTransactionBlock(provider, walletAddress, currentBlock) {
  try {
    // Use a more efficient approach: check transaction count at different points
    console.log(`    🔍 Searching for first transaction using transaction count method...`);
    
    // Check if wallet has any transactions at all
    const currentTxCount = await provider.getTransactionCount(walletAddress);
    
    if (currentTxCount === 0) {
      console.log(`    ❌ Wallet has no transactions`);
      return null;
    }
    
    // Use a step-based approach instead of binary search
    const stepSize = 1000; // Check every 1000 blocks
    const maxLookback = Math.min(50000, currentBlock); // Reduced to 50k blocks to avoid RPC limits
    const startBlock = Math.max(0, currentBlock - maxLookback);
    
    console.log(`    🔍 Checking transaction counts from block ${startBlock} to ${currentBlock}`);
    
    // Find the first block where transaction count > 0
    for (let block = startBlock; block <= currentBlock; block += stepSize) {
      try {
        const txCount = await provider.getTransactionCount(walletAddress, block);
        
        if (txCount > 0) {
          // Found a block with transactions, now find the exact first block
          const firstBlock = await findExactFirstBlock(provider, walletAddress, Math.max(block - stepSize, 0), block);
          console.log(`    ✅ First transaction found at block ${firstBlock}`);
          return firstBlock;
        }
      } catch (error) {
        console.log(`    ⚠️  Error checking block ${block}: ${error.message}`);
        continue;
      }
    }
    
    console.log(`    ❌ No first transaction found in recent blocks`);
    return null;
    
  } catch (error) {
    console.error(`    ❌ Error finding first transaction: ${error.message}`);
    return null;
  }
}

/**
 * Find the exact first transaction block within a small range
 * @param {Object} provider - Ethers provider
 * @param {string} walletAddress - Wallet address
 * @param {number} startBlock - Start block
 * @param {number} endBlock - End block
 * @returns {Promise<number>} First transaction block
 */
async function findExactFirstBlock(provider, walletAddress, startBlock, endBlock) {
  // Use smaller steps for precise finding
  const stepSize = 100;
  
  for (let block = startBlock; block <= endBlock; block += stepSize) {
    try {
      const txCount = await provider.getTransactionCount(walletAddress, block);
      
      if (txCount > 0) {
        // Found the range, now find exact block
        for (let exactBlock = Math.max(block - stepSize, startBlock); exactBlock <= block; exactBlock++) {
          try {
            const exactTxCount = await provider.getTransactionCount(walletAddress, exactBlock);
            if (exactTxCount > 0) {
              return exactBlock;
            }
          } catch {
            continue;
          }
        }
        return block;
      }
    } catch (error) {
      continue;
    }
  }
  
  return endBlock; // Fallback
}

/**
 * Find the last transaction block for a wallet using binary search
 * @param {Object} provider - Ethers provider
 * @param {string} walletAddress - Wallet address
 * @param {number} currentBlock - Current block number
 * @returns {Promise<number|null>} Last transaction block or null
 */
async function findLastTransactionBlock(provider, walletAddress, currentBlock) {
  try {
    // Use a more efficient approach: check transaction count at different points
    console.log(`    🔍 Searching for last transaction using transaction count method...`);
    
    // Check if wallet has any transactions at all
    const currentTxCount = await provider.getTransactionCount(walletAddress);
    
    if (currentTxCount === 0) {
      console.log(`    ❌ Wallet has no transactions`);
      return null;
    }
    
    // Use a step-based approach instead of binary search
    const stepSize = 1000; // Check every 1000 blocks
    const maxLookback = Math.min(50000, currentBlock); // Reduced to 50k blocks to avoid RPC limits
    const startBlock = Math.max(0, currentBlock - maxLookback);
    
    console.log(`    🔍 Checking transaction counts from block ${startBlock} to ${currentBlock}`);
    
    // Find the last block where transaction count equals current count
    for (let block = currentBlock; block >= startBlock; block -= stepSize) {
      try {
        const txCount = await provider.getTransactionCount(walletAddress, block);
        
        if (txCount === currentTxCount) {
          // Found a block with current transaction count, now find the exact last block
          const lastBlock = await findExactLastBlock(provider, walletAddress, block, Math.min(block + stepSize, currentBlock));
          console.log(`    ✅ Last transaction found at block ${lastBlock}`);
          return lastBlock;
        }
      } catch (error) {
        console.log(`    ⚠️  Error checking block ${block}: ${error.message}`);
        continue;
      }
    }
    
    console.log(`    ❌ No last transaction found in recent blocks`);
    return currentBlock; // Fallback to current block
    
  } catch (error) {
    console.error(`    ❌ Error finding last transaction: ${error.message}`);
    return null;
  }
}

/**
 * Find the exact last transaction block within a small range
 * @param {Object} provider - Ethers provider
 * @param {string} walletAddress - Wallet address
 * @param {number} startBlock - Start block
 * @param {number} endBlock - End block
 * @returns {Promise<number>} Last transaction block
 */
async function findExactLastBlock(provider, walletAddress, startBlock, endBlock) {
  // Use smaller steps for precise finding
  const stepSize = 100;
  const currentTxCount = await provider.getTransactionCount(walletAddress);
  
  for (let block = endBlock; block >= startBlock; block -= stepSize) {
    try {
      const txCount = await provider.getTransactionCount(walletAddress, block);
      
      if (txCount === currentTxCount) {
        // Found the range, now find exact block
        for (let exactBlock = Math.min(block + stepSize, endBlock); exactBlock >= block; exactBlock--) {
          try {
            const exactTxCount = await provider.getTransactionCount(walletAddress, exactBlock);
            if (exactTxCount === currentTxCount) {
              return exactBlock;
            }
          } catch {
            continue;
          }
        }
        return block;
      }
    } catch (error) {
      continue;
    }
  }
  
  return startBlock; // Fallback
}

/**
 * Check if a specific block contains transactions for the wallet
 * @param {Object} provider - Ethers provider
 * @param {string} walletAddress - Wallet address
 * @param {number} blockNumber - Block number to check
 * @returns {Promise<boolean>} True if block contains wallet transactions
 */
async function checkBlockForWalletTransactions(provider, walletAddress, blockNumber) {
  try {
    // First, try to get transaction count for this wallet at this block
    // This is much faster than getting the full block
    try {
      const txCount = await provider.getTransactionCount(walletAddress, blockNumber);
      const txCountNext = await provider.getTransactionCount(walletAddress, blockNumber + 1);
      
      // If transaction count increased in the next block, this block contains a transaction
      if (txCountNext > txCount) {
        return true;
      }
    } catch {
      // Fallback to block scanning if transaction count method fails
    }
    
    // Fallback: Get block with transactions (slower but more reliable)
    const block = await provider.getBlock(blockNumber, true);
    
    if (!block || !block.transactions) {
      return false;
    }
    
    // Check if any transaction involves the wallet
    for (const tx of block.transactions) {
      if (tx.from?.toLowerCase() === walletAddress.toLowerCase() || 
          tx.to?.toLowerCase() === walletAddress.toLowerCase()) {
        return true;
      }
    }
    
    return false;
    
  } catch (error) {
    // If we can't get the block, assume no transactions
    return false;
  }
}

/**
 * Scan blocks for token transfers and discover unique tokens
 * @param {Object} provider - Ethers provider
 * @param {string} walletAddress - Wallet address
 * @param {number} firstBlock - First block to scan
 * @param {number} lastBlock - Last block to scan
 * @returns {Promise<Set<string>>} Set of unique token addresses
 */
async function scanBlocksForTokens(provider, walletAddress, firstBlock, lastBlock) {
  const uniqueTokens = new Set();
  const batchSize = 500; // Reduced to respect RPC 500 block limit
  const startTime = Date.now();
  const maxScanTime = 120000; // 2 minutes for comprehensive scanning
  
  console.log(`    🔍 Scanning ${lastBlock - firstBlock + 1} blocks for token transfers...`);
  
  // Scan in chunks of 500 blocks to respect RPC limits
  for (let blockNum = firstBlock; blockNum <= lastBlock; blockNum += batchSize) {
    // Check timeout
    if (Date.now() - startTime > maxScanTime) {
      console.log(`    ⏰ Timeout reached during block scanning, stopping at block ${blockNum}`);
      break;
    }
    
    const endBlock = Math.min(blockNum + batchSize - 1, lastBlock);
    
    try {
      // Get logs for ERC20 transfers TO the wallet (incoming) - most important
      const erc20Logs = await provider.getLogs({
        topics: [TOPIC_TRANSFER, null, ethers.zeroPadValue(walletAddress, 32)],
        fromBlock: blockNum,
        toBlock: endBlock
      });
      
      // Extract unique token addresses from ERC20 logs
      for (const log of erc20Logs) {
        uniqueTokens.add(log.address.toLowerCase());
      }
      
      // Only check outgoing transfers if we have time and found few tokens
      if (uniqueTokens.size < 50 && Date.now() - startTime < maxScanTime * 0.8) {
        try {
          const erc20FromLogs = await provider.getLogs({
            topics: [TOPIC_TRANSFER, ethers.zeroPadValue(walletAddress, 32), null],
            fromBlock: blockNum,
            toBlock: endBlock
          });
          
          for (const log of erc20FromLogs) {
            uniqueTokens.add(log.address.toLowerCase());
          }
        } catch (error) {
          // Skip if it fails
        }
      }
      
      // Only check ERC1155 if we have time
      if (Date.now() - startTime < maxScanTime * 0.9) {
        try {
          const erc1155Logs = await provider.getLogs({
            topics: [TOPIC_1155_TRANSFER_SINGLE, null, ethers.zeroPadValue(walletAddress, 32)],
            fromBlock: blockNum,
            toBlock: endBlock
          });
          
          for (const log of erc1155Logs) {
            uniqueTokens.add(log.address.toLowerCase());
          }
        } catch (erc1155Error) {
          // Skip ERC1155 if it fails
        }
      }
      
      // Add delay to avoid overwhelming RPC
      await sleep(10); // Small delay between batches
      
    } catch (error) {
      console.log(`    ⚠️  Error scanning blocks ${blockNum}-${endBlock}: ${error.message}`);
      
      // If we hit the block range limit, try with smaller chunks
      if (error.message.includes('500 block range') || error.message.includes('block range should work')) {
        console.log(`    🔄 Retrying with smaller chunks for blocks ${blockNum}-${endBlock}`);
        
        // Try scanning in smaller chunks (100 blocks)
        const smallerBatchSize = 100;
        for (let smallBlock = blockNum; smallBlock <= endBlock; smallBlock += smallerBatchSize) {
          const smallEndBlock = Math.min(smallBlock + smallerBatchSize - 1, endBlock);
          
          try {
            const smallLogs = await provider.getLogs({
              topics: [TOPIC_TRANSFER, null, ethers.zeroPadValue(walletAddress, 32)],
              fromBlock: smallBlock,
              toBlock: smallEndBlock
            });
            
            for (const log of smallLogs) {
              uniqueTokens.add(log.address.toLowerCase());
            }
            
            await sleep(5); // Smaller delay for smaller chunks
          } catch (smallError) {
            console.log(`    ⚠️  Error with smaller chunk ${smallBlock}-${smallEndBlock}: ${smallError.message}`);
            // Continue with next small chunk
          }
        }
      } else {
        // For other errors, continue with next batch
        continue;
      }
    }
  }
  
  console.log(`    📊 Found ${uniqueTokens.size} unique token addresses`);
  return uniqueTokens;
}

/**
 * Check current balances for discovered tokens
 * @param {Object} provider - Ethers provider
 * @param {string} walletAddress - Wallet address
 * @param {Set<string>} tokenAddresses - Set of token addresses to check
 * @returns {Promise<Array>} Array of tokens with current balances
 */
async function checkCurrentBalances(provider, walletAddress, tokenAddresses) {
  const tokensWithBalances = [];
  const batchSize = 5; // Check tokens in small batches
  
  console.log(`    🔍 Checking current balances for ${tokenAddresses.size} tokens...`);
  
  const tokenArray = Array.from(tokenAddresses);
  
  for (let i = 0; i < tokenArray.length; i += batchSize) {
    const batch = tokenArray.slice(i, i + batchSize);
    
    try {
      // Check each token in the batch
      for (const tokenAddr of batch) {
        try {
          // First, try to determine token type
          const tokenType = await determineTokenType(provider, tokenAddr);
          
          if (tokenType === 'ERC20') {
            const balance = await checkERC20Balance(provider, tokenAddr, walletAddress);
            if (balance > 0n) {
              const meta = await getNameSymbolDecimals(tokenAddr, 'erc20', provider);
              const decimals = meta.decimals ?? 18;
              const human = Number(ethers.formatUnits(balance, decimals)).toString();
              
              tokensWithBalances.push({
                address: tokenAddr,
                name: meta.name,
                symbol: meta.symbol,
                decimals: Number(decimals),
                balance: balance.toString(),
                formattedBalance: human,
                type: 'ERC20',
                source: 'block_scanning'
              });
            }
          } else if (tokenType === 'ERC721') {
            const balance = await checkERC721Balance(provider, tokenAddr, walletAddress);
            if (balance > 0n) {
              const meta = await getNameSymbolDecimals(tokenAddr, 'erc721', provider);
              
              tokensWithBalances.push({
                address: tokenAddr,
                name: meta.name,
                symbol: meta.symbol,
                balance: balance.toString(),
                formattedBalance: balance.toString(),
                type: 'ERC721',
                source: 'block_scanning'
              });
            }
          }
          // Note: ERC1155 is more complex and would need additional logic
          
        } catch (tokenError) {
          console.log(`    ⚠️  Error checking token ${tokenAddr}: ${tokenError.message}`);
        }
      }
      
      // Add small delay between batches
      await sleep(100);
      
    } catch (batchError) {
      console.log(`    ⚠️  Error processing batch: ${batchError.message}`);
    }
  }
  
  console.log(`    📊 Found ${tokensWithBalances.length} tokens with non-zero balances`);
  return tokensWithBalances;
}

/**
 * Determine the type of a token contract
 * @param {Object} provider - Ethers provider
 * @param {string} tokenAddress - Token contract address
 * @returns {Promise<string>} Token type ('ERC20', 'ERC721', 'ERC1155', or 'UNKNOWN')
 */
async function determineTokenType(provider, tokenAddress) {
  try {
    // Check for ERC165 support first
    const erc165Contract = new ethers.Contract(tokenAddress, ERC165_ABI, provider);
    
    // ERC721 interface ID
    const ERC721_INTERFACE_ID = '0x80ac58cd';
    // ERC1155 interface ID
    const ERC1155_INTERFACE_ID = '0xd9b67a26';
    
    try {
      const isERC721 = await erc165Contract.supportsInterface(ERC721_INTERFACE_ID);
      if (isERC721) return 'ERC721';
      
      const isERC1155 = await erc165Contract.supportsInterface(ERC1155_INTERFACE_ID);
      if (isERC1155) return 'ERC1155';
    } catch {
      // ERC165 not supported, try other methods
    }
    
    // Try to call ERC20 functions to determine if it's ERC20
    try {
      const erc20Contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      await erc20Contract.balanceOf(ethers.ZeroAddress);
      return 'ERC20';
    } catch {
      // Not ERC20
    }
    
    // Try to call ERC721 functions
    try {
      const erc721Contract = new ethers.Contract(tokenAddress, ERC721_ABI, provider);
      await erc721Contract.balanceOf(ethers.ZeroAddress);
      return 'ERC721';
    } catch {
      // Not ERC721
    }
    
    return 'UNKNOWN';
    
  } catch (error) {
    return 'UNKNOWN';
  }
}

/**
 * Check ERC20 token balance
 * @param {Object} provider - Ethers provider
 * @param {string} tokenAddress - Token contract address
 * @param {string} walletAddress - Wallet address
 * @returns {Promise<bigint>} Token balance
 */
async function checkERC20Balance(provider, tokenAddress, walletAddress) {
  try {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    return await contract.balanceOf(walletAddress);
  } catch (error) {
    return 0n;
  }
}

/**
 * Check ERC721 token balance
 * @param {Object} provider - Ethers provider
 * @param {string} tokenAddress - Token contract address
 * @param {string} walletAddress - Wallet address
 * @returns {Promise<bigint>} Token balance
 */
async function checkERC721Balance(provider, tokenAddress, walletAddress) {
  try {
    const contract = new ethers.Contract(tokenAddress, ERC721_ABI, provider);
    return await contract.balanceOf(walletAddress);
  } catch (error) {
    return 0n;
  }
}

/**
 * Main wallet scanner - uses multiple approaches for comprehensive coverage
 * @param {string} walletAddress - Wallet address to scan
 * @param {string} network - Network ID
 * @param {Object} options - Scanner options
 * @returns {Promise<Object>} All discovered tokens
 */
async function scanWallet(walletAddress, network, options = {}) {
  try {
    console.log(`🚀 Starting token discovery for ${walletAddress} on ${network}`);
    
    const allResults = {
      erc20: [],
      erc721: [],
      erc1155: []
    };
    
    // Approach 1: Native token check
    console.log(`\n📋 Approach 1: Native token check...`);
    const nativeResults = await discoverNativeToken(walletAddress, network);
    allResults.erc20.push(...nativeResults.erc20);
    allResults.erc721.push(...nativeResults.erc721);
    allResults.erc1155.push(...nativeResults.erc1155);
    
    // Approach 2: Multicall for known tokens
    console.log(`\n📋 Approach 2: Multicall for known tokens...`);
    const multicallResults = await discoverWithMulticall(walletAddress, network);
    allResults.erc20.push(...multicallResults.erc20);
    allResults.erc721.push(...multicallResults.erc721);
    allResults.erc1155.push(...multicallResults.erc1155);
    
         // Approach 3: Block-by-block scanning (comprehensive token discovery)
     console.log(`\n📋 Approach 3: Block-by-block scanning...`);
     const blockResults = await discoverWithBlockScanning(walletAddress, network);
     allResults.erc20.push(...blockResults.erc20);
     allResults.erc721.push(...blockResults.erc721);
     allResults.erc1155.push(...blockResults.erc1155);
    
    // Approach 4: Etherscan API (if enabled)
    if (options.useEtherscan !== false) {
      console.log(`\n📋 Approach 4: Etherscan API...`);
      const etherscanResults = await discoverWithEtherscan(walletAddress, network);
      allResults.erc20.push(...etherscanResults.erc20);
      allResults.erc721.push(...etherscanResults.erc721);
      allResults.erc1155.push(...etherscanResults.erc1155);
    }
    
    // Remove duplicates based on address
    const seen = new Set();
    const uniqueResults = {
      erc20: [],
      erc721: [],
      erc1155: []
    };
    
    for (const token of allResults.erc20) {
      if (!seen.has(token.address)) {
        seen.add(token.address);
        uniqueResults.erc20.push(token);
      }
    }
    
    for (const token of allResults.erc721) {
      if (!seen.has(token.address)) {
        seen.add(token.address);
        uniqueResults.erc721.push(token);
      }
    }
    
    for (const token of allResults.erc1155) {
      if (!seen.has(token.address)) {
        seen.add(token.address);
        uniqueResults.erc1155.push(token);
      }
    }
    
    // Sort results nicely
    uniqueResults.erc20.sort((a, b) => a.symbol?.localeCompare(b.symbol||"") ?? 0);
    uniqueResults.erc721.sort((a, b) => (a.symbol||"").localeCompare(b.symbol||""));
    uniqueResults.erc1155.sort((a, b) => (a.symbol||"").localeCompare(b.symbol||""));
    
    // Combine all results
    const allTokens = [
      ...uniqueResults.erc20,
      ...uniqueResults.erc721,
      ...uniqueResults.erc1155
    ];
    
    console.log(`\n🎯 Scanner found ${allTokens.length} total tokens:`);
    console.log(`  - ERC-20/Native: ${uniqueResults.erc20.length}`);
    console.log(`  - ERC-721: ${uniqueResults.erc721.length}`);
    console.log(`  - ERC-1155: ${uniqueResults.erc1155.length}`);
    
    return {
      success: true,
      tokens: allTokens,
      summary: {
        total: allTokens.length,
        erc20: uniqueResults.erc20.length,
        erc721: uniqueResults.erc721.length,
        erc1155: uniqueResults.erc1155.length
      },
      source: 'optimized_scanner'
    };
    
  } catch (error) {
    console.error(`❌ Scanner error for ${walletAddress} on ${network}:`, error);
    return {
      success: false,
      error: error.message,
      tokens: [],
      summary: { total: 0, erc20: 0, erc721: 0, erc1155: 0 },
      source: 'optimized_scanner'
    };
  }
}

/**
 * Multi-network wallet scanner for auto recovery compatibility
 * @param {string} walletAddress - Wallet address to scan
 * @param {Array} networks - Array of network IDs to scan
 * @param {boolean} forceRefresh - Whether to force refresh cached results
 * @returns {Promise<Object>} All discovered tokens across networks
 */
async function scanWalletForAutoRecovery(walletAddress, networks = ['mainnet', 'optimism', 'arbitrum', 'base', 'linea', 'polygon'], forceRefresh = false) {
  console.log(`🚀 Multi-Network Token Scanner Starting`);
  console.log(`📋 Wallet: ${walletAddress}`);
  console.log(`🌐 Networks: ${networks.join(', ')}`);
  console.log(`🔄 Force Refresh: ${forceRefresh}\n`);
  
  const startTime = Date.now();
  const results = {
    success: false,
    address: ethers.getAddress(walletAddress),
    totalTokens: 0,
    totalValue: 0,
    networks: {},
    summary: {
      byType: { ERC20: 0, ERC721: 0, NATIVE: 0 },
      byNetwork: {},
      bySource: {}
    },
    errors: [],
    duration: 0
  };
  
  try {
    // Process each network
    for (const network of networks) {
      console.log(`\n📡 Scanning ${network}...`);
      
      const networkResult = await scanWallet(walletAddress, network, { useEtherscan: false });
      results.networks[network] = {
        success: networkResult.success,
        count: networkResult.tokens.length,
        tokens: networkResult.tokens,
        error: networkResult.error || null
      };
      
      if (networkResult.error) {
        results.errors.push({
          network,
          error: networkResult.error
        });
      } else {
        results.totalTokens += networkResult.tokens.length;
        
        // Update summary statistics
        networkResult.tokens.forEach(token => {
          // By type
          const tokenType = token.type || 'ERC20';
          results.summary.byType[tokenType] = (results.summary.byType[tokenType] || 0) + 1;
          
          // By network
          results.summary.byNetwork[network] = (results.summary.byNetwork[network] || 0) + 1;
          
          // By source
          results.summary.bySource[token.source] = (results.summary.bySource[token.source] || 0) + 1;
        });
      }
      
      // Rate limiting between networks
      if (networks.indexOf(network) < networks.length - 1) {
        await sleep(200);
      }
    }
    
    results.success = true;
    results.duration = Date.now() - startTime;
    
    // Transform results for autoRecovery compatibility
    const autoRecoveryTokens = [];
    
    Object.entries(results.networks).forEach(([network, networkResult]) => {
      networkResult.tokens.forEach(token => {
        autoRecoveryTokens.push({
          ...token,
          // Ensure compatibility with existing autoRecovery format
          network: network,
          isScam: false, // Will be determined by autoRecovery system
          usdValue: null, // Will be calculated by autoRecovery system
          recoveryPriority: token.type === 'NATIVE' ? 'high' : 'medium'
        });
      });
    });
    
    console.log(`\n📊 SCAN RESULTS:`);
    console.log(`===============`);
    console.log(`✅ Success: ${results.success}`);
    console.log(`⏱️  Duration: ${results.duration}ms`);
    console.log(`📈 Total Tokens: ${results.totalTokens}`);
    console.log(`🌐 Networks Scanned: ${Object.keys(results.networks).length}`);
    
    if (results.summary) {
      console.log('\n📋 Summary by Type:');
      Object.entries(results.summary.byType).forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });
      
      console.log('\n📋 Summary by Network:');
      Object.entries(results.summary.byNetwork).forEach(([network, count]) => {
        console.log(`   ${network}: ${count}`);
      });
      
      console.log('\n📋 Summary by Source:');
      Object.entries(results.summary.bySource).forEach(([source, count]) => {
        console.log(`   ${source}: ${count}`);
      });
    }
    
    return {
      success: true,
      tokens: autoRecoveryTokens,
      summary: results.summary,
      networks: results.networks,
      duration: results.duration
    };
    
  } catch (error) {
    console.error(`❌ Multi-network scanner error:`, error);
    return {
      success: false,
      error: error.message,
      tokens: [],
      summary: { byType: {}, byNetwork: {}, bySource: {} },
      networks: {},
      duration: Date.now() - startTime
    };
  }
}

module.exports = {
  scanWallet,
  scanWalletForAutoRecovery,
  discoverWithMulticall,
  discoverWithEventLogs,
  discoverWithEtherscan,
  discoverWithBlockScanning,
  discoverNativeToken,
  getNameSymbolDecimals,
  supportsInterface
};
