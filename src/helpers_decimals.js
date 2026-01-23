// Helper to get correct decimals for any token address
import { Contract } from 'ethers'
import { Connection, PublicKey } from '@solana/web3.js'

// Cache for fetched decimals to avoid repeated calls
const decimalsCache = new Map()

// ERC20 ABI for decimals function
const ERC20_ABI = [
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' }
]

// Function to fetch decimals from chain or backend with robust fallbacks
export const fetchTokenDecimals = async (tokenAddr, provider, network = 'bsc') => {
  if (!tokenAddr) return 18
  const addrKey = tokenAddr.toString().toLowerCase()

  // Use cache if available
  if (decimalsCache.has(addrKey)) {
    return decimalsCache.get(addrKey)
  }

  // For crosschain, use fallback since provider may not match token network
  if (network === 'crosschain') {
    const fallback = getTokenDecimalsFallback(tokenAddr)
    decimalsCache.set(addrKey, fallback)
    return fallback
  }

  // Resolve indexer base (same pattern used elsewhere in app)
  let INDEXER_BASE = 'https://cookbook-hjnhgq.fly.dev'
  try {
    INDEXER_BASE = import.meta?.env?.VITE_INDEXER_BASE || INDEXER_BASE
  } catch (_) {}
  console.log('INDEXER_BASE set to:', INDEXER_BASE)

  try {
    if (network === 'solana') {
      // Prefer backend API for Solana to avoid RPC 403 and ensure consistency
      try {
        const res = await fetch(`${INDEXER_BASE}/api/token/info?network=solana&address=${tokenAddr}`)
        if (res.ok) {
          const json = await res.json()
          const d = Number(json?.decimals)
          if (Number.isFinite(d)) {
            decimalsCache.set(addrKey, d)
            return d
          }
        }
      } catch (_) {
        // ignore and fallback to RPC
      }

      // Fallback: query Solana RPC and parse mint (may be rate limited in browsers)
      try {
        const connection = new Connection('https://api.mainnet-beta.solana.com')
        const info = await connection.getParsedAccountInfo(new PublicKey(tokenAddr))
        const decimals = info?.value?.data?.parsed?.info?.decimals
        if (typeof decimals === 'number') {
          decimalsCache.set(addrKey, decimals)
          return decimals
        }
        const raw = await connection.getAccountInfo(new PublicKey(tokenAddr))
        if (raw && raw.data && raw.data.length >= 45) {
          const d = raw.data[44]
          if (typeof d === 'number') {
            decimalsCache.set(addrKey, d)
            return d
          }
        }
      } catch (_) {
        // ignore and fallback to hardcoded
      }

      // Final fallback
      return getTokenDecimalsFallback(tokenAddr)
    }

    // EVM chains
    if (!provider) {
      // If no provider, fallback to known mappings
      return getTokenDecimalsFallback(tokenAddr)
    }
    const contract = new Contract(addrKey, ERC20_ABI, provider)
    const d = await contract.decimals()
    const decimalsNum = Number(d)
    decimalsCache.set(addrKey, decimalsNum)
    return decimalsNum
  } catch (error) {
    console.warn(`Failed to fetch decimals for ${addrKey}:`, error?.message || error)
    return getTokenDecimalsFallback(tokenAddr)
  }
}

// Synchronous fallback for known tokens (when provider not available or fetch fails)
export const getTokenDecimalsFallback = (tokenAddr) => {
  if (!tokenAddr) return 18
  const addr = tokenAddr.toString().toLowerCase()

  // EVM tokens
  if (addr === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') return 18 // WBNB
  if (addr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') return 6  // USDC (Base)
  if (addr === '0x55d398326f99059ff775485246999027b3197955') return 18 // USDT (BSC)
  if (addr === '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d') return 18 // USDC (BSC alt)
  if (addr === '0x4200000000000000000000000000000000000006') return 18 // WETH (Base)

  // Solana tokens (base58; compare in lowercase for consistency)
  if (addr === 'so11111111111111111111111111111111111111112') return 9 // WSOL
  if (addr === 'epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwydt1v') return 6 // USDC (Sol)
  if (addr === 'es9vmfrzacermjfrf4h2fyd4kconky11mcce8benwnyb') return 6 // USDT (Sol)

  return 18
}

// Main function - tries async fetch first, falls back to sync
export const getTokenDecimals = async (tokenAddr, provider = null, network = 'bsc') => {
  // Always attempt network-aware fetch; for EVM without provider it will fallback.
  return fetchTokenDecimals(tokenAddr, provider, network)
}

// Clear cache (useful for testing or when network changes)
export const clearDecimalsCache = () => {
  decimalsCache.clear()
}
