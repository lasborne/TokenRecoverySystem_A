# Airdrop Recovery System

A comprehensive Web3 application for claiming airdrops on hacked EVM wallets and transferring them to safe wallets. Built with React, Node.js, Ethers.js, and Solidity.

## 🚀 Features

- **Multi-Network Support**: Optimism, Ethereum Mainnet, Arbitrum, Base, Polygon, Linea
- **Comprehensive Token Discovery**: ERC-20, ERC-721, ERC-1155, and Native tokens
- **Automated Recovery**: Monitor and claim airdrops automatically
- **Secure Smart Contracts**: Audited and secure recovery contracts
- **Real-time Monitoring**: Continuous monitoring of registered wallets
- **User-friendly Interface**: Modern React frontend with dark/light themes
- **API Integration**: Moralis, Etherscan, and multicall support

## 🏗️ Architecture

### Backend (Node.js/Express)
- **Modular Services**: Recovery, Auto-Recovery, Pricing, Token Storage
- **Optimized Scanner**: Consolidated token discovery with multiple approaches
- **API Routes**: RESTful endpoints for all operations
- **Validation**: Comprehensive input validation and error handling
- **Security**: Rate limiting, CORS, helmet, compression

### Frontend (React)
- **Modern UI**: Tailwind CSS with responsive design
- **Theme Support**: Dark and light mode
- **Component Architecture**: Modular, reusable components
- **State Management**: React hooks and context
- **Wallet Integration**: MetaMask and other Web3 wallets

### Smart Contracts (Solidity)
- **AirdropRecovery**: Main recovery contract with security features
- **MockERC20**: Testing contract for development
- **Security**: ReentrancyGuard, Ownable, proper access controls

## 📁 Project Structure

```
airdrop-recovery-system/
├── 📁 contracts/                 # Smart contracts
│   ├── AirdropRecovery.sol      # Main recovery contract
│   └── MockERC20.sol            # Test token contract
├── 📁 server/                   # Backend application
│   ├── 📁 config/              # Network configurations
│   ├── 📁 routes/              # API route handlers
│   ├── 📁 services/            # Business logic services
│   └── 📁 utils/               # Utility functions
│       ├── scanner.js          # Optimized token scanner
│       ├── moralis.js          # Moralis API integration
│       ├── multicall.js        # Multicall utilities
│       ├── ethers.js           # Ethers.js utilities
│       └── validation.js       # Input validation
├── 📁 client/                  # Frontend application
│   ├── 📁 src/                # React source code
│   ├── package.json           # Frontend dependencies
│   └── tailwind.config.js     # Tailwind configuration
├── 📁 src/                    # Alternative frontend (legacy)
├── 📁 scripts/                # Deployment and setup scripts
├── 📁 test/                   # Smart contract tests
├── 📁 deployments/            # Contract deployment addresses
├── server.js                  # Main server entry point
├── package.json               # Backend dependencies
├── hardhat.config.js          # Hardhat configuration
├── docker-compose.yml         # Docker orchestration
├── Dockerfile                 # Docker configuration
└── README.md                  # This file
```

## 🛠️ Installation

### Prerequisites
- Node.js 16+ and npm
- Git

### Quick Start
```bash
# Clone the repository
git clone <repository-url>
cd airdrop-recovery-system

# Run the quick start script
chmod +x quick-start.sh
./quick-start.sh
```

### Manual Installation
```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd client && npm install && cd ..

# Copy environment template
cp env.example .env

# Edit .env with your configuration
# Add API keys, private keys, and contract addresses
```

## ⚙️ Configuration

### Environment Variables
Create a `.env` file with the following variables:

```env
# Network RPC URLs
OPTIMISM_RPC_URL=your_optimism_rpc_url
MAINNET_RPC_URL=your_mainnet_rpc_url
ARBITRUM_RPC_URL=your_arbitrum_rpc_url
BASE_RPC_URL=your_base_rpc_url
LINEA_RPC_URL=your_linea_rpc_url
POLYGON_RPC_URL=your_polygon_rpc_url

# API Keys
MORALIS_API_KEY=your_moralis_api_key
ETHERSCAN_API_KEY=your_etherscan_api_key

# Private Keys (KEEP SECURE!)
PRIVATE_KEY=your_private_key

# Contract Addresses (after deployment)
RECOVERY_CONTRACT_ADDRESS=deployed_contract_address

# Server Configuration
PORT=5000
NODE_ENV=development
```

## 🚀 Usage

### Development
```bash
# Start backend server
npm run dev

# Start frontend (in another terminal)
cd client && npm start
```

### Production
```bash
# Build frontend
npm run build

# Start production server
npm start
```

### Docker Deployment
```bash
# Build and run with Docker Compose
docker-compose up -d
```

## 🔧 Smart Contract Deployment

### Local Development
```bash
# Start local Hardhat node
npx hardhat node

# Deploy contracts locally
npx hardhat run scripts/deploy.js --network localhost
```

### Testnet Deployment
```bash
# Deploy to Goerli testnet
npx hardhat run scripts/deploy.js --network goerli

# Verify contracts on Etherscan
npx hardhat run scripts/verify.js --network goerli
```

## 🧪 Testing

### Smart Contract Tests
```bash
# Run all tests
npx hardhat test

# Run tests with coverage
npx hardhat coverage
```

### API Tests
```bash
# Test API endpoints
curl http://localhost:5000/api/health
```

## 📊 API Endpoints

### Core Endpoints
- `POST /api/register-recovery` - Register a new recovery
- `GET /api/active-recoveries` - Get all active recoveries
- `POST /api/deactivate-recovery` - Deactivate a recovery
- `POST /api/claim-airdrop` - Claim airdrop tokens
- `GET /api/token-balances` - Get wallet token balances

### Utility Endpoints
- `GET /api/health` - Health check
- `POST /api/test-scanner` - Test token scanner
- `POST /api/test-multicall` - Test multicall functionality

## 🔍 Token Discovery

The system uses multiple approaches for comprehensive token discovery:

1. **Native Token Check**: Check native token (ETH, MATIC, etc.) balances
2. **Multicall**: Batch query known token balances efficiently
3. **Event Log Scanning**: Scan transfer events for token discovery
4. **Etherscan API**: Use Etherscan for historical token data
5. **Moralis API**: Comprehensive token and NFT data

## 🛡️ Security Features

- **Reentrancy Protection**: Smart contracts use ReentrancyGuard
- **Access Control**: Only authorized wallets can perform operations
- **Input Validation**: Comprehensive validation on all inputs
- **Rate Limiting**: API rate limiting to prevent abuse
- **Error Handling**: Robust error handling and logging
- **Private Key Security**: Secure private key management

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This software is provided "as is" without warranty. Users are responsible for:
- Securing their private keys
- Understanding the risks of Web3 operations
- Testing thoroughly before mainnet use
- Complying with local regulations

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review the test files for examples

## 🔄 Changelog

### v1.0.0 (Latest)
- ✅ Optimized and refactored codebase
- ✅ Consolidated scanner utilities
- ✅ Removed redundant files and documentation
- ✅ Improved error handling and validation
- ✅ Enhanced multi-network support
- ✅ Updated documentation and structure

---

**Built with ❤️ for the Web3 community** 