const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ZeroAddress, parseEther, MaxUint256 } = require("ethers");
require("dotenv").config();

describe("AirdropRecovery", function () {
  // Increase timeout for network tests
  this.timeout(120000); // 2 minutes timeout
  
  let AirdropRecovery;
  let airdropRecovery;
  let MockERC20;
  let mockToken;
  let owner;
  let user1;
  let user2;
  let user3;

  beforeEach(async function () {
    // Use private keys from .env file to create signers
    // This ensures the accounts match your configured private keys
    const privateKeys = [
      process.env.PRIVATE_KEY,
      process.env.PRIVATE_KEY1,
      process.env.PRIVATE_KEY2,
      process.env.PRIVATE_KEY3
    ].filter(key => key); // Filter out undefined keys

    // If we have private keys, use them; otherwise fall back to test accounts
    if (privateKeys.length >= 4) {
      // Create signers from private keys
      const provider = ethers.provider;
      owner = new ethers.Wallet(privateKeys[0], provider);
      user1 = new ethers.Wallet(privateKeys[1], provider);
      user2 = new ethers.Wallet(privateKeys[2], provider);
      user3 = new ethers.Wallet(privateKeys[3], provider);
      
      console.log("Using private keys from .env file");
    } else {
      // Fall back to test accounts if private keys are not available
      [owner, user1, user2, user3] = await ethers.getSigners();
      console.log("Using Hardhat test accounts (private keys not found in .env)");
    }

    // Deploy the AirdropRecovery contract
    AirdropRecovery = await ethers.getContractFactory("AirdropRecovery");
    airdropRecovery = await AirdropRecovery.deploy(owner.address);
    await airdropRecovery.waitForDeployment();

    // Deploy mock ERC20 token for testing
    MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Test Token", "TEST");
    await mockToken.waitForDeployment();

    // Log the addresses being used for debugging
    console.log("Test Accounts:");
    console.log("Owner:", owner.address);
    console.log("User1:", user1.address);
    console.log("User2:", user2.address);
    console.log("User3:", user3.address);
    console.log("Contract:", await airdropRecovery.getAddress());
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      // Test that the deployer is set as owner
      expect(await airdropRecovery.owner()).to.equal(owner.address);
    });

    it("Should have correct contract address", async function () {
      // Test contract deployment was successful
      expect(await airdropRecovery.getAddress()).to.not.equal(ZeroAddress);
    });

    it("Should deploy MockERC20 correctly", async function () {
      // Test that mock token was deployed correctly
      expect(await mockToken.name()).to.equal("Test Token");
      expect(await mockToken.symbol()).to.equal("TEST");
      expect(await mockToken.decimals()).to.equal(18);
    });
  });

  describe("Recovery Registration", function () {
    it("Should allow hacked wallet to register a recovery", async function () {
      // Register a recovery as the hacked wallet
      await airdropRecovery.connect(user1).registerRecovery(user1.address, user2.address);
      
      // Check if recovery is registered
      const recovery = await airdropRecovery.getRecoveryInfo(user1.address);
      expect(recovery.hackedWallet).to.equal(user1.address);
      expect(recovery.safeWallet).to.equal(user2.address);
      expect(recovery.isActive).to.be.true;
      expect(recovery.totalRecovered).to.equal(0n);
    });

    it("Should emit RecoveryRegistered event", async function () {
      // Register recovery and check event (must be called by hacked wallet)
      await expect(airdropRecovery.connect(user1).registerRecovery(user1.address, user2.address))
        .to.emit(airdropRecovery, "RecoveryRegistered")
        .withArgs(user1.address, user2.address);
    });

    it("Should not allow someone else to register for a hacked wallet", async function () {
      // Try to register recovery where msg.sender != hackedWallet
      await expect(
        airdropRecovery.connect(user2).registerRecovery(user1.address, user3.address)
      ).to.be.revertedWith("Only hacked wallet can register");
    });

    it("Should not allow registration with zero addresses", async function () {
      // Test zero address validation
      await expect(
        airdropRecovery.connect(user1).registerRecovery(ZeroAddress, user2.address)
      ).to.be.revertedWith("Invalid hacked wallet address");

      await expect(
        airdropRecovery.connect(user1).registerRecovery(user1.address, ZeroAddress)
      ).to.be.revertedWith("Invalid safe wallet address");
    });

    it("Should not allow same wallet addresses", async function () {
      // Test that hacked and safe wallets must be different
      await expect(
        airdropRecovery.connect(user1).registerRecovery(user1.address, user1.address)
      ).to.be.revertedWith("Wallets must be different");
    });

    it("Should not allow duplicate registration", async function () {
      // Register recovery first time (must be called by hacked wallet)
      await airdropRecovery.connect(user1).registerRecovery(user1.address, user2.address);
      
      // Try to register same wallet again
      await expect(
        airdropRecovery.connect(user1).registerRecovery(user1.address, user3.address)
      ).to.be.revertedWith("Recovery already registered");
    });
  });

  describe("Airdrop Claiming", function () {
    beforeEach(async function () {
      // Register a recovery for testing as the hacked wallet
      await airdropRecovery.connect(user1).registerRecovery(user1.address, user2.address);
    });

    it("Should claim ERC20 tokens and transfer to safe wallet", async function () {
      // Mint tokens to hacked wallet (user1) - only owner can mint
      const amount = parseEther("100");
      await mockToken.mint(user1.address, amount);
      
      // Check initial balances
      expect(await mockToken.balanceOf(user1.address)).to.equal(amount);
      expect(await mockToken.balanceOf(user2.address)).to.equal(0n);
      
      // Approve recovery contract to spend tokens (user1 approves)
      const approvalTx = await mockToken.connect(user1).approve(await airdropRecovery.getAddress(), amount);
      await approvalTx.wait(); // Wait for approval transaction
      
      // Verify approval was set correctly
      const allowance = await mockToken.allowance(user1.address, await airdropRecovery.getAddress());
      expect(allowance).to.equal(amount);
      
      // Claim airdrop (owner calls this function)
      await expect(airdropRecovery.claimAirdrop(
        await mockToken.getAddress(),
        user1.address,
        amount,
        "0x"
      )).to.emit(airdropRecovery, "AirdropClaimed")
        .withArgs(await mockToken.getAddress(), amount, user1.address);
      
      // Check that tokens were transferred to safe wallet
      expect(await mockToken.balanceOf(user2.address)).to.equal(amount);
      expect(await mockToken.balanceOf(user1.address)).to.equal(0n);
    });

    it("Should emit FundsTransferred event", async function () {
      // Mint tokens to hacked wallet
      const amount = parseEther("50");
      await mockToken.mint(user1.address, amount);
      
      // Approve recovery contract to spend tokens
      const approvalTx = await mockToken.connect(user1).approve(await airdropRecovery.getAddress(), amount);
      await approvalTx.wait(); // Wait for approval transaction
      
      // Verify approval was set correctly
      const allowance = await mockToken.allowance(user1.address, await airdropRecovery.getAddress());
      expect(allowance).to.equal(amount);
      
      // Claim airdrop and check for transfer event
      await expect(airdropRecovery.claimAirdrop(
        await mockToken.getAddress(),
        user1.address,
        amount,
        "0x"
      )).to.emit(airdropRecovery, "FundsTransferred")
        .withArgs(await mockToken.getAddress(), amount, user2.address);
    });

    it("Should update recovery statistics after claim", async function () {
      // Mint and claim tokens
      const amount = parseEther("50");
      await mockToken.mint(user1.address, amount);
      
      // Approve recovery contract to spend tokens
      const approvalTx = await mockToken.connect(user1).approve(await airdropRecovery.getAddress(), amount);
      await approvalTx.wait(); // Wait for approval transaction
      
      // Verify approval was set correctly
      const allowance = await mockToken.allowance(user1.address, await airdropRecovery.getAddress());
      expect(allowance).to.equal(amount);
      
      const beforeRecovery = await airdropRecovery.getRecoveryInfo(user1.address);
      await airdropRecovery.claimAirdrop(await mockToken.getAddress(), user1.address, amount, "0x");
      const afterRecovery = await airdropRecovery.getRecoveryInfo(user1.address);
      
      // Check that total recovered increased
      expect(afterRecovery.totalRecovered).to.equal(beforeRecovery.totalRecovered + amount);
      expect(afterRecovery.lastClaimTime).to.be.gt(beforeRecovery.lastClaimTime);
    });

    it("Should not allow claiming from unregistered wallet", async function () {
      // Try to claim from unregistered wallet
      await expect(
        airdropRecovery.claimAirdrop(
          await mockToken.getAddress(),
          user3.address,
          parseEther("10"),
          "0x"
        )
      ).to.be.revertedWith("Recovery not registered");
    });

    it("Should not allow claiming more than available balance", async function () {
      // Mint small amount
      const mintedAmount = parseEther("10");
      const claimAmount = parseEther("20");
      
      await mockToken.mint(user1.address, mintedAmount);
      await mockToken.connect(user1).approve(await airdropRecovery.getAddress(), claimAmount);
      
      // Try to claim more than available
      await expect(
        airdropRecovery.claimAirdrop(await mockToken.getAddress(), user1.address, claimAmount, "0x")
      ).to.be.revertedWith("Insufficient token balance");
    });

    it("Should not allow claiming with zero amount", async function () {
      await expect(
        airdropRecovery.claimAirdrop(
          await mockToken.getAddress(),
          user1.address,
          0n,
          "0x"
        )
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should not allow claiming with invalid token address", async function () {
      const amount = parseEther("10");
      await expect(
        airdropRecovery.claimAirdrop(
          ZeroAddress,
          user1.address,
          amount,
          "0x"
        )
      ).to.be.revertedWith("Invalid token address");
    });
  });

  describe("Recovery Management", function () {
    beforeEach(async function () {
      // Register a recovery as the hacked wallet
      await airdropRecovery.connect(user1).registerRecovery(user1.address, user2.address);
    });

    it("Should allow hacked wallet to deactivate recovery", async function () {
      // Check that recovery is initially active
      expect(await airdropRecovery.isRecoveryActive(user1.address)).to.be.true;
      
      // Deactivate recovery by hacked wallet
      await expect(airdropRecovery.connect(user1).deactivateRecovery(user1.address))
        .to.emit(airdropRecovery, "RecoveryDeactivated")
        .withArgs(user1.address);
      
      // Check that recovery is inactive
      const recovery = await airdropRecovery.getRecoveryInfo(user1.address);
      expect(recovery.isActive).to.be.false;
      expect(await airdropRecovery.isRecoveryActive(user1.address)).to.be.false;
    });

    it("Should allow safe wallet to deactivate recovery", async function () {
      // Deactivate recovery by the designated safe wallet
      await expect(airdropRecovery.connect(user2).deactivateRecovery(user1.address))
        .to.emit(airdropRecovery, "RecoveryDeactivated")
        .withArgs(user1.address);
    });

    it("Should not allow unrelated account to deactivate recovery", async function () {
      // Try to deactivate from an unrelated account
      await expect(
        airdropRecovery.connect(user3).deactivateRecovery(user1.address)
      ).to.be.revertedWith("Not authorized");
    });

    it("Should not allow deactivating inactive recovery", async function () {
      // Deactivate first time
      await airdropRecovery.connect(user1).deactivateRecovery(user1.address);
      
      // Try to deactivate again
      await expect(
        airdropRecovery.connect(user1).deactivateRecovery(user1.address)
      ).to.be.revertedWith("Recovery not active");
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow owner to emergency withdraw tokens", async function () {
      // Transfer tokens to contract
      const amount = parseEther("100");
      await mockToken.mint(await airdropRecovery.getAddress(), amount);
      
      // Check initial balance
      expect(await mockToken.balanceOf(await airdropRecovery.getAddress())).to.equal(amount);
      expect(await mockToken.balanceOf(user1.address)).to.equal(0n);
      
      // Emergency withdraw
      await airdropRecovery.emergencyWithdraw(await mockToken.getAddress(), amount, user1.address);
      
      // Check that tokens were withdrawn
      expect(await mockToken.balanceOf(user1.address)).to.equal(amount);
      expect(await mockToken.balanceOf(await airdropRecovery.getAddress())).to.equal(0n);
    });

    it("Should not allow non-owner to emergency withdraw", async function () {
      const amount = parseEther("100");
      await mockToken.mint(await airdropRecovery.getAddress(), amount);
      
      // Try emergency withdraw from non-owner
      await expect(
        airdropRecovery.connect(user1).emergencyWithdraw(await mockToken.getAddress(), amount, user2.address)
      ).to.be.revertedWithCustomError(airdropRecovery, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });

    it("Should not allow emergency withdraw with zero amount", async function () {
      await expect(
        airdropRecovery.emergencyWithdraw(await mockToken.getAddress(), 0n, user1.address)
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should not allow emergency withdraw to zero address", async function () {
      const amount = parseEther("100");
      await mockToken.mint(await airdropRecovery.getAddress(), amount);
      
      await expect(
        airdropRecovery.emergencyWithdraw(await mockToken.getAddress(), amount, ZeroAddress)
      ).to.be.revertedWith("Invalid recipient address");
    });
  });

  describe("Contract Events", function () {
    it("Should emit all expected events during recovery process", async function () {
      // Register recovery as the hacked wallet
      await expect(airdropRecovery.connect(user1).registerRecovery(user1.address, user2.address))
        .to.emit(airdropRecovery, "RecoveryRegistered")
        .withArgs(user1.address, user2.address);
      
      // Mint and claim tokens
      const amount = parseEther("100");
      await mockToken.mint(user1.address, amount);
      
      // Approve recovery contract to spend tokens
      const approvalTx = await mockToken.connect(user1).approve(await airdropRecovery.getAddress(), amount);
      await approvalTx.wait(); // Wait for approval transaction
      
      // Verify approval was set correctly
      const allowance = await mockToken.allowance(user1.address, await airdropRecovery.getAddress());
      expect(allowance).to.equal(amount);
      
      // Claim should emit both AirdropClaimed and FundsTransferred events
      const tx = await airdropRecovery.claimAirdrop(
        await mockToken.getAddress(),
        user1.address,
        amount,
        "0x"
      );
      
      const receipt = await tx.wait();
      
      // Check that both events were emitted
      const airdropClaimedEvent = receipt.logs.find(
        log => log.eventName === "AirdropClaimed"
      );
      const fundsTransferredEvent = receipt.logs.find(
        log => log.eventName === "FundsTransferred"
      );
      
      expect(airdropClaimedEvent).to.not.be.undefined;
      expect(fundsTransferredEvent).to.not.be.undefined;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple claims from same wallet", async function () {
      // Register recovery
      await airdropRecovery.connect(user1).registerRecovery(user1.address, user2.address);
      
      // First claim
      const amount1 = parseEther("50");
      await mockToken.mint(user1.address, amount1);
      
      // Approve for first claim
      const approvalTx1 = await mockToken.connect(user1).approve(await airdropRecovery.getAddress(), amount1);
      await approvalTx1.wait();
      
      // Wait a bit for network stability
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await airdropRecovery.claimAirdrop(await mockToken.getAddress(), user1.address, amount1, "0x");
      
      // Second claim
      const amount2 = parseEther("30");
      await mockToken.mint(user1.address, amount2);
      
      // Approve for second claim
      const approvalTx2 = await mockToken.connect(user1).approve(await airdropRecovery.getAddress(), amount2);
      await approvalTx2.wait();
      
      // Wait a bit for network stability
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await airdropRecovery.claimAirdrop(await mockToken.getAddress(), user1.address, amount2, "0x");
      
      // Check total recovered
      const recovery = await airdropRecovery.getRecoveryInfo(user1.address);
      expect(recovery.totalRecovered).to.equal(amount1 + amount2);
      
      // Check safe wallet balance
      expect(await mockToken.balanceOf(user2.address)).to.equal(amount1 + amount2);
    });

    it("Should handle deactivation and reactivation", async function () {
      // Register recovery
      await airdropRecovery.connect(user1).registerRecovery(user1.address, user2.address);
      
      // Deactivate
      await airdropRecovery.connect(user1).deactivateRecovery(user1.address);
      expect(await airdropRecovery.isRecoveryActive(user1.address)).to.be.false;
      
      // Try to claim after deactivation (should fail)
      const amount = parseEther("50");
      await mockToken.mint(user1.address, amount);
      
      // Approve tokens (this will succeed but the claim will fail)
      const approvalTx = await mockToken.connect(user1).approve(await airdropRecovery.getAddress(), amount);
      await approvalTx.wait();
      
      await expect(
        airdropRecovery.claimAirdrop(await mockToken.getAddress(), user1.address, amount, "0x")
      ).to.be.revertedWith("Recovery not registered");
    });
  });
}); 