import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  SendTransactionError
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  createCloseAccountInstruction,
  getAccount,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import bs58 from "bs58";

/**
 * Derive a Keypair from user-provided secret input.
 * Accepts:
 *  - JSON array of 64 bytes (e.g., "[12,34,...]")
 *  - base58 encoded secret key string
 */
function keypairFromInput(secretInput) {
  if (!secretInput || typeof secretInput !== 'string') {
    throw new Error('Invalid secret input');
  }
  const trimmed = secretInput.trim();
  try {
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const arr = JSON.parse(trimmed);
      const bytes = Uint8Array.from(arr);
      return Keypair.fromSecretKey(bytes);
    }
  } catch (e) {
    // fallthrough to base58 path
  }
  // Try base58
  try {
    const bytes = bs58.decode(trimmed);
    return Keypair.fromSecretKey(bytes);
  } catch (e) {
    throw new Error('Secret input must be a JSON byte array or base58-encoded secret key');
  }
}

async function resolveWorkingRpcUrl(userRpcUrl, onLog) {
  const candidates = [];
  // Highest priority: explicit user input from form
  if (userRpcUrl && typeof userRpcUrl === 'string' && userRpcUrl.trim().length > 0) candidates.push(userRpcUrl.trim());

  // Prefer server-provided SOLANA_RPC_URL (root .env) so we don't rely on client-side env injection
  try {
    const r = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/config`);
    if (r.ok) {
      const cfg = await r.json();
      if (cfg?.solanaRpcUrl) candidates.push(cfg.solanaRpcUrl);
    }
  } catch (_) { /* ignore */ }

  // Legacy fallback (if baked into client build)
  if (process.env.SOLANA_RPC_URL) candidates.push(process.env.SOLANA_RPC_URL);
  if (process.env.REACT_APP_SOLANA_RPC_URL) candidates.push(process.env.REACT_APP_SOLANA_RPC_URL);
  // Public fallbacks
  candidates.push('https://api.mainnet-beta.solana.com');
  candidates.push('https://rpc.ankr.com/solana');

  for (const url of candidates) {
    try {
      // Try browser direct first
      const testConn = new Connection(url, 'confirmed');
      await testConn.getLatestBlockhash('confirmed');
      if (onLog) onLog(`Using RPC: ${url}`);
      return url;
    } catch (e) {
      // If browser-origin blocked (403), note it and continue
      if (onLog) onLog(`RPC unavailable (${url}): ${e?.message || e}`);
      continue;
    }
  }
  throw new Error('No working Solana RPC endpoint available. Provide a valid RPC URL (with API key if required).');
}

async function withPriority(ixs, cuLimit, cuPriceMicroLamports) {
  const pre = [];
  if (cuLimit && Number.isFinite(cuLimit)) {
    pre.push(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
  }
  if (cuPriceMicroLamports && Number.isFinite(cuPriceMicroLamports)) {
    pre.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPriceMicroLamports }));
  }
  return [...pre, ...ixs];
}

function computePriorityPriceMicroLamports({ baseFeeLamports, cuLimit, percent = 0.03 }) {
  try {
    const effectiveCuLimit = Math.max(50_000, Math.min(Number.isFinite(cuLimit) ? cuLimit : 400_000, 600_000));
    const baseline = Math.max(1, Number(baseFeeLamports || 0));
    const pct = Math.max(0.02, Math.min(percent, 0.05));
    const desiredExtraLamports = Math.max(1, Math.floor(baseline * pct));
    // extraFee(lamports) ≈ price(µLamports/CU) * usedCUs / 1e6; approximate usedCUs by effectiveCuLimit for an upper bound
    const priceMicroLamports = Math.ceil((desiredExtraLamports * 1_000_000) / effectiveCuLimit);
    return Math.max(1, priceMicroLamports);
  } catch (_) {
    return 1; // minimal non-zero priority
  }
}

async function accountExists(connection, publicKey) {
  try {
    const info = await connection.getAccountInfo(publicKey, 'confirmed');
    return !!info;
  } catch (_) {
    return false;
  }
}

async function getMinimumAtaRentLamports(connection) {
  try {
    // Classic token account size is 165 bytes; Token-2022 may vary with extensions, but ATA rent is close.
    return await connection.getMinimumBalanceForRentExemption(165, 'confirmed');
  } catch (_) {
    // Fallback to ~0.00204 SOL on mainnet at time of writing
    return 2_100_000; // lamports
  }
}

async function sendChunk({ connection, payer, instructions, cuLimit, cuPriceMicroLamports }) {
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: await withPriority(instructions, cuLimit, cuPriceMicroLamports)
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([payer]);
    const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  } catch (e) {
    // Surface simulation logs if available
    if (e instanceof SendTransactionError) {
      const logs = await e.getLogs?.();
      const details = Array.isArray(logs) && logs.length > 0 ? ` Logs: ${JSON.stringify(logs)}` : '';
      throw new Error(`Simulation failed. Message: ${e.message}.${details}`);
    }
    throw e;
  }
}

async function estimateTxFeeLamports(connection, payerPublicKey, instructions) {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: payerPublicKey,
    recentBlockhash: blockhash,
    instructions
  }).compileToV0Message();
  const res = await connection.getFeeForMessage(msg, 'confirmed');
  return Number(res?.value || 0);
}

/**
 * Perform Solana rescue from a compromised wallet to a safe wallet.
 * All signing happens client-side.
 */
export async function rescueNow({
  secretInput,
  destinationAddress,
  rpcUrl,
  onLog,
  onProgress,
  cuLimit = 400_000,
  cuPriceMicroLamports = 0,
  bufferLamports = 50_000,
  solOnly = false,
  shouldCancel
}) {
  const log = (m) => { if (onLog) onLog(m); };
  const progress = (p) => { if (onProgress) onProgress(p); };

  // Resolve a working RPC URL with graceful fallbacks (handles 403 Access Forbidden from restricted RPCs)
  const RPC_URL = await resolveWorkingRpcUrl(rpcUrl || process.env.REACT_APP_SOLANA_RPC_URL, onLog);
  const connection = new Connection(RPC_URL, 'confirmed');
  if (shouldCancel && shouldCancel()) { log('Rescue cancelled'); return false; }

  const SOURCE = keypairFromInput(secretInput);
  const DEST = new PublicKey(destinationAddress);

  log('Connected to Solana RPC');
  progress({ step: 'connected' });

  // Determine a small priority fee (~3% of baseline fee) if none provided
  let priorityPrice = cuPriceMicroLamports;
  try {
    if (!priorityPrice || priorityPrice <= 0) {
      const baseProbe = [SystemProgram.transfer({ fromPubkey: SOURCE.publicKey, toPubkey: SOURCE.publicKey, lamports: 1 })];
      const baseFee = await estimateTxFeeLamports(connection, SOURCE.publicKey, baseProbe);
      priorityPrice = computePriorityPriceMicroLamports({ baseFeeLamports: baseFee, cuLimit, percent: 0.03 });
      log(`Applying priority fee (~3%): ${priorityPrice} µLamports/CU`);
    }
  } catch (_) { /* best-effort; fall back silently */ }

  // Pre-sweep excess SOL above 0.01 SOL before token operations
  try {
    const thresholdLamports = Math.floor(0.01 * LAMPORTS_PER_SOL);
    const bal0 = await connection.getBalance(SOURCE.publicKey, 'confirmed');
    if (bal0 > thresholdLamports) {
      const feeProbeIx = SystemProgram.transfer({ fromPubkey: SOURCE.publicKey, toPubkey: DEST, lamports: 1 });
      const feeLamports = await estimateTxFeeLamports(connection, SOURCE.publicKey, await withPriority([feeProbeIx], cuLimit, priorityPrice));
      let toSend = bal0 - thresholdLamports - feeLamports - bufferLamports;
      if (toSend > 0) {
        let attempts = 5;
        let sentSig = null;
        while (attempts > 0 && toSend > 0 && !sentSig) {
          if (shouldCancel && shouldCancel()) { log('Rescue cancelled'); return false; }
          const ixs = await withPriority([SystemProgram.transfer({ fromPubkey: SOURCE.publicKey, toPubkey: DEST, lamports: toSend })], cuLimit, priorityPrice);
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
          const msg = new TransactionMessage({ payerKey: SOURCE.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
          const tx = new VersionedTransaction(msg);
          tx.sign([SOURCE]);
          const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
          if (sim?.value?.err) {
            toSend = Math.max(0, toSend - 20_000);
            attempts -= 1;
            continue;
          }
          const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
          await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
          sentSig = sig;
        }
        if (sentSig) {
          log(`Pre-swept excess SOL: ${((bal0 - thresholdLamports) / LAMPORTS_PER_SOL).toFixed(9)} SOL (targeted), sig: ${sentSig}`);
        } else {
          log('Pre-sweep skipped after simulation retries.');
        }
      }
    }
  } catch (e) {
    log(`Pre-sweep failed: ${e?.message || e}`);
  }

  const tokenPrograms = solOnly ? [] : [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];

  // Discover token accounts with positive balance and compute USD value using server pricing
  const discovered = [];
  for (const programId of tokenPrograms) {
    if (shouldCancel && shouldCancel()) { log('Rescue cancelled'); return false; }
    const resp = await connection.getTokenAccountsByOwner(SOURCE.publicKey, { programId });
    for (const { pubkey } of resp.value) {
      if (shouldCancel && shouldCancel()) { log('Rescue cancelled'); return false; }
      try {
        const acc = await getAccount(connection, pubkey, 'confirmed', programId);
        if (acc.amount > 0n) {
          discovered.push({ pubkey, programId, mint: acc.mint, amount: acc.amount });
        }
      } catch (_) { /* skip unparsable */ }
    }
  }
  // fetch mint decimals and price via backend (Moralis), compute USD value
  const enriched = [];
  for (const item of discovered) {
    try {
      const mintInfo = await getMint(connection, item.mint, 'confirmed', item.programId).catch(() => null);
      const decimals = mintInfo?.decimals ?? 0;
      let usdPrice = 0;
      try {
        const resp = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/solana/token-price?mint=${item.mint.toBase58()}`, { method: 'GET' });
        if (resp.ok) {
          const data = await resp.json();
          usdPrice = Number(data?.usdPrice || 0);
        }
      } catch (_) { /* ignore price errors */ }
      const amountUi = Number(item.amount) / Math.pow(10, decimals || 0);
      const usdValue = amountUi * usdPrice;
      enriched.push({ ...item, decimals, usdPrice, usdValue });
    } catch (_) {
      enriched.push({ ...item, decimals: 0, usdPrice: 0, usdValue: 0 });
    }
  }
  // Sort by usdValue desc
  enriched.sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
  const tokenAccounts = enriched;
  log(`Found ${tokenAccounts.length} token accounts with positive balances`);

  // Low-SOL sequential rescue: attempt token-by-token; if dest ATA missing and balance can fund rent+fees, create ATA, transfer, then close source to reclaim rent; else postpone and retry after progress
  if (!solOnly && tokenAccounts.length > 0) {
    const pending = [...tokenAccounts];
    const minAtaRent = await getMinimumAtaRentLamports(connection);
    const feeSafety = 10_000; // small buffer for fee variance
    let pass = 0;
    while (pending.length > 0) {
      if (shouldCancel && shouldCancel()) { log('Rescue cancelled'); return false; }
      pass += 1;
      let progressed = 0;
      for (let idx = 0; idx < pending.length; idx++) {
        const { pubkey: srcTokenAcc, programId } = pending[idx];
        try {
          if (shouldCancel && shouldCancel()) { log('Rescue cancelled'); return false; }
          const acc = await getAccount(connection, srcTokenAcc, 'confirmed', programId);
          const destATA = getAssociatedTokenAddressSync(acc.mint, DEST, true, programId);

          const instructions = [];
          const destExists = await accountExists(connection, destATA);
          if (!destExists) {
            const balNow = await connection.getBalance(SOURCE.publicKey, 'processed');
            if (balNow < (minAtaRent + feeSafety)) {
              log(`Pass ${pass}: Insufficient SOL (${balNow}) to create ATA for mint ${acc.mint.toBase58()} (need ~${minAtaRent}). Postponing.`);
              continue; // keep pending for next pass
            }
            instructions.push(
              createAssociatedTokenAccountIdempotentInstruction(
                SOURCE.publicKey, destATA, DEST, acc.mint, programId
              )
            );
          }

          // Transfer full amount
          instructions.push(
            createTransferInstruction(
              srcTokenAcc,
              destATA,
              SOURCE.publicKey,
              acc.amount,
              [],
              programId
            )
          );
          // Close source to reclaim rent
          instructions.push(
            createCloseAccountInstruction(
              srcTokenAcc,
              SOURCE.publicKey,
              SOURCE.publicKey,
              [],
              programId
            )
          );

          // Fee guard: estimate and ensure solvency before sending
          // Estimate fee for a realistic instruction set:
          const feeProbe = await withPriority([
            SystemProgram.transfer({ fromPubkey: SOURCE.publicKey, toPubkey: SOURCE.publicKey, lamports: 1 })
          ], cuLimit, priorityPrice);
          const estimatedFee = await estimateTxFeeLamports(connection, SOURCE.publicKey, feeProbe);
          const balNow2 = await connection.getBalance(SOURCE.publicKey, 'processed');
          const needsRent = destExists ? 0 : minAtaRent;
          if (balNow2 < (needsRent + estimatedFee + feeSafety)) {
            log(`Pass ${pass}: Balance ${balNow2} too low for mint ${acc.mint.toBase58()} (need ~${needsRent + estimatedFee}). Postponing.`);
            continue;
          }

          if (shouldCancel && shouldCancel()) { log('Rescue cancelled'); return false; }
          const sig = await sendChunk({ connection, payer: SOURCE, instructions, cuLimit, cuPriceMicroLamports: priorityPrice });
          log(`Saved token ${acc.mint.toBase58()} and closed source account. sig: ${sig}`);
          // Remove from pending
          pending.splice(idx, 1);
          idx -= 1;
          progressed += 1;
        } catch (e) {
          log(`Token save failed for index ${idx}: ${e.message || e}`);
          // keep pending for next pass
        }
      }
      if (progressed === 0) {
        log(`No further progress possible with current SOL. Remaining tokens: ${pending.length}.`);
        break;
      }
    }
  }

  // Sweep SOL last (fee-aware). Include small priority fee to encourage quick inclusion.
  try {
    const bal = await connection.getBalance(SOURCE.publicKey, 'confirmed');
    if (bal <= 0) {
      log('No SOL to sweep');
      progress({ step: 'done' });
      return true;
    }
    const feeProbeIx = SystemProgram.transfer({ fromPubkey: SOURCE.publicKey, toPubkey: DEST, lamports: 1 });
    const feeLamports = await estimateTxFeeLamports(connection, SOURCE.publicKey, await withPriority([feeProbeIx], cuLimit, priorityPrice));
    let toSend = bal - feeLamports - bufferLamports;
    if (toSend <= 0) {
      log(`SOL too low to sweep after fees. Balance=${bal} lamports, estFee=${feeLamports}, buffer=${bufferLamports}.`);
    } else {
      // Retry with small decrements if simulation complains about rent/fees
      let attempts = 5;
      let sentSig = null;
      while (attempts > 0 && toSend > 0 && !sentSig) {
        if (shouldCancel && shouldCancel()) { log('Rescue cancelled'); return false; }
        const ixs = await withPriority([SystemProgram.transfer({ fromPubkey: SOURCE.publicKey, toPubkey: DEST, lamports: toSend })], cuLimit, priorityPrice);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        const msg = new TransactionMessage({ payerKey: SOURCE.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
        const tx = new VersionedTransaction(msg);
        tx.sign([SOURCE]);

        const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
        if (sim?.value?.err) {
          // back off by 20k lamports and retry
          toSend = Math.max(0, toSend - 20_000);
          attempts -= 1;
          continue;
        }

        const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        sentSig = sig;
      }
      if (sentSig) {
        log(`SOL sweep sent: ${(toSend / LAMPORTS_PER_SOL).toFixed(9)} SOL, sig: ${sentSig}`);
      } else {
        log('SOL sweep aborted after simulation retries; balance likely too low after fees.');
      }
    }
  } catch (e) {
    if (e instanceof SendTransactionError) {
      const logs = await e.getLogs?.();
      const details = Array.isArray(logs) && logs.length > 0 ? ` Logs: ${JSON.stringify(logs)}` : '';
      log(`SOL sweep failed: ${e.message || e}.${details}`);
    } else {
      log(`SOL sweep failed: ${e.message || e}`);
    }
  }

  progress({ step: 'done' });
  return true;
}

const SolanaRecovery = { rescueNow };
export default SolanaRecovery;

// --- utilities to close an ATA after tokens are emptied ---
export async function closeAta({
  secretInput,
  rpcUrl,
  ownerAddress,
  mintAddress,
  rentRecipientAddress,
  onLog
}) {
  const log = (m) => { if (onLog) onLog(m); };
  const RPC_URL = await resolveWorkingRpcUrl(rpcUrl || process.env.SOLANA_RPC_URL || process.env.REACT_APP_SOLANA_RPC_URL, onLog);
  const connection = new Connection(RPC_URL, 'confirmed');

  const SOURCE = keypairFromInput(secretInput);
  const OWNER = new PublicKey(ownerAddress);
  const MINT = new PublicKey(mintAddress);
  const RENT_TO = new PublicKey(rentRecipientAddress || ownerAddress);

  const ata = getAssociatedTokenAddressSync(MINT, OWNER, true, TOKEN_PROGRAM_ID);
  const tokenAcc = await getAccount(connection, ata, 'confirmed', TOKEN_PROGRAM_ID).catch(() => null);
  if (!tokenAcc) {
    log('ATA does not exist or already closed');
    return { success: true, ata: ata.toBase58(), skipped: true };
  }
  if (tokenAcc.amount > 0n) {
    throw new Error('ATA has non-zero token balance. Transfer tokens out before closing.');
  }

  // Build close instruction with small priority fee (~3%) and estimate fee
  let priorityPrice = 0;
  try {
    const baseProbe = [SystemProgram.transfer({ fromPubkey: SOURCE.publicKey, toPubkey: SOURCE.publicKey, lamports: 1 })];
    const baseFee = await estimateTxFeeLamports(connection, SOURCE.publicKey, baseProbe);
    priorityPrice = computePriorityPriceMicroLamports({ baseFeeLamports: baseFee, cuLimit: 200_000, percent: 0.03 });
  } catch (_) { priorityPrice = 1; }
  const ix = createCloseAccountInstruction(ata, RENT_TO, OWNER, [], TOKEN_PROGRAM_ID);
  const feeLamports = await estimateTxFeeLamports(connection, SOURCE.publicKey, await withPriority([ix], 200_000, priorityPrice));
  const bal = await connection.getBalance(SOURCE.publicKey, 'processed');
  if (bal < feeLamports) {
    throw new Error(`Insufficient SOL for close (have ${bal}, need ~${feeLamports}).`);
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({ payerKey: SOURCE.publicKey, recentBlockhash: blockhash, instructions: await withPriority([ix], 200_000, priorityPrice) }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([SOURCE]);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  log(`Closed ATA ${ata.toBase58()} → rent to ${RENT_TO.toBase58()} sig ${sig}`);
  return { success: true, signature: sig, ata: ata.toBase58() };
}


