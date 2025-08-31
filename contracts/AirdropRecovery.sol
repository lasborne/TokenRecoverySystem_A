// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AirdropRecovery
 * @dev Smart contract for recovering airdrops from hacked wallets
 * @author Senior Web3 Developer
 */
contract AirdropRecovery is ReentrancyGuard, Ownable {
    
    // Struct to store user recovery information
    struct RecoveryInfo {
        address hackedWallet;      // The hacked wallet address
        address safeWallet;        // The safe wallet to transfer funds to
        bool isActive;             // Whether this recovery is active
        uint256 lastClaimTime;     // Timestamp of last claim
        uint256 totalRecovered;    // Total amount recovered
    }
    
    // Mapping from hacked wallet to recovery info
    mapping(address => RecoveryInfo) public recoveryRegistry;
    
    // Events for tracking important actions
    event RecoveryRegistered(address indexed hackedWallet, address indexed safeWallet);
    event AirdropClaimed(address indexed token, uint256 amount, address indexed hackedWallet);
    event FundsTransferred(address indexed token, uint256 amount, address indexed safeWallet);
    event RecoveryDeactivated(address indexed hackedWallet);

    constructor(address initialOwner) Ownable(initialOwner) {}

    // Modifier to ensure only registered recoveries can perform actions
    modifier onlyRegisteredRecovery(address hackedWallet) {
        require(recoveryRegistry[hackedWallet].isActive, "Recovery not registered");
        _;
    }
    
    /**
     * @dev Register a new recovery for a hacked wallet
     * @param hackedWallet The address of the hacked wallet
     * @param safeWallet The address of the safe wallet to transfer funds to
     */
    function registerRecovery(address hackedWallet, address safeWallet) external {
        require(hackedWallet != address(0), "Invalid hacked wallet address");
        require(safeWallet != address(0), "Invalid safe wallet address");
        require(hackedWallet != safeWallet, "Wallets must be different");
        require(!recoveryRegistry[hackedWallet].isActive, "Recovery already registered");
        // Only the hacked wallet can register its own recovery to prevent hijacking
        require(msg.sender == hackedWallet, "Only hacked wallet can register");
        
        // Overwrite or create new recovery info
        recoveryRegistry[hackedWallet] = RecoveryInfo({
            hackedWallet: hackedWallet,
            safeWallet: safeWallet,
            isActive: true,
            lastClaimTime: 0,
            totalRecovered: 0
        });
        
        emit RecoveryRegistered(hackedWallet, safeWallet);
    }
    
    /**
     * @dev Claim airdrop tokens from a hacked wallet
     * @param tokenAddress The ERC20 token contract address
     * @param hackedWallet The hacked wallet address
     * @param amount The amount to claim
     * @param signature The signature for the claim (if required by airdrop contract)
     */
    function claimAirdrop(
        address tokenAddress,
        address hackedWallet,
        uint256 amount,
        bytes calldata signature
    ) external onlyRegisteredRecovery(hackedWallet) nonReentrant {
        require(tokenAddress != address(0), "Invalid token address");
        require(amount > 0, "Amount must be greater than 0");
        
        IERC20 token = IERC20(tokenAddress);
        
        // Check if the hacked wallet has enough tokens
        uint256 balance = token.balanceOf(hackedWallet);
        require(balance >= amount, "Insufficient token balance");
        
        // Check if this contract is approved to spend tokens from hacked wallet
        uint256 allowance = token.allowance(hackedWallet, address(this));
        require(allowance >= amount, "Insufficient allowance");
        
        // Transfer tokens from hacked wallet to this contract
        require(token.transferFrom(hackedWallet, address(this), amount), "Transfer failed");
        
        // Update recovery info
        RecoveryInfo storage recovery = recoveryRegistry[hackedWallet];
        recovery.lastClaimTime = block.timestamp;
        recovery.totalRecovered += amount;
        
        emit AirdropClaimed(tokenAddress, amount, hackedWallet);
        
        // Automatically transfer to safe wallet
        _transferToSafeWallet(tokenAddress, amount, recovery.safeWallet);
    }
    
    /**
     * @dev Transfer claimed tokens to the safe wallet
     * @param tokenAddress The ERC20 token contract address
     * @param amount The amount to transfer
     * @param safeWallet The safe wallet address
     */
    function _transferToSafeWallet(
        address tokenAddress,
        uint256 amount,
        address safeWallet
    ) internal {
        IERC20 token = IERC20(tokenAddress);
        
        // Transfer tokens to safe wallet
        require(token.transfer(safeWallet, amount), "Transfer to safe wallet failed");
        
        emit FundsTransferred(tokenAddress, amount, safeWallet);
    }
    
    /**
     * @dev Emergency function to transfer any ERC20 tokens from this contract
     * @param tokenAddress The ERC20 token contract address
     * @param amount The amount to transfer
     * @param recipient The recipient address
     */
    function emergencyWithdraw(
        address tokenAddress,
        uint256 amount,
        address recipient
    ) external onlyOwner {
        require(recipient != address(0), "Invalid recipient address");
        require(amount > 0, "Amount must be greater than 0");
        
        IERC20 token = IERC20(tokenAddress);
        require(token.transfer(recipient, amount), "Emergency withdrawal failed");
    }
    
    /**
     * @dev Deactivate a recovery
     * @param hackedWallet The hacked wallet address
     */
    function deactivateRecovery(address hackedWallet) external {
        require(recoveryRegistry[hackedWallet].isActive, "Recovery not active");

        RecoveryInfo storage recovery = recoveryRegistry[hackedWallet];
        // Allow the hacked wallet or the designated safe wallet to deactivate
        require(
            msg.sender == hackedWallet || msg.sender == recovery.safeWallet,
            "Not authorized"
        );

        recovery.isActive = false;
        
        emit RecoveryDeactivated(hackedWallet);
    }
    
    /**
     * @dev Get recovery information for a hacked wallet
     * @param hackedWallet The hacked wallet address
     * @return RecoveryInfo struct containing all recovery details
     */
    function getRecoveryInfo(address hackedWallet) external view returns (RecoveryInfo memory) {
        return recoveryRegistry[hackedWallet];
    }
    
    /**
     * @dev Check if a recovery is active for a given wallet
     * @param hackedWallet The hacked wallet address
     * @return bool True if recovery is active
     */
    function isRecoveryActive(address hackedWallet) external view returns (bool) {
        return recoveryRegistry[hackedWallet].isActive;
    }
    
    /**
     * @dev Receive function to accept ETH
     */
    receive() external payable {
        // Contract can receive ETH for gas fees
    }
    
    /**
     * @dev Fallback function
     */
    fallback() external payable {
        // Fallback function
    }
} 