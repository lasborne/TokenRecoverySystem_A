const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

console.log('🔧 Setting up environment variables for testing...\n');

// Check if .env file exists
const envPath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', 'env.example');

if (!fs.existsSync(envPath)) {
  console.log('📝 Creating .env file from env.example...');
  
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('✅ .env file created from env.example');
  } else {
    console.log('❌ env.example not found. Creating basic .env file...');
    
    const basicEnvContent = `# Server Configuration
PORT=5000
NODE_ENV=development

# Blockchain RPC URLs
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/OZ6UHxdhtN7Qz2AQhEyPqZ8BhRsUtCLR
BASE_RPC_URL=https://mainnet.base.org
POLYGON_RPC_URL=https://polygon-rpc.com
GOERLI_RPC_URL=https://eth-goerli.g.alchemy.com/v2/OZ6UHxdhtN7Qz2AQhEyPqZ8BhRsUtCLR
LINEA_RPC_URL=https://rpc.linea.build
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
OPTIMISM_RPC_URL=https://mainnet.optimism.io

# Contract Addresses (Deploy contracts and get the address)
MAINNET_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
BASE_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
POLYGON_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
GOERLI_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
LINEA_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
ARBITRUM_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
OPTIMISM_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000

# Private Keys for Testing (REQUIRED for tests to use your accounts)
# Generate these using: node -e "console.log(require('ethers').Wallet.createRandom().privateKey)"
PRIVATE_KEY1=935451a7e2f639d6a2902b8fa1316617bfe29cdeacebd5401e03c19c03863bd2
PRIVATE_KEY3=111e6e091acfba33d98b9dacabe73ddcf56c309a914d0549b4b5acd8989612ee
PRIVATE_KEY2=08663586d99987f862e30ca7892f75cfad8183f8d21c12059bbf4f56dd72c71d
PRIVATE_KEY=3c810472bee81cf28bed9fab296226fc796380520066439fe99aa2f00a14bb1c


# Client URL for CORS
CLIENT_URL=http://localhost:3000

# API Keys (Optional - for enhanced token detection)
BASESCAN_API_KEY=https://mainnet.base.org
COVALENT_API_KEY=your_covalent_api_key
MORALIS_API_KEY=your_moralis_api_key

# Database Configuration (for production)
DATABASE_URL=your_database_url_here

# Security
JWT_SECRET=your_jwt_secret_here
SESSION_SECRET=your_session_secret_here

# Monitoring
SENTRY_DSN=your_sentry_dsn_here
`;
    
    fs.writeFileSync(envPath, basicEnvContent);
    console.log('✅ Basic .env file created');
  }
} else {
  console.log('✅ .env file already exists');
}

// Generate test private keys if they don't exist
const envContent = fs.readFileSync(envPath, 'utf8');
const lines = envContent.split('\n');

let hasPrivateKeys = false;
for (const line of lines) {
  if (line.startsWith('PRIVATE_KEY=') && !line.includes('your_private_key_here')) {
    hasPrivateKeys = true;
    break;
  }
}

if (!hasPrivateKeys) {
  console.log('\n🔑 Generating test private keys...');
  
  const newLines = [];
  for (const line of lines) {
    if (line.startsWith('PRIVATE_KEY=') && line.includes('your_private_key_here')) {
      newLines.push(`PRIVATE_KEY=${ethers.Wallet.createRandom().privateKey}`);
    } else if (line.startsWith('PRIVATE_KEY1=') && line.includes('your_second_private_key_here')) {
      newLines.push(`PRIVATE_KEY1=${ethers.Wallet.createRandom().privateKey}`);
    } else if (line.startsWith('PRIVATE_KEY2=') && line.includes('your_third_private_key_here')) {
      newLines.push(`PRIVATE_KEY2=${ethers.Wallet.createRandom().privateKey}`);
    } else if (line.startsWith('PRIVATE_KEY3=') && line.includes('your_fourth_private_key_here')) {
      newLines.push(`PRIVATE_KEY3=${ethers.Wallet.createRandom().privateKey}`);
    } else {
      newLines.push(line);
    }
  }
  
  fs.writeFileSync(envPath, newLines.join('\n'));
  console.log('✅ Test private keys generated and added to .env file');
} else {
  console.log('✅ Private keys already configured in .env file');
}

console.log('\n📋 Next steps:');
console.log('1. Review your .env file and update with your actual private keys if needed');
console.log('2. Run tests with: npm test');
console.log('3. The test accounts will now match your configured private keys');
console.log('\n⚠️  WARNING: Never commit your .env file with real private keys to version control!');
console.log('   Make sure .env is in your .gitignore file.'); 