const { ethers, network } = require("hardhat");
const initialOwner = "0xCF7869798aa5132Ef4A245fAE10aC79aB7e62375";

/**
 * Deploy the AirdropRecovery contract
 * @param {string} network - The network to deploy to
 */
async function main() {
  console.log("🚀 Starting AirdropRecovery contract deployment...");

  
  
  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  //console.log("💰 Account balance:", (await deployer.getBalance()).toString());
  
  // Get the contract factory
  const AirdropRecovery = await ethers.getContractFactory("AirdropRecovery", deployer);

  // Deploy the contract
  console.log("🔨 Deploying AirdropRecovery...");
  let airdropRecovery;
  if (network.name === 'linea') {
    // Dynamic gas price for Linea
    const provider = deployer.provider;
    let feeData = await provider.getFeeData();
    let gasPrice = feeData.gasPrice;
    const maxGasPrice = 50000000n; // 0.05 gwei in wei
    if (gasPrice > maxGasPrice) gasPrice = maxGasPrice;
    airdropRecovery = await AirdropRecovery.deploy(initialOwner, { gasPrice });
  } else {
    airdropRecovery = await AirdropRecovery.deploy(initialOwner);
  }
  
  // Wait for deployment to complete
  await airdropRecovery.waitForDeployment();
  
  console.log("✅ AirdropRecovery deployed to:", await airdropRecovery.getAddress());
  
  // Verify the deployment
  console.log("🔍 Verifying deployment...");
  const owner = await airdropRecovery.owner();
  console.log("👑 Contract owner:", owner);
  
  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    contractAddress: await airdropRecovery.getAddress(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    blockNumber: await airdropRecovery.deploymentTransaction().blockNumber
  };
  
  console.log("📊 Deployment Summary:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
  
  // Save to file for easy reference
  const fs = require('fs');
  const path = require('path');
  
  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  // Verify the file was written correctly
  const savedInfo = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  if (!savedInfo.contractAddress) {
    throw new Error("Failed to save contract address to deployment file");
  }
  
  console.log(`💾 Deployment info saved to: ${deploymentFile}`);
  console.log(`📝 Contract address saved: ${savedInfo.contractAddress}`);
  console.log("🎉 Deployment completed successfully!");
  
  return airdropRecovery;
}

// Handle errors
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }); 