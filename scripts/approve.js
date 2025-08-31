#!/usr/bin/env node
const { ethers } = require('ethers');
const yargs = require('yargs');

const argv = yargs
  .option('token', { type: 'string', demandOption: true, describe: 'ERC-20 token contract address' })
  .option('wallet', { type: 'string', demandOption: true, describe: 'Private key of the wallet to approve from' })
  .option('spender', { type: 'string', demandOption: true, describe: 'Recovery contract address to approve' })
  .option('amount', { type: 'string', demandOption: true, describe: 'Amount to approve (in wei)' })
  .option('rpc', { type: 'string', demandOption: false, describe: 'RPC URL', default: process.env.MAINNET_RPC_URL })
  .argv;

async function main() {
  const provider = new ethers.JsonRpcProvider(argv.rpc);
  const wallet = new ethers.Wallet(argv.wallet, provider);
  const abi = ["function approve(address spender, uint256 amount) public returns (bool)"];
  const token = new ethers.Contract(argv.token, abi, wallet);
  console.log(`Approving ${argv.amount} tokens for ${argv.spender} from ${wallet.address}...`);
  const tx = await token.approve(argv.spender, argv.amount);
  console.log('Transaction sent:', tx.hash);
  await tx.wait();
  console.log('Approval successful!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
}); 