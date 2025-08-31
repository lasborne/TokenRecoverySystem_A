const { run } = require("hardhat");

/**
 * Verify the deployed AirdropRecovery contract on Etherscan
 * @param {string} contractAddress - The deployed contract address
 * @param {string} network - The network name
 */
async function verifyContract(contractAddress, network, arg1) {
  console.log(`🔍 Verifying contract ${contractAddress} on ${network}...`);
  
  try {
    // Verify the contract
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: [arg1], // Add constructor arguments if any
    });
    
    console.log("✅ Contract verified successfully!");
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log("ℹ️ Contract is already verified");
    } else {
      console.error("❌ Verification failed:", error.message);
    }
  }
}

/**
 * Main verification function
 */
async function main() {
  const fs = require('fs');
  const path = require('path');
  const { network } = require("hardhat");
  
  // Get network name from Hardhat environment
  const networkName = network.name;
  const deploymentFile = path.join(__dirname, `../deployments/${networkName}.json`);
  
  if (!fs.existsSync(deploymentFile)) {
    console.error(`❌ Deployment file not found: ${deploymentFile}`);
    console.log("💡 Please run the deployment script first");
    process.exit(1);
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  // Allow contract address override via command-line argument
  // Usage: npx hardhat run scripts/verify.js --network base <contractAddress>
  let contractAddress = process.argv[3] || deploymentInfo.contractAddress;
  let arg1 = deploymentInfo.deployer;

  if (!contractAddress || contractAddress === "" || contractAddress === undefined) {
    console.error(`❌ Contract address not found in deployment file: ${deploymentFile}`);
    console.error(`Deployment file contents:`, deploymentInfo);
    console.log("💡 Make sure the contract was deployed and the deployment file contains the correct 'contractAddress' key, or pass the address as an argument.");
    process.exit(1);
  }

  console.log(`🚀 Starting verification for ${networkName}...`);
  console.log(`📝 Contract address: ${contractAddress}`);
  
  await verifyContract(contractAddress, networkName, arg1);
}

// Handle errors
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Verification failed:", error);
    process.exit(1);
  }); 