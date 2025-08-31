/**
 * Server-side network configuration
 * Centralized network configuration for consistent handling across the server
 */

const NETWORKS = {
  mainnet: {
    id: 'mainnet',
    name: 'Ethereum Mainnet',
    chainId: '0x1',
    rpcUrl: process.env.MAINNET_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
    rpcUrl2: process.env.MAINNET_RPC_URL2 || 'https://eth-mainnet.public.blastapi.io',
    contractAddress: process.env.MAINNET_CONTRACT_ADDRESS,
    blockExplorer: 'https://etherscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    gasPrice: 20000000000, // 20 gwei
    isTestnet: false
  },
  base: {
    id: 'base',
    name: 'Base Mainnet',
    chainId: '0x2105',
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    rpcUrl2: process.env.BASE_RPC_URL2 || 'https://base.blockpi.network/v1/rpc/public',
    contractAddress: process.env.BASE_CONTRACT_ADDRESS,
    blockExplorer: 'https://basescan.org',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    gasPrice: 1000000, // 0.001 gwei
    isTestnet: false
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainId: '0x89',
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    rpcUrl2: process.env.POLYGON_RPC_URL2 || 'https://polygon.llamarpc.com',
    contractAddress: process.env.POLYGON_CONTRACT_ADDRESS,
    blockExplorer: 'https://polygonscan.com',
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18
    },
    gasPrice: 30000000000, // 30 gwei
    isTestnet: false
  },
  linea: {
    id: 'linea',
    name: 'Linea Mainnet',
    chainId: '0xe708',
    rpcUrl: process.env.LINEA_RPC_URL || 'https://rpc.linea.build',
    rpcUrl2: process.env.LINEA_RPC_URL2 || 'https://linea.drpc.org',
    contractAddress: process.env.LINEA_CONTRACT_ADDRESS,
    blockExplorer: 'https://lineascan.build',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    gasPrice: 5000000, // 0.005 gwei
    isTestnet: false
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum Mainnet',
    chainId: '0xa4b1',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    rpcUrl2: process.env.ARBITRUM_RPC_URL2 || 'https://arbitrum-one.public.blastapi.io',
    contractAddress: process.env.ARBITRUM_CONTRACT_ADDRESS,
    blockExplorer: 'https://arbiscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    gasPrice: 100000000, // 0.1 gwei
    isTestnet: false
  },
  optimism: {
    id: 'optimism',
    name: 'Optimism Mainnet',
    chainId: '0xa',
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    rpcUrl2: process.env.OPTIMISM_RPC_URL2 || 'https://optimism.public.blastapi.io',
    contractAddress: process.env.OPTIMISM_CONTRACT_ADDRESS,
    blockExplorer: 'https://optimistic.etherscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    gasPrice: 1000000, // 0.001 gwei
    isTestnet: false
  },
  goerli: {
    id: 'goerli',
    name: 'Goerli Testnet',
    chainId: '0x5',
    rpcUrl: process.env.GOERLI_RPC_URL || 'https://eth-goerli.g.alchemy.com/v2/YOUR_API_KEY',
    rpcUrl2: process.env.GOERLI_RPC_URL2 || 'https://eth-goerli.public.blastapi.io',
    contractAddress: process.env.GOERLI_CONTRACT_ADDRESS,
    blockExplorer: 'https://goerli.etherscan.io',
    nativeCurrency: {
      name: 'Goerli Ether',
      symbol: 'ETH',
      decimals: 18
    },
    gasPrice: 20000000000, // 20 gwei
    isTestnet: true
  }
};

/**
 * Get network configuration by ID
 * @param {string} networkId - The network identifier
 * @returns {Object|null} Network configuration or null if not found
 */
const getNetworkConfig = (networkId) => {
  return NETWORKS[networkId] || null;
};

/**
 * Get all supported networks
 * @returns {Object} All network configurations
 */
const getAllNetworks = () => {
  return NETWORKS;
};

/**
 * Get mainnet networks only
 * @returns {Object} Mainnet network configurations
 */
const getMainnetNetworks = () => {
  return Object.fromEntries(
    Object.entries(NETWORKS).filter(([_, config]) => !config.isTestnet)
  );
};

/**
 * Get testnet networks only
 * @returns {Object} Testnet network configurations
 */
const getTestnetNetworks = () => {
  return Object.fromEntries(
    Object.entries(NETWORKS).filter(([_, config]) => config.isTestnet)
  );
};

/**
 * Validate if a network is supported
 * @param {string} networkId - The network identifier
 * @returns {boolean} True if supported, false otherwise
 */
const isNetworkSupported = (networkId) => {
  return networkId in NETWORKS;
};

/**
 * Get network name by ID
 * @param {string} networkId - The network identifier
 * @returns {string} Network name or 'Unknown Network'
 */
const getNetworkName = (networkId) => {
  const network = getNetworkConfig(networkId);
  return network ? network.name : 'Unknown Network';
};

/**
 * Get chain ID by network ID
 * @param {string} networkId - The network identifier
 * @returns {string|null} Chain ID or null if not found
 */
const getChainId = (networkId) => {
  const network = getNetworkConfig(networkId);
  return network ? network.chainId : null;
};

/**
 * Get contract address for a network
 * @param {string} networkId - The network identifier
 * @returns {string|null} Contract address or null if not found
 */
const getContractAddress = (networkId) => {
  const network = getNetworkConfig(networkId);
  return network ? network.contractAddress : null;
};

/**
 * Get RPC URL for a network
 * @param {string} networkId - The network identifier
 * @param {boolean} useFallback - Whether to use fallback RPC URL
 * @returns {string|null} RPC URL or null if not found
 */
const getRpcUrl = (networkId, useFallback = false) => {
  const network = getNetworkConfig(networkId);
  if (!network) return null;
  
  return useFallback ? network.rpcUrl2 : network.rpcUrl;
};

/**
 * Get gas price for a network
 * @param {string} networkId - The network identifier
 * @returns {number|null} Gas price or null if not found
 */
const getGasPrice = (networkId) => {
  const network = getNetworkConfig(networkId);
  return network ? network.gasPrice : null;
};

module.exports = {
  NETWORKS,
  getNetworkConfig,
  getAllNetworks,
  getMainnetNetworks,
  getTestnetNetworks,
  isNetworkSupported,
  getNetworkName,
  getChainId,
  getContractAddress,
  getRpcUrl,
  getGasPrice
}; 