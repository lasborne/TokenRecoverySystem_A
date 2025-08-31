require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const { ethers } = require("ethers");
const { parseEther } = require("ethers");
const { setupEnv } = require("./scripts/setup-env");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    // Mainnet configuration
    mainnet: {
      url: process.env.MAINNET_RPC_URL || "https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 20000000000 // 20 gwei
    },
    // Base mainnet configuration
    base: {
      url: process.env.BASE_RPC_URL || "https://base.blockpi.network/v1/rpc/public",
      accounts: process.env.PRIVATE_KEY ? [
        process.env.PRIVATE_KEY, 
        process.env.PRIVATE_KEY1,
        process.env.PRIVATE_KEY2, 
        process.env.PRIVATE_KEY3
      ].filter(key => key) : [],
      gasPrice: 1000000 // 0.001 gwei (increased from 0.001 gwei)
    },
    // Goerli testnet configuration
    goerli: {
      url: process.env.GOERLI_RPC_URL || "https://eth-goerli.g.alchemy.com/v2/YOUR_API_KEY",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 20000000000 // 20 gwei
    },
    // Polygon mainnet
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 30000000000 // 30 gwei
    },
    // Linea mainnet configuration
    linea: {
      url: process.env.LINEA_RPC_URL || "https://rpc.linea.build",
      accounts: process.env.PRIVATE_KEY ? [
        process.env.PRIVATE_KEY, 
        process.env.PRIVATE_KEY1,
        process.env.PRIVATE_KEY2, 
        process.env.PRIVATE_KEY3
      ].filter(key => key) : [],
      gasPrice: 5000000 // 0.005 gwei in wei (static cap)
    },
    // Arbitrum mainnet configuration
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [
        process.env.PRIVATE_KEY, 
        process.env.PRIVATE_KEY1,
        process.env.PRIVATE_KEY2, 
        process.env.PRIVATE_KEY3
      ].filter(key => key) : [],
      gasPrice: 100000000 // 0.1 gwei
    },
    // Optimism mainnet configuration
    optimism: {
      url: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
      accounts: process.env.PRIVATE_KEY ? [
        process.env.PRIVATE_KEY, 
        process.env.PRIVATE_KEY1,
        process.env.PRIVATE_KEY2, 
        process.env.PRIVATE_KEY3
      ].filter(key => key) : [],
      gasPrice: 1000000 // 0.001 gwei
    },
    // Local development network
    hardhat: {
      chainId: 1337,
      accounts: [
        process.env.PRIVATE_KEY,
        process.env.PRIVATE_KEY1,
        process.env.PRIVATE_KEY2,
        process.env.PRIVATE_KEY3
      ].filter(key => key).map(privateKey => ({
        privateKey: privateKey,
        balance: (parseEther("10000")).toString() // Give each account 10,000 ETH for testing
      }))
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY, // Use only the Etherscan v2 API key for all networks
    customChains: [
      {
        network: "linea",
        chainId: 59144, // Linea mainnet chain ID
        urls: {
          apiURL: "https://api.etherscan.io/v2/", // Etherscan v2 endpoint
          browserURL: "https://lineascan.build"
        }
      },
      {
        network: "base",
        chainId: 8453, // Base mainnet chain ID
        urls: {
          apiURL: "https://api.etherscan.io/v2/", // Etherscan v2 endpoint
          browserURL: "https://basescan.org"
        }
      },
      {
        network: "optimism",
        chainId: 10, // Optimism mainnet chain ID
        urls: {
          apiURL: "https://api.etherscan.io/v2/", // Etherscan v2 endpoint
          browserURL: "https://optimistic.etherscan.io"
        }
      },
      {
        network: "arbitrum",
        chainId: 42161, // Arbitrum One mainnet chain ID
        urls: {
          apiURL: "https://api.etherscan.io/v2/", // Etherscan v2 endpoint
          browserURL: "https://arbiscan.io"
        }
      }
    ]
  },
  gasReporter: {
    enabled: true, // Disable gas reporter to prevent null reference errors
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    excludeContracts: [],
    src: "./contracts/",
    noColors: true,
    outputFile: "gas-report.txt"
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
}; 