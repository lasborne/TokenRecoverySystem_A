// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20
 * @dev Mock ERC20 token for testing purposes
 * @author Senior Web3 Developer
 */
contract MockERC20 is ERC20, Ownable {
    
    /**
     * @dev Constructor that gives msg.sender all of initial tokens
     * @param name The name of the token
     * @param symbol The symbol of the token
     */
    constructor(string memory name, string memory symbol) ERC20(name, symbol) Ownable(msg.sender) {
        // Mint initial supply to deployer
        _mint(msg.sender, 1000000 * 10**decimals());
    }
    
    /**
     * @dev Mint new tokens (only owner)
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    /**
     * @dev Burn tokens from caller
     * @param amount The amount of tokens to burn
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
    
    /**
     * @dev Burn tokens from specific address (only owner)
     * @param from The address to burn tokens from
     * @param amount The amount of tokens to burn
     */
    function burnFrom(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
} 