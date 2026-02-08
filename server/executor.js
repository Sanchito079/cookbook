import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import fetch from 'node-fetch'
import { createClient } from '@supabase/supabase-js'
import { Contract, JsonRpcProvider, Wallet, FetchRequest } from 'ethers'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.join(__dirname, '..', '.env')
console.log('[executor] Loading .env from:', envPath)
dotenv.config({ path: envPath })
console.log('[executor] SUPABASE_URL loaded:', !!process.env.SUPABASE_URL)
console.log('[executor] SUPABASE_SERVICE_ROLE loaded:', !!process.env.SUPABASE_SERVICE_ROLE)

// Environment
const EXECUTOR_ENABLED = String(process.env.EXECUTOR_ENABLED || '').toLowerCase() === 'true'
const EXECUTOR_INTERVAL_MS = Number(process.env.EXECUTOR_INTERVAL_MS || 10000)
const EXECUTOR_RPC_URL = process.env.EXECUTOR_RPC_URL
const EXECUTOR_RPC_URL_BASE = process.env.EXECUTOR_RPC_URL_BASE
const EXECUTOR_RPC_URLS = (process.env.EXECUTOR_RPC_URLS || '').split(',').map(s => s.trim()).filter(Boolean)
const EXECUTOR_PRIVATE_KEY = process.env.EXECUTOR_PRIVATE_KEY
const SETTLEMENT_ADDRESS_BSC = process.env.SETTLEMENT_ADDRESS_BSC || '0x7DBA6a1488356428C33cC9fB8Ef3c8462c8679d0'
const SETTLEMENT_ADDRESS_BASE = process.env.SETTLEMENT_ADDRESS_BASE || '0xBBf7A39F053BA2B8F4991282425ca61F2D871f45'
const CUSTODIAL_ADDRESS = '0x70c992e6a19c565430fa0c21933395ebf1e907c3'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE

// Reward system configuration
const REWARD_CONFIG = {
  makerRate: parseFloat(process.env.REWARD_MAKER_RATE || '0.001'), // 0.1% of volume for makers
  takerRate: parseFloat(process.env.REWARD_TAKER_RATE || '0.0005'), // 0.05% of volume for takers
  enabled: String(process.env.REWARD_SYSTEM_ENABLED || 'true').toLowerCase() === 'true',
  minVolumeUsd: parseFloat(process.env.REWARD_MIN_VOLUME_USD || '0.1') // Minimum $0.1 volume to earn rewards
}

console.log('[executor] Reward System Configuration:', {
  enabled: REWARD_CONFIG.enabled,
  makerRate: REWARD_CONFIG.makerRate,
  takerRate: REWARD_CONFIG.takerRate,
  minVolumeUsd: REWARD_CONFIG.minVolumeUsd
})

// Settlement ABI (from user-provided ABI to align custom errors and events)
const SETTLEMENT_ABI = [
  // custom errors
  { "inputs": [], "name": "BadSignature", "type": "error" },
  { "inputs": [], "name": "Expired", "type": "error" },
  { "inputs": [], "name": "InvalidOrder", "type": "error" },
  { "inputs": [], "name": "Overfill", "type": "error" },
  { "inputs": [], "name": "PriceTooLow", "type": "error" },

  // events
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "bytes32", "name": "buyHash", "type": "bytes32" },
      { "indexed": true, "internalType": "bytes32", "name": "sellHash", "type": "bytes32" },
      { "indexed": true, "internalType": "address", "name": "matcher", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amountBase", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "amountQuote", "type": "uint256" }
    ],
    "name": "Matched",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "maker", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "newMinNonce", "type": "uint256" }
    ],
    "name": "MinNonceUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "bytes32", "name": "orderHash", "type": "bytes32" },
      { "indexed": true, "internalType": "address", "name": "maker", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "nonce", "type": "uint256" }
    ],
    "name": "OrderCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "bytes32", "name": "orderHash", "type": "bytes32" },
      { "indexed": true, "internalType": "address", "name": "maker", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "taker", "type": "address" },
      { "indexed": false, "internalType": "address", "name": "tokenIn", "type": "address" },
      { "indexed": false, "internalType": "address", "name": "tokenOut", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amountIn", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "amountOut", "type": "uint256" }
    ],
    "name": "OrderFilled",
    "type": "event"
  },

  // constant / view getters
  { "inputs": [], "name": "DOMAIN_SEPARATOR", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "ORDER_TYPEHASH", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },

  // availableToFill(order) => uint256
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "maker", "type": "address" },
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
          { "internalType": "uint256", "name": "expiration", "type": "uint256" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "address", "name": "receiver", "type": "address" },
          { "internalType": "uint256", "name": "salt", "type": "uint256" }
        ],
        "internalType": "struct OrderBook.Order",
        "name": "order",
        "type": "tuple"
      }
    ],
    "name": "availableToFill",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },

  // cancelOrder(order)
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "maker", "type": "address" },
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
          { "internalType": "uint256", "name": "expiration", "type": "uint256" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "address", "name": "receiver", "type": "address" },
          { "internalType": "uint256", "name": "salt", "type": "uint256" }
        ],
        "internalType": "struct OrderBook.Order",
        "name": "order",
        "type": "tuple"
      }
    ],
    "name": "cancelOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },

  // cancelled(bytes32) => bool
  { "inputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "name": "cancelled", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },

  // fillOrder(order, signature, amountInToFill, takerMinAmountOut)
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "maker", "type": "address" },
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
          { "internalType": "uint256", "name": "expiration", "type": "uint256" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "address", "name": "receiver", "type": "address" },
          { "internalType": "uint256", "name": "salt", "type": "uint256" }
        ],
        "internalType": "struct OrderBook.Order",
        "name": "order",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "signature", "type": "bytes" },
      { "internalType": "uint256", "name": "amountInToFill", "type": "uint256" },
      { "internalType": "uint256", "name": "takerMinAmountOut", "type": "uint256" }
    ],
    "name": "fillOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },

  // filledAmountIn(bytes32) => uint256
  { "inputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "name": "filledAmountIn", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },

  // getOrderDigest(order) => bytes32
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "maker", "type": "address" },
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
          { "internalType": "uint256", "name": "expiration", "type": "uint256" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "address", "name": "receiver", "type": "address" },
          { "internalType": "uint256", "name": "salt", "type": "uint256" }
        ],
        "internalType": "struct OrderBook.Order",
        "name": "order",
        "type": "tuple"
      }
    ],
    "name": "getOrderDigest",
    "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  },

  // hashOrder(order) => bytes32 (pure)
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "maker", "type": "address" },
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
          { "internalType": "uint256", "name": "expiration", "type": "uint256" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "address", "name": "receiver", "type": "address" },
          { "internalType": "uint256", "name": "salt", "type": "uint256" }
        ],
        "internalType": "struct OrderBook.Order",
        "name": "order",
        "type": "tuple"
      }
    ],
    "name": "hashOrder",
    "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "pure",
    "type": "function"
  },

  // matchOrders(buy, sigBuy, sell, sigSell, amountBase, amountQuote)
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "maker", "type": "address" },
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
          { "internalType": "uint256", "name": "expiration", "type": "uint256" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "address", "name": "receiver", "type": "address" },
          { "internalType": "uint256", "name": "salt", "type": "uint256" }
        ],
        "internalType": "struct OrderBook.Order",
        "name": "buy",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "sigBuy", "type": "bytes" },
      {
        "components": [
          { "internalType": "address", "name": "maker", "type": "address" },
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
          { "internalType": "uint256", "name": "expiration", "type": "uint256" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "address", "name": "receiver", "type": "address" },
          { "internalType": "uint256", "name": "salt", "type": "uint256" }
        ],
        "internalType": "struct OrderBook.Order",
        "name": "sell",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "sigSell", "type": "bytes" },
      { "internalType": "uint256", "name": "amountBase", "type": "uint256" },
      { "internalType": "uint256", "name": "amountQuote", "type": "uint256" }
    ],
    "name": "matchOrders",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },

  // minAmountOutFor(order, amountInToFill) => uint256 (pure)
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "maker", "type": "address" },
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
          { "internalType": "uint256", "name": "expiration", "type": "uint256" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "address", "name": "receiver", "type": "address" },
          { "internalType": "uint256", "name": "salt", "type": "uint256" }
        ],
        "internalType": "struct OrderBook.Order",
        "name": "o",
        "type": "tuple"
      },
      { "internalType": "uint256", "name": "amountInToFill", "type": "uint256" }
    ],
    "name": "minAmountOutFor",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "pure",
    "type": "function"
  },

  // minNonce(address) => uint256
  { "inputs": [{ "internalType": "address", "name": "", "type": "address" }], "name": "minNonce", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },

  // setMinNonce(newMinNonce)
  { "inputs": [{ "internalType": "uint256", "name": "newMinNonce", "type": "uint256" }], "name": "setMinNonce", "outputs": [], "stateMutability": "nonpayable", "type": "function" },

  // verifySignature(order, sig) => bool
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "maker", "type": "address" },
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
          { "internalType": "uint256", "name": "expiration", "type": "uint256" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "address", "name": "receiver", "type": "address" },
          { "internalType": "uint256", "name": "salt", "type": "uint256" }
        ],
        "internalType": "struct OrderBook.Order",
        "name": "o",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "sig", "type": "bytes" }
    ],
    "name": "verifySignature",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  }
];

function toBN(x) {
  try {
    if (typeof x === 'bigint') return x
    if (typeof x === 'number') return BigInt(Math.floor(x))
    const s = (x ?? '0').toString().trim()
    if (s === '') return 0n
    return BigInt(s)
  } catch {
    return 0n
  }
}

function toLower(s) {
  return (s || '').toString().toLowerCase()
}

// Jupiter API helper for Solana swaps
async function getJupiterQuote(inputMint, outputMint, amount, slippageBps = 50) {
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Jupiter quote HTTP ${res.status}`)
  return await res.json()
}

function minOut(amountIn, orderAmountIn, orderAmountOutMin) {
  if (orderAmountIn === 0n) return 0n
  return (amountIn * orderAmountOutMin) / orderAmountIn // floor
}
function ceilDiv(a, b) {
  if (b === 0n) return 0n
  if (a === 0n) return 0n
  return (a + b - 1n) / b
}

function classifyRowSide(base, quote, r) {
  const ti = (r.token_in || '').toLowerCase()
  const to = (r.token_out || '').toLowerCase()
  if (ti === base && to === quote) return 'ask' // selling base for quote
  if (ti === quote && to === base) return 'bid' // selling quote for base
  return null
}

function getNetworkForToken(address) {
  const addr = (address || '').toLowerCase()
  if (addr === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') return 'bsc' // WBNB
  if (addr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') return 'base' // USDC
  if (addr === '0x55d398326f99059ff775485246999027b3197955') return 'bsc' // USDT
  if (addr === '0x4200000000000000000000000000000000000006') return 'base' // WETH
  // Add more tokens as needed
  return 'bsc' // default
}

function priceAsk(r) {
  // quote per base in integer math scaled by 1e18
  const ain = toBN(r.amount_in || r.amountIn || 0n) // base in
  const aout = toBN(r.amount_out_min || r.amountOutMin || 0n) // quote min out
  if (ain <= 0n) return null
  return (aout * 10n ** 18n) / ain
}
function priceBid(r) {
  // quote per base in integer math scaled by 1e18
  const ain = toBN(r.amount_in || r.amountIn || 0n) // quote in
  const aout = toBN(r.amount_out_min || r.amountOutMin || 0n) // base min out
  if (aout <= 0n) return null
  return (ain * 10n ** 18n) / aout
}

function normalizeOrderJson(obj) {
  const o = { ...(obj || {}) }
  o.amountIn = toBN(o.amountIn)
  o.amountOutMin = toBN(o.amountOutMin)
  o.expiration = toBN(o.expiration)
  o.nonce = toBN(o.nonce)
  o.salt = toBN(o.salt)
  if (!o.receiver) o.receiver = '0x0000000000000000000000000000000000000000'
  return o
}

let supabase = null
let providerBSC = null
let providerBase = null
let walletBSC = null
let walletBase = null
let settlement = null
let settlementBase = null
let busyBSC = false
let busyBase = false

function makeProviderWithTimeout(url, timeoutMs = 60000) {
  try {
    const req = new FetchRequest(url)
    req.timeout = timeoutMs
    return new JsonRpcProvider(req)
  } catch {
    // Fallback to plain provider if FetchRequest construction fails
    return new JsonRpcProvider(url)
  }
}

async function connectProviderWithRetries(url, attempts = 5, baseDelayMs = 1000) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const prov = makeProviderWithTimeout(url, 30000) // Reduced timeout
      const net = await prov.getNetwork()
      return { provider: prov, chainId: Number(net.chainId) }
    } catch (e) {
      lastErr = e
      const delay = Math.min(baseDelayMs * Math.pow(2, i), 10000) // Cap delay at 10s
      console.warn(`[executor] provider connect failed (try ${i + 1}/${attempts}) for ${url}:`, e?.message || e)
      if (i < attempts - 1) { // Don't delay on last attempt
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

async function initProvidersAndWallets() {
  const networks = [
    { name: 'BSC', url: EXECUTOR_RPC_URL, chainId: 56, providerVar: 'providerBSC', walletVar: 'walletBSC' },
    { name: 'Base', url: EXECUTOR_RPC_URL_BASE, chainId: 8453, providerVar: 'providerBase', walletVar: 'walletBase' }
  ]

  if (!EXECUTOR_PRIVATE_KEY) throw new Error('Missing EXECUTOR_PRIVATE_KEY')

  let connectedCount = 0

  for (const network of networks) {
    if (!network.url) {
      console.warn(`[executor] ${network.name} RPC URL not configured, skipping`)
      continue
    }

    let lastErr
    let attempts = 0
    const maxAttempts = 10 // More retries for reliability

    while (attempts < maxAttempts) {
      try {
        console.log(`[executor] connecting to ${network.name} (attempt ${attempts + 1}/${maxAttempts})`)
        const { provider: prov, chainId } = await connectProviderWithRetries(network.url, 3, 2000)

        if (chainId !== network.chainId) {
          throw new Error(`${network.name} RPC returned wrong chainId: ${chainId}, expected ${network.chainId}`)
        }

        const w = new Wallet(EXECUTOR_PRIVATE_KEY, prov)

        // Assign to global variables
        if (network.name === 'BSC') {
          providerBSC = prov
          walletBSC = w
        } else if (network.name === 'Base') {
          providerBase = prov
          walletBase = w
        }

        console.log(`[executor] ${network.name} connected successfully. wallet: ${w.address}, chainId: ${chainId}`)
        connectedCount++
        break // Success, exit retry loop

      } catch (e) {
        lastErr = e
        attempts++
        console.warn(`[executor] ${network.name} connection failed (attempt ${attempts}/${maxAttempts}):`, e?.message || e)

        if (attempts < maxAttempts) {
          const delay = Math.min(2000 * Math.pow(1.5, attempts), 15000) // Slower exponential backoff, max 15s
          console.log(`[executor] retrying ${network.name} in ${delay}ms...`)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }

    if (attempts >= maxAttempts) {
      console.error(`[executor] ${network.name} failed to connect after ${maxAttempts} attempts:`, lastErr?.message || lastErr)
    }
  }

  if (connectedCount === 0) {
    throw new Error('Failed to connect to any network')
  }

  console.log(`[executor] connected to ${connectedCount} network(s)`)
  return connectedCount
}

async function init() {
  if (!EXECUTOR_ENABLED) {
    console.log('[executor] disabled. Set EXECUTOR_ENABLED=true in .env to enable.')
    return false
  }
  if ((!EXECUTOR_RPC_URL && !EXECUTOR_RPC_URL_BASE && EXECUTOR_RPC_URLS.length === 0) || !EXECUTOR_PRIVATE_KEY) {
    console.warn('[executor] missing EXECUTOR_RPC_URL, EXECUTOR_RPC_URL_BASE, or EXECUTOR_RPC_URLS, or EXECUTOR_PRIVATE_KEY. Executor will not run.')
    return false
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    console.warn('[executor] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE. Executor will not run.')
    return false
  }

  try {
    // Initialize providers and wallets for both networks
    const connectedCount = await initProvidersAndWallets()
    if (connectedCount === 0) {
      console.error('[executor] failed to connect to any networks')
      return false
    }

    // Initialize settlement contracts for networks that connected
    if (walletBSC) {
      settlement = new Contract(SETTLEMENT_ADDRESS_BSC, SETTLEMENT_ABI, walletBSC)
      try {
        settlement.on('Matched', (buyHash, sellHash, matcher, amountBase, amountQuote) => {
          console.log('[chain] BSC Matched', { buyHash, sellHash, matcher, amountBase: amountBase?.toString?.(), amountQuote: amountQuote?.toString?.() })
        })
        settlement.on('OrderFilled', (orderHash, maker, taker, tokenIn, tokenOut, amountIn, amountOut) => {
          console.log('[chain] BSC OrderFilled', { orderHash, maker, taker, tokenIn, tokenOut, amountIn: amountIn?.toString?.(), amountOut: amountOut?.toString?.() })
        })
      } catch (e) {
        console.warn('[executor] BSC event listeners failed:', e?.message || e)
      }
    }

    if (walletBase) {
      settlementBase = new Contract(SETTLEMENT_ADDRESS_BASE, SETTLEMENT_ABI, walletBase)
      try {
        settlementBase.on('Matched', (buyHash, sellHash, matcher, amountBase, amountQuote) => {
          console.log('[chain] Base Matched', { buyHash, sellHash, matcher, amountBase: amountBase?.toString?.(), amountQuote: amountQuote?.toString?.() })
        })
        settlementBase.on('OrderFilled', (orderHash, maker, taker, tokenIn, tokenOut, amountIn, amountOut) => {
          console.log('[chain] Base OrderFilled', { orderHash, maker, taker, tokenIn, tokenOut, amountIn: amountIn?.toString?.(), amountOut: amountOut?.toString?.() })
        })
      } catch (e) {
        console.warn('[executor] Base event listeners failed:', e?.message || e)
      }
    }

    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } })

    // Probe Supabase once
    try {
      const ping = await fetch(`${SUPABASE_URL}/rest/v1/`, { method: 'HEAD' })
      const ok = ping.ok || [401, 403, 404].includes(ping.status)
      console.log('[executor] supabase reachable:', ok)
      if (!ok) return false
    } catch (e) {
      console.warn('[executor] supabase connectivity failed:', e?.message || e)
      return false
    }
    return true
  } catch (e) {
    console.error('[executor] init failed:', e?.message || e)
    return false
  }
}

async function fetchOpenOrdersAll(network = 'bsc') {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('network', network)
    .eq('status', 'open')
    .gt('remaining', '0')
    .order('updated_at', { ascending: true })
    .limit(500)
  if (error) throw error
  return data || []
}

async function fetchOpenOrdersCrossChain() {
  const { data, error } = await supabase
    .from('cross_chain_orders')
    .select('*')
    .eq('network', 'crosschain')
    .eq('status', 'open')
    .gt('remaining', '0')
    .order('updated_at', { ascending: true })
    .limit(500)
  if (error) throw error
  return data || []
}

async function checkAndTriggerConditionalOrders(network = 'bsc') {
  const triggeredOrderIds = []

  try {
    console.log(`[executor] ${network}: Checking conditional orders...`)

    // Get pending conditional orders
    const { data: conditionalOrders, error } = await supabase
      .from('conditional_orders')
      .select('*')
      .eq('network', network)
      .eq('status', 'pending')
      .or('expiration.is.null,expiration.gt.' + new Date().toISOString())
      .limit(100)

    if (error) {
      console.error('[executor] Error fetching conditional orders:', error)
      return triggeredOrderIds
    }

    if (!conditionalOrders || conditionalOrders.length === 0) {
      console.log(`[executor] ${network}: No pending conditional orders`)
      return triggeredOrderIds
    }

    console.log(`[executor] ${network}: Found ${conditionalOrders.length} pending conditional orders`)

    // Get current prices from recent trades
    const { data: recentTrades, error: tradeError } = await supabase
      .from('trades')
      .select('base_address, quote_address, price')
      .eq('network', network)
      .order('created_at', { ascending: false })
      .limit(1000)

    if (tradeError) {
      console.error('[executor] Error fetching recent trades:', tradeError)
      return triggeredOrderIds
    }

    if (!recentTrades || recentTrades.length === 0) {
      console.log(`[executor] ${network}: No recent trades found, skipping conditional order checks`)
      return triggeredOrderIds
    }

    // Group latest prices by pair
    const latestPrices = new Map()
    for (const trade of recentTrades) {
      const pairKey = `${trade.base_address}_${trade.quote_address}`.toLowerCase()
      if (!latestPrices.has(pairKey)) {
        latestPrices.set(pairKey, Number(trade.price))
        console.log(`[executor] ${network}: Latest price for ${pairKey}: ${Number(trade.price)}`)
      }
    }

    let triggeredCount = 0
    for (const co of conditionalOrders) {
      const pairKey = `${co.base_token}_${co.quote_token}`.toLowerCase()
      const currentPrice = latestPrices.get(pairKey)

      if (currentPrice == null) {
        console.log(`[executor] ${network}: No price data for conditional order ${co.conditional_order_id} pair ${pairKey}`)
        continue
      }

      const triggerPrice = Number(co.trigger_price)
      let triggered = false
      let reason = ''

      if (co.type === 'stop_loss') {
        // For stop loss, trigger if price drops to or below trigger price
        triggered = currentPrice <= triggerPrice
        reason = `price ${currentPrice} <= trigger ${triggerPrice}`
      } else if (co.type === 'take_profit') {
        // For take profit, trigger if price rises to or above trigger price
        triggered = currentPrice >= triggerPrice
        reason = `price ${currentPrice} >= trigger ${triggerPrice}`
      } else {
        console.log(`[executor] ${network}: Unknown conditional order type: ${co.type}`)
        continue
      }

      console.log(`[executor] ${network}: Checking conditional order ${co.conditional_order_id} (${co.type}): ${reason} - ${triggered ? 'TRIGGERED' : 'not triggered'}`)

      if (triggered) {
        console.log(`[executor] ${network}: 🔥 TRIGGERING conditional order ${co.conditional_order_id} (${co.type})`)

        // Build the order from template
        const orderTemplate = co.order_template
        if (!orderTemplate) {
          console.error('[executor] No order template for conditional order:', co.conditional_order_id)
          continue
        }

        // 1) First, atomically flip status to triggered if still pending
        const nowIso = new Date().toISOString()
        const { data: updatedRows, error: updateFirstErr } = await supabase
          .from('conditional_orders')
          .update({
            status: 'triggered',
            triggered_at: nowIso,
            triggered_price: String(currentPrice),
            updated_at: nowIso
          })
          .eq('conditional_order_id', co.conditional_order_id)
          .eq('network', network)
          .eq('status', 'pending')
          .select('conditional_order_id')
          .limit(1)

        if (updateFirstErr) {
          console.error('[executor] Failed to update conditional order status:', updateFirstErr)
          continue
        }
        if (!updatedRows || updatedRows.length === 0) {
          // Someone else triggered it
          console.log(`[executor] ${network}: conditional order already triggered by another worker: ${co.conditional_order_id}`)
          continue
        }

        // 2) Generate new order ID and hash
        const orderId = crypto.randomUUID()
        const orderHash = crypto.createHash('sha1').update(JSON.stringify({
          network,
          maker: toLower(orderTemplate.maker),
          nonce: String(orderTemplate.nonce || ''),
          tokenIn: toLower(orderTemplate.tokenIn),
          tokenOut: toLower(orderTemplate.tokenOut),
          salt: String(orderTemplate.salt || '')
        })).digest('hex')

        const orderRow = {
          network: co.network,
          order_id: orderId,
          order_hash: orderHash,
          maker: co.maker,
          token_in: orderTemplate.tokenIn,
          token_out: orderTemplate.tokenOut,
          amount_in: orderTemplate.amountIn,
          amount_out_min: orderTemplate.amountOutMin,
          remaining: orderTemplate.amountIn,
          price: null, // will be computed
          side: null,
          base: co.base_token,
          quote: co.quote_token,
          base_address: co.base_token,
          quote_address: co.quote_token,
          pair: co.pair || `${co.base_token}/${co.quote_token}`,
          nonce: orderTemplate.nonce,
          receiver: orderTemplate.receiver || '',
          salt: orderTemplate.salt,
          signature: co.signature, // Use the pre-signed signature from conditional order
          order_json: orderTemplate,
          expiration: orderTemplate.expiration ? new Date(Number(orderTemplate.expiration) * 1000).toISOString() : null,
          status: 'open',
          source: 'conditional', // Mark as coming from conditional order
          source_conditional_order_id: co.conditional_order_id,
          created_at: nowIso,
          updated_at: nowIso
        }

        // 3) Insert the order (idempotent via unique constraint if present)
        const { error: insertError } = await supabase.from('orders').insert(orderRow)
        if (insertError) {
          console.error('[executor] Failed to insert triggered order:', insertError)
          continue
        }

        // 4) Backfill resulting_order_id on conditional order (best-effort)
        try {
          await supabase
            .from('conditional_orders')
            .update({ resulting_order_id: orderId, updated_at: nowIso })
            .eq('conditional_order_id', co.conditional_order_id)
            .eq('network', network)
            .limit(1)
        } catch (e) {
          console.warn('[executor] Failed to set resulting_order_id:', e?.message || e)
        }

        // Track the triggered order ID
        triggeredOrderIds.push(orderId)
        triggeredCount++
        console.log(`[executor] ${network}: ✅ Conditional order ${co.conditional_order_id} triggered → created order ${orderId} (source: conditional)`)        
      }
    }

    console.log(`[executor] ${network}: Conditional order check complete - ${triggeredCount} orders triggered`)
  } catch (e) {
    console.error('[executor] Error checking conditional orders:', e?.message || e)
  }

  return triggeredOrderIds
}

// Calculate dynamic price for liquidity orders based on remaining amount AND market price
async function calculateDynamicPrice(order, remainingAmount, marketPrice = null) {
  if (!order.is_liquidity_order || !order.initial_price) {
    return null
  }

  const initialPrice = parseFloat(order.initial_price)
  const totalAmount = parseFloat(order.amount_in)
  const remaining = parseFloat(remainingAmount)
  
  if (totalAmount <= 0 || remaining <= 0) {
    return initialPrice
  }

  // Calculate percentage sold
  const soldPercentage = (totalAmount - remaining) / totalAmount
  
  // Get price curve parameters
  const params = order.price_curve_params || {}
  const slope = parseFloat(params.slope) || 0.01 // Default 1% price change per 100% sold
  const curveType = order.price_curve_type || 'linear'
  
  // Get max price deviation from params (default 5% to prevent arbitrage)
  const maxDeviation = parseFloat(params.maxDeviation) || 0.05

  let newPrice = initialPrice

  if (curveType === 'linear') {
    // Linear price increase/decrease based on sold percentage
    // Price increases as more tokens are sold (for sell orders)
    newPrice = initialPrice * (1 + (soldPercentage * slope))
  } else if (curveType === 'exponential') {
    // Exponential price curve
    newPrice = initialPrice * Math.pow(1 + slope, soldPercentage * 10)
  } else if (curveType === 'market_tracking') {
    // Market tracking mode: price follows market price within deviation bounds
    if (marketPrice && marketPrice > 0) {
      // Ensure price stays within max deviation of market price
      const minPrice = marketPrice * (1 - maxDeviation)
      const maxPrice = marketPrice * (1 + maxDeviation)
      
      // Calculate base price from curve
      const basePrice = initialPrice * (1 + (soldPercentage * slope))
      
      // Clamp to market price range
      newPrice = Math.max(minPrice, Math.min(maxPrice, basePrice))
    } else {
      // Fallback to linear if no market price
      newPrice = initialPrice * (1 + (soldPercentage * slope))
    }
  }

  return newPrice
}

// Fetch current market price for a token pair from recent trades
async function getMarketPrice(baseAddress, quoteAddress, network = 'bsc') {
  try {
    const { data: recentTrades } = await supabase
      .from('trades')
      .select('price')
      .eq('network', network)
      .eq('base_address', baseAddress.toLowerCase())
      .eq('quote_address', quoteAddress.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (!recentTrades || recentTrades.length === 0) {
      return null
    }
    
    // Calculate average price from recent trades
    const prices = recentTrades.map(t => parseFloat(t.price)).filter(p => p > 0)
    if (prices.length === 0) return null
    
    // Use median to reduce impact of outliers
    prices.sort((a, b) => a - b)
    const medianPrice = prices.length % 2 === 0 
      ? prices[Math.floor(prices.length / 2)]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
    
    return medianPrice
  } catch (e) {
    console.error('[executor] Error fetching market price:', e)
    return null
  }
}

// Update prices for liquidity orders based on remaining amounts
async function updateLiquidityOrderPrices(network = 'bsc') {
  try {
    console.log(`[executor] ${network}: Checking liquidity orders for price updates...`)

    // Fetch open liquidity orders
    const { data: liquidityOrders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('network', network)
      .eq('is_liquidity_order', true)
      .eq('status', 'open')
      .gt('remaining', '0')
      .order('updated_at', { ascending: true })
      .limit(100)

    if (error) {
      console.error('[executor] Error fetching liquidity orders:', error)
      return
    }

    if (!liquidityOrders || liquidityOrders.length === 0) {
      console.log(`[executor] ${network}: No liquidity orders to update`)
      return
    }

    console.log(`[executor] ${network}: Found ${liquidityOrders.length} liquidity orders`)

    // Fetch market prices for all unique pairs
    const uniquePairs = new Map()
    for (const order of liquidityOrders) {
      const pairKey = `${order.base_address}_${order.quote_address}`
      if (!uniquePairs.has(pairKey)) {
        uniquePairs.set(pairKey, { base: order.base_address, quote: order.quote_address })
      }
    }

    // Fetch market prices for each unique pair
    const marketPrices = new Map()
    for (const [pairKey, pair] of uniquePairs) {
      const marketPrice = await getMarketPrice(pair.base, pair.quote, network)
      if (marketPrice) {
        marketPrices.set(pairKey, marketPrice)
        console.log(`[executor] ${network}: Market price for ${pair.base}/${pair.quote}: ${marketPrice}`)
      }
    }

    let updatedCount = 0
    for (const order of liquidityOrders) {
      const currentPrice = parseFloat(order.price)
      const pairKey = `${order.base_address}_${order.quote_address}`
      const marketPrice = marketPrices.get(pairKey)
      
      const newPrice = calculateDynamicPrice(order, order.remaining, marketPrice)

      if (newPrice && Math.abs(newPrice - currentPrice) > 0.000001) {
        // Update the order with new price
        const { error: updateError } = await supabase
          .from('orders')
          .update({
            price: String(newPrice),
            updated_at: new Date().toISOString()
          })
          .eq('order_id', order.order_id)
          .eq('network', network)

        if (updateError) {
          console.error(`[executor] Failed to update price for order ${order.order_id}:`, updateError)
        } else {
          console.log(`[executor] ${network}: Updated price for liquidity order ${order.order_id}: ${currentPrice} -> ${newPrice} (market: ${marketPrice})`)
          updatedCount++
        }
      }
    }

    console.log(`[executor] ${network}: Updated prices for ${updatedCount} liquidity orders`)
  } catch (e) {
    console.error('[executor] Error updating liquidity order prices:', e?.message || e)
  }
}

async function updateOrderRemaining(orderId, newRemaining, newStatus, network = 'bsc') {
  try {
    const table = network === 'crosschain' ? 'cross_chain_orders' : 'orders'
    const patch = { remaining: newRemaining.toString(), updated_at: new Date().toISOString() }
    if (newStatus) patch.status = newStatus
    const { error } = await supabase
      .from(table)
      .update(patch)
      .eq('order_id', orderId)
      .limit(1)
    if (error) throw error
  } catch (e) {
    console.warn('[executor] db update failed:', e?.message || e)
  }
}

async function updateOrderStatus(orderId, newStatus, network = 'bsc') {
  try {
    const table = network === 'crosschain' ? 'cross_chain_orders' : 'orders'
    const patch = { status: newStatus, updated_at: new Date().toISOString() }
    const { error } = await supabase
      .from(table)
      .update(patch)
      .eq('order_id', orderId)
      .limit(1)
    if (error) throw error
  } catch (e) {
    console.warn('[executor] db status update failed:', e?.message || e)
  }
}

// ==================== REWARD SYSTEM ====================

// Calculate and award rewards for a trade
async function awardTradeRewards(network, makerAddress, takerAddress, volumeUsd, baseToken, quoteToken, amountBase, amountQuote, txHash) {
  console.log(`[rewards] ${network}: awardTradeRewards called with:`, {
    makerAddress,
    takerAddress,
    volumeUsd,
    baseToken,
    quoteToken,
    amountBase,
    amountQuote,
    txHash,
    rewardEnabled: REWARD_CONFIG.enabled,
    supabaseExists: !!supabase
  })

  if (!REWARD_CONFIG.enabled || !supabase) {
    console.log(`[rewards] ${network}: Reward system disabled or supabase not available, skipping`)
    return { makerPoints: 0, takerPoints: 0 }
  }

  try {
    // Skip if volume is too low
    if (volumeUsd < REWARD_CONFIG.minVolumeUsd) {
      console.log(`[rewards] ${network}: Volume ${volumeUsd} below minimum ${REWARD_CONFIG.minVolumeUsd}, skipping rewards`)
      return { makerPoints: 0, takerPoints: 0 }
    }

    const makerPoints = volumeUsd * REWARD_CONFIG.makerRate
    const takerPoints = volumeUsd * REWARD_CONFIG.takerRate
    const nowIso = new Date().toISOString()
    
    console.log(`[rewards] ${network}: Awarding rewards - Maker: ${makerAddress} gets ${makerPoints} points, Taker: ${takerAddress} gets ${takerPoints} points`)
    
    // Update maker rewards - use manual increment approach for reliability
    try {
      const { data: existingMaker, error: fetchMakerError } = await supabase
        .from('user_rewards')
        .select('*')
        .eq('network', network)
        .eq('user_address', makerAddress.toLowerCase())
        .single()
      
      if (fetchMakerError && fetchMakerError.code !== 'PGRST116') {
        console.error('[rewards] Error fetching maker rewards:', fetchMakerError)
        throw fetchMakerError
      }
      
      if (existingMaker) {
        // Update existing record
        console.log(`[rewards] ${network}: Updating existing maker record for ${makerAddress}`)
        const { error: updateMakerError } = await supabase
          .from('user_rewards')
          .update({
            total_volume_usd: Number(existingMaker.total_volume_usd || 0) + volumeUsd,
            maker_volume_usd: Number(existingMaker.maker_volume_usd || 0) + volumeUsd,
            total_trades: (existingMaker.total_trades || 0) + 1,
            maker_trades: (existingMaker.maker_trades || 0) + 1,
            reward_points: Number(existingMaker.reward_points || 0) + makerPoints,
            maker_reward_points: Number(existingMaker.maker_reward_points || 0) + makerPoints,
            updated_at: nowIso
          })
          .eq('network', network)
          .eq('user_address', makerAddress.toLowerCase())
        
        if (updateMakerError) {
          console.error('[rewards] Error updating maker rewards:', updateMakerError)
          throw updateMakerError
        }
        console.log(`[rewards] ${network}: Successfully updated maker rewards for ${makerAddress}`)
      } else {
        // Insert new record
        console.log(`[rewards] ${network}: Inserting new maker record for ${makerAddress}`)
        const { error: insertMakerError } = await supabase
          .from('user_rewards')
          .insert({
            user_address: makerAddress.toLowerCase(),
            network,
            total_volume_usd: volumeUsd,
            maker_volume_usd: volumeUsd,
            total_trades: 1,
            maker_trades: 1,
            reward_points: makerPoints,
            maker_reward_points: makerPoints,
            created_at: nowIso,
            updated_at: nowIso
          })
        
        if (insertMakerError) {
          console.error('[rewards] Error inserting maker rewards:', insertMakerError)
          throw insertMakerError
        }
        console.log(`[rewards] ${network}: Successfully inserted maker rewards for ${makerAddress}`)
      }
    } catch (makerErr) {
      console.error('[rewards] Failed to update maker rewards:', makerErr?.message || makerErr)
      throw makerErr
    }

    // Update taker rewards - use manual increment approach for reliability
    try {
      const { data: existingTaker, error: fetchTakerError } = await supabase
        .from('user_rewards')
        .select('*')
        .eq('network', network)
        .eq('user_address', takerAddress.toLowerCase())
        .single()
      
      if (fetchTakerError && fetchTakerError.code !== 'PGRST116') {
        console.error('[rewards] Error fetching taker rewards:', fetchTakerError)
        throw fetchTakerError
      }
      
      if (existingTaker) {
        // Update existing record
        console.log(`[rewards] ${network}: Updating existing taker record for ${takerAddress}`)
        const { error: updateTakerError } = await supabase
          .from('user_rewards')
          .update({
            total_volume_usd: Number(existingTaker.total_volume_usd || 0) + volumeUsd,
            taker_volume_usd: Number(existingTaker.taker_volume_usd || 0) + volumeUsd,
            total_trades: (existingTaker.total_trades || 0) + 1,
            taker_trades: (existingTaker.taker_trades || 0) + 1,
            reward_points: Number(existingTaker.reward_points || 0) + takerPoints,
            taker_reward_points: Number(existingTaker.taker_reward_points || 0) + takerPoints,
            updated_at: nowIso
          })
          .eq('network', network)
          .eq('user_address', takerAddress.toLowerCase())
        
        if (updateTakerError) {
          console.error('[rewards] Error updating taker rewards:', updateTakerError)
          throw updateTakerError
        }
        console.log(`[rewards] ${network}: Successfully updated taker rewards for ${takerAddress}`)
      } else {
        // Insert new record
        console.log(`[rewards] ${network}: Inserting new taker record for ${takerAddress}`)
        const { error: insertTakerError } = await supabase
          .from('user_rewards')
          .insert({
            user_address: takerAddress.toLowerCase(),
            network,
            total_volume_usd: volumeUsd,
            taker_volume_usd: volumeUsd,
            total_trades: 1,
            taker_trades: 1,
            reward_points: takerPoints,
            taker_reward_points: takerPoints,
            created_at: nowIso,
            updated_at: nowIso
          })
        
        if (insertTakerError) {
          console.error('[rewards] Error inserting taker rewards:', insertTakerError)
          throw insertTakerError
        }
        console.log(`[rewards] ${network}: Successfully inserted taker rewards for ${takerAddress}`)
      }
    } catch (takerErr) {
      console.error('[rewards] Failed to update taker rewards:', takerErr?.message || takerErr)
      throw takerErr
    }

    // Record reward history for maker
    const makerHistoryId = crypto.randomUUID()
    console.log(`[rewards] ${network}: Recording maker history with ID: ${makerHistoryId}`)
    await supabase
      .from('reward_history')
      .insert({
        id: makerHistoryId,
        network,
        user_address: makerAddress.toLowerCase(),
        trade_id: txHash,
        role: 'maker',
        volume_usd: volumeUsd,
        reward_points: makerPoints,
        reward_rate: REWARD_CONFIG.makerRate,
        base_token: baseToken,
        quote_token: quoteToken,
        amount_base: amountBase,
        amount_quote: amountQuote,
        created_at: nowIso
      })
      .then(() => console.log(`[rewards] ${network}: Successfully recorded maker history for ${makerAddress}`))
      .catch(e => console.warn('[rewards] Failed to record maker history:', e?.message || e))

    // Record reward history for taker
    const takerHistoryId = crypto.randomUUID()
    console.log(`[rewards] ${network}: Recording taker history with ID: ${takerHistoryId}`)
    await supabase
      .from('reward_history')
      .insert({
        id: takerHistoryId,
        network,
        user_address: takerAddress.toLowerCase(),
        trade_id: txHash,
        role: 'taker',
        volume_usd: volumeUsd,
        reward_points: takerPoints,
        reward_rate: REWARD_CONFIG.takerRate,
        base_token: baseToken,
        quote_token: quoteToken,
        amount_base: amountBase,
        amount_quote: amountQuote,
        created_at: nowIso
      })
      .then(() => console.log(`[rewards] ${network}: Successfully recorded taker history for ${takerAddress}`))
      .catch(e => console.warn('[rewards] Failed to record taker history:', e?.message || e))

    console.log(`[rewards] ${network}: Successfully awarded rewards for trade ${txHash?.slice(0, 10)}...`)

    return { makerPoints, takerPoints }
  } catch (e) {
    console.error('[rewards] Error awarding trade rewards:', e?.message || e)
    return { makerPoints: 0, takerPoints: 0 }
  }
}

// Get user rewards
async function getUserRewards(userAddress, network = null) {
  try {
    let query = supabase
      .from('user_rewards')
      .select('*')
      .eq('user_address', userAddress.toLowerCase())

    if (network) {
      query = query.eq('network', network)
    }

    const { data, error } = await query
    if (error) throw error
    return data || []
  } catch (e) {
    console.error('[rewards] Error getting user rewards:', e?.message || e)
    return []
  }
}

// Reservation helpers to ensure idempotent execution across executors
async function reserveOrder(orderId, network = 'bsc') {
  const table = network === 'crosschain' ? 'cross_chain_orders' : 'orders'
  const nowIso = new Date().toISOString()
  const statusUpdate = network === 'crosschain' ? {} : { status: 'processing' }
  try {
    const { data, error } = await supabase
      .from(table)
      .update({ ...statusUpdate, updated_at: nowIso })
      .eq('order_id', orderId)
      .eq('status', 'open')
      .gt('remaining', '0')
      .select('order_id, status, remaining')
      .limit(1)
    if (error) throw error
    return Array.isArray(data) && data.length === 1
  } catch (e) {
    console.warn('[executor] reserveOrder failed:', e?.message || e)
    return false
  }
}

async function releaseOrder(orderId, network = 'bsc', toStatus = 'open') {
  try {
    // Do not downgrade from filled -> open
    if (toStatus !== 'open' && toStatus !== 'filled') toStatus = 'open'
    await updateOrderStatus(orderId, toStatus, network)
  } catch (e) {
    console.warn('[executor] releaseOrder failed:', e?.message || e)
  }
}

// Map known 4-byte error selectors to readable names (from provided ABI)
const ERROR_SELECTORS = {
  // keccak256('BadSignature()').slice(0,10)
  '0x89b3a34f': 'BadSignature',
  // keccak256('Expired()')
  '0x9bfb9bbc': 'Expired',
  // keccak256('InvalidOrder()')
  '0x8f32d59b': 'InvalidOrder',
  // keccak256('Overfill()')
  '0x3fd787bf': 'Overfill',
  // keccak256('PriceTooLow()')
  '0xaf610693': 'PriceTooLow'
}

const ERC20_MIN_ABI = [
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transferFrom', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' }
]

// Cached token decimals helper and min-fill calculations
const tokenDecimalsCache = new Map()

async function getTokenDecimalsCached(address, network = 'bsc') {
  try {
    const key = `${network}:${(address || '').toLowerCase()}`
    if (tokenDecimalsCache.has(key)) return tokenDecimalsCache.get(key)

    let dec = null
    try {
      const { data: t } = await supabase
        .from('tokens')
        .select('address,decimals')
        .eq('network', network)
        .eq('address', (address || '').toLowerCase())
        .limit(1)
      if (Array.isArray(t) && t.length) {
        const row = t[0]
        if (row && row.decimals != null) dec = Number(row.decimals)
      }
    } catch {}

    // Hardcoded known tokens as fallback
    const addr = (address || '').toLowerCase()
    if (dec == null) {
      if (addr === '0x55d398326f99059ff775485246999027b3197955') dec = 6 // BSC USDT
      else if (addr === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') dec = 18 // BSC WBNB
      else if (addr === '0x4200000000000000000000000000000000000006') dec = 18 // Base WETH
      else if (addr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') dec = 6  // Base USDC
      else dec = 18
    }

    tokenDecimalsCache.set(key, dec)
    return dec
  } catch { return 18 }
}

function minUnitsForDecimals(decimals, fractionDigits) {
  const d = Math.max(0, Number(decimals) - Number(fractionDigits))
  let x = 1n
  for (let i = 0; i < d; i++) x *= 10n
  return x
}

async function getMinFillUnits(address, network, fractionDigitsDefault = 2) {
  const dec = await getTokenDecimalsCached(address, network)
  // Default: 0.01 unit for quote (2 digits). Callers choose fractionDigits.
  return minUnitsForDecimals(dec, fractionDigitsDefault)
}

async function fetchOrderRow(orderId, network = 'bsc') {
  try {
    const table = network === 'crosschain' ? 'cross_chain_orders' : 'orders'
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('order_id', orderId)
      .limit(1)
    if (error) throw error
    if (Array.isArray(data) && data.length) return data[0]
  } catch (e) {
    console.warn('[executor] fetchOrderRow failed:', e?.message || e)
  }
  return null
}

async function preflightDiagnostics(buyRow, sellRow, network = 'bsc') {
  const buy = normalizeOrderJson(buyRow.order_json || buyRow.order || {})
  const sell = normalizeOrderJson(sellRow.order_json || sellRow.order || {})
  const sigBuy = buyRow.signature || ''
  const sigSell = sellRow.signature || ''

  const settlementContract = network === 'base' ? settlementBase : settlement
  const settlementAddress = network === 'base' ? SETTLEMENT_ADDRESS_BASE : SETTLEMENT_ADDRESS_BSC
  const providerForNetwork = network === 'base' ? providerBase : providerBSC

  const [sigBuyOk, sigSellOk, availBuy, availSell] = await Promise.all([
    settlementContract.verifySignature(buy, sigBuy).catch(() => false),
    settlementContract.verifySignature(sell, sigSell).catch(() => false),
    settlementContract.availableToFill(buy).catch(() => 0n),
    settlementContract.availableToFill(sell).catch(() => 0n)
  ])

  const buyerErc = new Contract(buy.tokenIn, ERC20_MIN_ABI, providerForNetwork)
  const sellerErc = new Contract(sell.tokenIn, ERC20_MIN_ABI, providerForNetwork)

  const [buyerAllowance, buyerBalance, sellerAllowance, sellerBalance] = await Promise.all([
    buyerErc.allowance(buy.maker, settlementAddress).catch(() => 0n),
    buyerErc.balanceOf(buy.maker).catch(() => 0n),
    sellerErc.allowance(sell.maker, settlementAddress).catch(() => 0n),
    sellerErc.balanceOf(sell.maker).catch(() => 0n)
  ])

  return { buy, sell, sigBuy, sigSell, sigBuyOk, sigSellOk, availBuy: BigInt(availBuy), availSell: BigInt(availSell), buyerAllowance: BigInt(buyerAllowance), buyerBalance: BigInt(buyerBalance), sellerAllowance: BigInt(sellerAllowance), sellerBalance: BigInt(sellerBalance) }
}

function decodeRevertSelector(data) {
  try {
    if (!data || typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return null
    const sel = data.slice(0, 10)
    return ERROR_SELECTORS[sel] || null
  } catch { return null }
}

async function tryMatchPairCrossChain(base, quote, bids, asks) {
  console.log(`[executor] cross-chain: sorting ${bids.length} bids and ${asks.length} asks for ${base}/${quote}`)

  // Get decimals and networks for base and quote
  let baseDec = 18, quoteDec = 18, baseNetwork = 'bsc', quoteNetwork = 'bsc'
  try {
    const { data: t } = await supabase
      .from('tokens')
      .select('address,decimals,network')
      .in('network', ['bsc', 'base'])
      .in('address', [base, quote])
    if (t && Array.isArray(t)) {
      for (const row of t) {
        const addr = (row.address || '').toLowerCase()
        if (addr === base) {
          baseDec = Number(row.decimals) || 18
          baseNetwork = row.network || 'bsc'
        }
        if (addr === quote) {
          quoteDec = Number(row.decimals) || 18
          quoteNetwork = row.network || 'bsc'
        }
      }
    }
  } catch (e) {
    console.warn('[executor] cross-chain: failed to fetch decimals and networks:', e?.message || e)
  }
  // Hardcode known decimals
  if (base === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') baseDec = 18
  if (quote === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') quoteDec = 6

  const buyNetwork = quoteNetwork
  const sellNetwork = baseNetwork
  const buyProvider = buyNetwork === 'base' ? providerBase : providerBSC
  const sellProvider = sellNetwork === 'base' ? providerBase : providerBSC
  const buyWallet = buyNetwork === 'base' ? walletBase : walletBSC
  const sellWallet = sellNetwork === 'base' ? walletBase : walletBSC

  bids.sort((a, b) => {
    const ainA = toBN(a.amount_in)
    const aoutA = toBN(a.amount_out_min)
    const ainB = toBN(b.amount_in)
    const aoutB = toBN(b.amount_out_min)
    const pA = ainA * 10n ** BigInt(baseDec + 18) / (aoutA * 10n ** BigInt(quoteDec))
    const pB = ainB * 10n ** BigInt(baseDec + 18) / (aoutB * 10n ** BigInt(quoteDec))
    if (pA > pB) return -1
    if (pA < pB) return 1
    return 0
  }) // highest bid first
  asks.sort((a, b) => {
    const ainA = toBN(a.amount_in)
    const aoutA = toBN(a.amount_out_min)
    const ainB = toBN(b.amount_in)
    const aoutB = toBN(b.amount_out_min)
    const pA = aoutA * 10n ** BigInt(baseDec + 18) / (ainA * 10n ** BigInt(quoteDec))
    const pB = aoutB * 10n ** BigInt(baseDec + 18) / (ainB * 10n ** BigInt(quoteDec))
    if (pA > pB) return 1
    if (pA < pB) return -1
    return 0
  }) // lowest ask first

  const bestBid = bids[0]
  const bestAsk = asks[0]

  if (!bestBid || !bestAsk) {
    console.log(`[executor] cross-chain: no best bid or ask available for ${base}/${quote}`)
    return false
  }

  // Skip self-trading
  if (bestBid.maker === bestAsk.maker) {
    console.log(`[executor] cross-chain: skipping ${base}/${quote} - same maker (${bestBid.maker})`)
    return false
  }

  const pBid = bestBid ? toBN(bestBid.amount_in) * 10n ** BigInt(baseDec + 18) / (toBN(bestBid.amount_out_min) * 10n ** BigInt(quoteDec)) : null
  const pAsk = bestAsk ? toBN(bestAsk.amount_out_min) * 10n ** BigInt(baseDec + 18) / (toBN(bestAsk.amount_in) * 10n ** BigInt(quoteDec)) : null

  console.log(`[executor] cross-chain: best bid price: ${pBid ? Number(pBid) / 1e18 : 'null'}, best ask price: ${pAsk ? Number(pAsk) / 1e18 : null}`)

  if (pBid === null || pAsk === null) {
    console.log(`[executor] cross-chain: null prices detected for ${base}/${quote}`)
    return false
  }

  if (!(pBid === pAsk)) {
    console.log(`[executor] cross-chain: prices not equal for ${base}/${quote} - bid: ${Number(pBid) / 1e18}, ask: ${Number(pAsk) / 1e18}`)
    return false
  }

  console.log(`[executor] cross-chain: prices are crossing for ${base}/${quote} - proceeding with cross-chain match attempt`)

  const buyRow = bestBid
  const sellRow = bestAsk
  const buy = normalizeOrderJson(buyRow.order_json || buyRow.order || {})
  const sell = normalizeOrderJson(sellRow.order_json || sellRow.order || {})

  // Remaining amounts
  let buyRemQuote = toBN(buyRow.remaining || buy.amountIn) // buyer spends quote to receive base
  let sellRemBase = toBN(sellRow.remaining || sell.amountIn) // seller sells base to receive quote

  console.log(`[executor] cross-chain: remaining amounts - buyRemQuote: ${buyRemQuote.toString()}, sellRemBase: ${sellRemBase.toString()}`)

  if (buyRemQuote <= 0n || sellRemBase <= 0n) {
    console.log(`[executor] cross-chain: skipping ${base}/${quote} - insufficient remaining amounts`)
    return false
  }

  const custodialAddress = CUSTODIAL_ADDRESS

  // Check buyer's allowance and balance on buy network (quote token)
  const buyerErcQuote = new Contract(buy.tokenIn, ERC20_MIN_ABI, buyProvider)
  const [buyerAllowanceQuote, buyerBalanceQuote] = await Promise.all([
    buyerErcQuote.allowance(buy.maker, buyWallet.address).catch(() => 0n),
    buyerErcQuote.balanceOf(buy.maker).catch(() => 0n)
  ])

  // Check seller's allowance and balance on sell network (base token)
  const sellerErcBase = new Contract(sell.tokenIn, ERC20_MIN_ABI, sellProvider)
  const [sellerAllowanceBase, sellerBalanceBase] = await Promise.all([
    sellerErcBase.allowance(sell.maker, sellWallet.address).catch(() => 0n),
    sellerErcBase.balanceOf(sell.maker).catch(() => 0n)
  ])

  console.log(`[executor] cross-chain: buyer allowance for ${buyWallet.address}: ${buyerAllowanceQuote.toString()}, balance: ${buyerBalanceQuote.toString()}`)
  console.log(`[executor] cross-chain: seller allowance for ${sellWallet.address}: ${sellerAllowanceBase.toString()}, balance: ${sellerBalanceBase.toString()}`)

  // Start with buyer's quote budget
  let baseOut = minOut(buyRemQuote, buy.amountIn, buy.amountOutMin)
  if (baseOut <= 0n) {
    console.log('[executor] cross-chain: buyer budget insufficient', { buyRemQuote: buyRemQuote.toString(), buyId: buyRow.order_id })
    return false
  }

  // Cap by seller remaining
  if (baseOut > sellRemBase) baseOut = sellRemBase
  if (baseOut <= 0n) return false

  // Seller requires at least this much quote for that base
  let quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)

  // If buyer can't cover, reduce baseOut
  if (quoteNeededBySell > buyRemQuote) {
    baseOut = (buyRemQuote * sell.amountIn) / sell.amountOutMin // floor
    if (baseOut <= 0n) return false
    quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
    if (quoteNeededBySell > buyRemQuote) return false
  }

  // Enforce buyer's min base for the chosen quote
  const buyerMinBaseForQuoteIn = minOut(quoteNeededBySell, buy.amountIn, buy.amountOutMin)
  // Ensure buyer receives at least their minimum base for the quote being spent.
  // If buyer's minimum exceeds baseOut, we cannot satisfy constraints at this size.
  if (buyerMinBaseForQuoteIn > baseOut) {
    // Try to reduce the quote to match the chosen baseOut and re-validate.
    quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
    const buyerMinForAdjustedQuote = minOut(quoteNeededBySell, buy.amountIn, buy.amountOutMin)
    if (buyerMinForAdjustedQuote > baseOut) return false
  }

  const quoteIn = quoteNeededBySell

  const adjustedQuoteIn = quoteIn
  const adjustedBaseOut = baseOut

  // Check if sufficient balance
  if (buyerBalanceQuote < adjustedQuoteIn) {
    console.log(`[executor] cross-chain: buyer insufficient balance for quote: balance ${buyerBalanceQuote}, needed ${adjustedQuoteIn}`)
    return false
  }
  if (sellerBalanceBase < adjustedBaseOut) {
    console.log(`[executor] cross-chain: seller insufficient balance for base: balance ${sellerBalanceBase}, needed ${adjustedBaseOut}`)
    return false
  }

  // Reserve both cross-chain orders to prevent duplicate settlement
  let lockedBuy = false, lockedSell = false
  lockedBuy = await reserveOrder(buyRow.order_id, 'crosschain')
  if (!lockedBuy) { console.log('[executor] cross-chain: failed to reserve buy order', buyRow.order_id); return false }
  lockedSell = await reserveOrder(sellRow.order_id, 'crosschain')
  if (!lockedSell) { console.log('[executor] cross-chain: failed to reserve sell order', sellRow.order_id); await releaseOrder(buyRow.order_id, 'crosschain', 'open'); return false }

  console.log(`[executor] cross-chain: attempting settlement for ${base}/${quote}`)
  console.log(`[executor] cross-chain: quoteIn: ${quoteIn.toString()}, baseOut: ${baseOut.toString()}`)
  console.log(`[executor] cross-chain: buyer: ${buy.maker} on ${buyNetwork}, seller: ${sell.maker} on ${sellNetwork}`)

  let buyTransferred = false
  let sellTransferred = false
  let receiptBuy = null
  let receiptSell = null

  try {
    // Step 1: Transfer buyer's quote to executor wallet on buy network
    console.log(`[executor] cross-chain: transferring ${adjustedQuoteIn.toString()} quote from buyer to executor on ${buyNetwork}`)
    const txBuy = await buyerErcQuote.connect(buyWallet).transferFrom(buy.maker, buyWallet.address, adjustedQuoteIn)
    receiptBuy = await txBuy.wait()
    buyTransferred = true
    console.log(`[executor] cross-chain: buyer transfer confirmed`)

    // Step 2: Transfer seller's base to executor wallet on sell network
    console.log(`[executor] cross-chain: transferring ${adjustedBaseOut.toString()} base from seller to executor on ${sellNetwork}`)
    const txSell = await sellerErcBase.connect(sellWallet).transferFrom(sell.maker, sellWallet.address, adjustedBaseOut)
    receiptSell = await txSell.wait()
    sellTransferred = true
    console.log(`[executor] cross-chain: seller transfer confirmed`)

    // Step 3: Now transfer to counterparties
    let receiptBuySettlement = null
    let receiptSellSettlement = null

    // Transfer quote to seller's receiver on buy network
    const sellerReceiver = (sell.receiver && sell.receiver !== '0x0000000000000000000000000000000000000000') ? sell.receiver : sell.maker
    console.log(`[executor] cross-chain: transferring ${quoteIn.toString()} quote to seller ${sellerReceiver} on ${buyNetwork}`)
    const txQuoteToSeller = await buyerErcQuote.connect(buyWallet).transfer(sellerReceiver, quoteIn)
    receiptBuySettlement = await txQuoteToSeller.wait()
    console.log(`[executor] cross-chain: quote settlement tx: ${receiptBuySettlement.transactionHash}`)

    // Transfer base to buyer's receiver on sell network
    const buyerReceiver = (buy.receiver && buy.receiver !== '0x0000000000000000000000000000000000000000') ? buy.receiver : buy.maker
    console.log(`[executor] cross-chain: transferring ${baseOut.toString()} base to buyer ${buyerReceiver} on ${sellNetwork}`)
    const txBaseToBuyer = await sellerErcBase.connect(sellWallet).transfer(buyerReceiver, baseOut)
    receiptSellSettlement = await txBaseToBuyer.wait()
    console.log(`[executor] cross-chain: base settlement tx: ${receiptSellSettlement.transactionHash}`)

    console.log(`[executor] cross-chain: settlement completed successfully`)

    // Record the cross-chain fill with all transaction hashes
    try {
      await supabase.from('cross_chain_fills').insert({
        buy_network: buyNetwork,
        sell_network: sellNetwork,
        buy_order_id: buyRow.order_id,
        sell_order_id: sellRow.order_id,
        amount_base: adjustedBaseOut.toString(),
        amount_quote: adjustedQuoteIn.toString(),
        // Custodial transaction hashes (transferFrom from users to executor)
        tx_hash_buy: receiptBuy?.hash || null,
        tx_hash_sell: receiptSell?.hash || null,
        block_number_buy: receiptBuy?.blockNumber || null,
        block_number_sell: receiptSell?.blockNumber || null,
        // Settlement transaction hashes (transfer from executor to parties)
        tx_hash_buy_settlement: receiptBuySettlement?.hash || null,
        tx_hash_sell_settlement: receiptSellSettlement?.hash || null,
        block_number_buy_settlement: receiptBuySettlement?.blockNumber || null,
        block_number_sell_settlement: receiptSellSettlement?.blockNumber || null,
        status: 'completed',
        updated_at: new Date().toISOString()
      })
    } catch (e) {
      console.warn('[executor] failed to insert cross_chain_fills:', e?.message || e)
    }

    // Record the cross-chain trade
    const baseAddr = (buyRow.base_address || sellRow.base_address || '').toLowerCase()
    const quoteAddr = (buyRow.quote_address || sellRow.quote_address || '').toLowerCase()
    const pair = baseAddr && quoteAddr ? `${baseAddr}/${quoteAddr}` : 'unknown'

    // Compute price
    let baseDec = 18, quoteDec = 18
    try {
      const decRows = []
      if (baseAddr) decRows.push({ addr: baseAddr, role: 'base' })
      if (quoteAddr) decRows.push({ addr: quoteAddr, role: 'quote' })
      if (decRows.length && supabase) {
        const { data: t } = await supabase
          .from('tokens')
          .select('address,decimals')
          .in('network', [buyNetwork, sellNetwork])
          .in('address', decRows.map(x => x.addr))
        if (t && Array.isArray(t)) {
          for (const row of t) {
            const a = (row.address || '').toLowerCase()
            if (a === baseAddr && row.decimals != null) baseDec = Number(row.decimals)
            if (a === quoteAddr && row.decimals != null) quoteDec = Number(row.decimals)
          }
        }
      }
    } catch {}

    const qFloat = Number(adjustedQuoteIn)
    const bFloat = Number(adjustedBaseOut)
    const priceHuman = (qFloat / Math.pow(10, quoteDec)) / (bFloat / Math.pow(10, baseDec))

    try {
      await supabase.from('cross_chain_trades').insert({
        pair: pair,
        base_address: baseAddr,
        quote_address: quoteAddr,
        amount_base: adjustedBaseOut.toString(),
        amount_quote: adjustedQuoteIn.toString(),
        price: priceHuman,
        buy_network: buyNetwork,
        sell_network: sellNetwork,
        // Settlement transaction hashes (transfers from executor to parties)
        tx_hash_buy: receiptSellSettlement?.hash || null, // buyer receives base
        tx_hash_sell: receiptBuySettlement?.hash || null, // seller receives quote
        block_number_buy: receiptSellSettlement?.blockNumber || null,
        block_number_sell: receiptBuySettlement?.blockNumber || null,
        status: 'completed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    } catch (e) {
      console.warn('[executor] failed to insert cross_chain_trades:', e?.message || e)
    }

    // Update order remainings
    const baseDelivered = minOut(quoteIn, buy.amountIn, buy.amountOutMin)
    const newBuyRem = buyRemQuote - quoteIn
    const newSellRem = sellRemBase - baseOut
    await updateOrderRemaining(buyRow.order_id, newBuyRem, newBuyRem === 0n ? 'filled' : 'open', buyRow.network)
    await updateOrderRemaining(sellRow.order_id, newSellRem, newSellRem === 0n ? 'filled' : 'open', sellRow.network)

    return true

  } catch (e) {
    console.error(`[executor] cross-chain: settlement failed:`, e?.message || e)

    // Refund any transferred tokens back to makers
    try {
      if (buyTransferred) {
        console.log(`[executor] cross-chain: refunding buyer ${adjustedQuoteIn.toString()} quote on ${buyNetwork}`)
        await buyerErcQuote.connect(buyWallet).transfer(buy.maker, adjustedQuoteIn)
      }
      if (sellTransferred) {
        console.log(`[executor] cross-chain: refunding seller ${adjustedBaseOut.toString()} base on ${sellNetwork}`)
        await sellerErcBase.connect(sellWallet).transfer(sell.maker, adjustedBaseOut)
      }
    } catch (refundErr) {
      console.error(`[executor] cross-chain: refund failed:`, refundErr?.message || refundErr)
    }

    // Record failed fill
    try {
      await supabase.from('cross_chain_fills').insert({
        buy_network: buyNetwork,
        sell_network: sellNetwork,
        buy_order_id: buyRow.order_id,
        sell_order_id: sellRow.order_id,
        amount_base: adjustedBaseOut.toString(),
        amount_quote: adjustedQuoteIn.toString(),
        status: 'failed',
        updated_at: new Date().toISOString()
      })
    } catch (e) {
      console.warn('[executor] failed to insert failed cross_chain_fills:', e?.message || e)
    }

    // On failure, release both orders back to open
    try { await releaseOrder(buyRow.order_id, 'crosschain', 'open') } catch {}
    try { await releaseOrder(sellRow.order_id, 'crosschain', 'open') } catch {}

    throw e
  }
}

async function tryMatchPairOnce(base, quote, bids, asks, network = 'bsc') {
  console.log(`[executor] ${network}: sorting ${bids.length} bids and ${asks.length} asks for ${base}/${quote}`)

  bids.sort((a, b) => {
    const pb = priceBid(b)
    const pa = priceBid(a)
    if (pb === null && pa === null) return 0
    if (pb === null) return 1
    if (pa === null) return -1
    if (pb !== pa) return Number(pb - pa)
    // same price, earlier time first
    return new Date(a.created_at || a.updated_at) - new Date(b.created_at || b.updated_at)
  }) // highest bid first, then earliest time
  asks.sort((a, b) => {
    const pa = priceAsk(a)
    const pb = priceAsk(b)
    if (pa === null && pb === null) return 0
    if (pa === null) return 1
    if (pb === null) return -1
    if (pa !== pb) return Number(pa - pb)
    // same price, earlier time first
    return new Date(a.created_at || a.updated_at) - new Date(b.created_at || b.updated_at)
  }) // lowest ask first, then earliest time

  const bestBid = bids[0]
  const bestAsk = asks[0]

  if (!bestBid || !bestAsk) {
    console.log(`[executor] ${network}: no best bid or ask available for ${base}/${quote}`)
    return false
  }

  // Skip self-trading
  if (bestBid.maker === bestAsk.maker) {
    console.log(`[executor] ${network}: skipping ${base}/${quote} - same maker (${bestBid.maker})`)
    return false
  }

  const pBid = priceBid(bestBid)
  const pAsk = priceAsk(bestAsk)

  console.log(`[executor] ${network}: best bid price: ${pBid ? Number(pBid) / 1e18 : 'null'}, best ask price: ${pAsk ? Number(pAsk) / 1e18 : 'null'}`)
  console.log(`[executor] ${network}: order sources - bid: ${bestBid?.source || 'regular'} (${bestBid?.order_id}), ask: ${bestAsk?.source || 'regular'} (${bestAsk?.order_id})`)

  if (pBid === null || pAsk === null) {
    console.log(`[executor] ${network}: null prices detected for ${base}/${quote}`)
    return false
  }

  if (!(pBid >= pAsk)) {
    console.log(`[executor] ${network}: prices not crossing for ${base}/${quote} - bid: ${Number(pBid) / 1e18}, ask: ${Number(pAsk) / 1e18}`)
    return false
  }

  console.log(`[executor] ${network}: ✅ MATCHING ${bestBid?.source || 'regular'} bid (${bestBid?.order_id}) with ${bestAsk?.source || 'regular'} ask (${bestAsk?.order_id}) for ${base}/${quote}`)

  const buyRow = bestBid
  const sellRow = bestAsk
  const buy = normalizeOrderJson(buyRow.order_json || buyRow.order || {})
  const sell = normalizeOrderJson(sellRow.order_json || sellRow.order || {})
  const sigBuy = buyRow.signature || ''
  const sigSell = sellRow.signature || ''

  // Remaining amounts
  let buyRemQuote = toBN(buyRow.remaining || buy.amountIn) // buyer spends quote to receive base
  let sellRemBase = toBN(sellRow.remaining || sell.amountIn) // seller sells base to receive quote

  console.log(`[executor] ${network}: remaining amounts - buyRemQuote: ${buyRemQuote.toString()}, sellRemBase: ${sellRemBase.toString()}`)

  if (buyRemQuote <= 0n || sellRemBase <= 0n) {
    console.log(`[executor] ${network}: skipping ${base}/${quote} - insufficient remaining amounts`)
    return false
  }

  // Query contract-side availability (skip if unfillable)
  console.log(`[executor] ${network}: running preflight diagnostics for ${base}/${quote}`)
  const diag = await preflightDiagnostics(buyRow, sellRow, network)

  console.log(`[executor] ${network}: preflight results - buySigOk: ${!!diag.sigBuyOk}, sellSigOk: ${!!diag.sigSellOk}, availBuy: ${diag.availBuy.toString()}, availSell: ${diag.availSell.toString()}`)

  if (!diag.sigBuyOk || !diag.sigSellOk) {
    console.log(`[executor] ${network}: skipping ${base}/${quote} - signature invalid (buy: ${!!diag.sigBuyOk}, sell: ${!!diag.sigSellOk})`)
    return false
  }
  if (diag.availBuy <= 0n || diag.availSell <= 0n) {
    console.log(`[executor] ${network}: skipping ${base}/${quote} - availableToFill zero (buy: ${diag.availBuy.toString()}, sell: ${diag.availSell.toString()})`)
    return false
  }

  // Convert availBuy (in quote for buy order) to base capacity via buy ratio (floor)
  const baseFromBuyAvail = minOut(diag.availBuy, buy.amountIn, buy.amountOutMin)
  const baseFromSellAvail = diag.availSell // already base

  // Start strictly from buyer's quote budget in base units (floor)
  let baseOut = minOut(buyRemQuote, buy.amountIn, buy.amountOutMin)
  if (baseOut <= 0n) {
    console.log('[executor] skip: buyer budget insufficient', { buyRemQuote: buyRemQuote.toString(), buyId: buyRow.order_id })
    return false
  }

  // Cap by seller remaining and on-chain availabilities
  const baseOutBudget = baseOut
  if (baseOut > sellRemBase) baseOut = sellRemBase
  if (baseOut > baseFromSellAvail) baseOut = baseFromSellAvail
  if (baseOut > baseFromBuyAvail) baseOut = baseFromBuyAvail
  const baseOutAfterCaps = baseOut
  console.log(`[executor] ${network}: calc: baseOut budget=${baseOutBudget.toString()} afterCaps=${baseOutAfterCaps.toString()} sellRemBase=${sellRemBase.toString()} baseFromSellAvail=${baseFromSellAvail.toString()} baseFromBuyAvail=${baseFromBuyAvail.toString()}`)
  if (baseOut <= 0n) return false

  // Seller requires at least this much quote for that base, use ceil to avoid underpayment
  let quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
  console.log(`[executor] ${network}: calc: quoteNeeded initial=${quoteNeededBySell.toString()} for baseOut=${baseOut.toString()}`)

  // If buyer can't cover, reduce baseOut using seller ratio inverted (floor), then recompute ceil quote
  if (quoteNeededBySell > buyRemQuote) {
    const prevQuoteNeeded = quoteNeededBySell
    const prevBaseOut = baseOut
    baseOut = (buyRemQuote * sell.amountIn) / sell.amountOutMin // floor
    console.log(`[executor] ${network}: adjust: buyer budget insufficient: quoteNeeded=${prevQuoteNeeded.toString()} > buyRemQuote=${buyRemQuote.toString()} . Shrinking baseOut ${prevBaseOut.toString()} -> ${baseOut.toString()}`)
    if (baseOut <= 0n) return false
    const beforeCaps2 = baseOut
    if (baseOut > sellRemBase) baseOut = sellRemBase
    if (baseOut > baseFromSellAvail) baseOut = baseFromSellAvail
    if (baseOut > baseFromBuyAvail) baseOut = baseFromBuyAvail
    console.log(`[executor] ${network}: adjust: baseOut after caps=${baseOut.toString()} (preCaps=${beforeCaps2.toString()})`)
    if (baseOut <= 0n) return false
    quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
    console.log(`[executor] ${network}: adjust: recomputed quoteNeeded=${quoteNeededBySell.toString()}`)
    if (quoteNeededBySell > buyRemQuote) return false
  }

  // Enforce buyer's min base for the chosen quote (floor)
  const buyerMinBaseForQuoteIn = minOut(quoteNeededBySell, buy.amountIn, buy.amountOutMin)
  // Ensure buyer receives at least their minimum base for the quote being spent.
  // If buyer's minimum exceeds baseOut, we cannot satisfy constraints at this size.
  if (buyerMinBaseForQuoteIn > baseOut) {
    console.log(`[executor] ${network}: constraint: buyerMinBase=${buyerMinBaseForQuoteIn.toString()} > baseOut=${baseOut.toString()} - adjusting quote for fixed baseOut`)
    // Try to reduce the quote to match the chosen baseOut and re-validate.
    quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
    const buyerMinForAdjustedQuote = minOut(quoteNeededBySell, buy.amountIn, buy.amountOutMin)
    console.log(`[executor] ${network}: constraint: adjusted quoteNeeded=${quoteNeededBySell.toString()} -> buyerMinForAdjustedQuote=${buyerMinForAdjustedQuote.toString()}`)
    if (buyerMinForAdjustedQuote > baseOut) return false
  }

  const quoteIn = quoteNeededBySell

  // Dust/min-fill guard: prevent micro-fills
  try {
    const baseDec = await getTokenDecimalsCached(base, network)
    const quoteDec = await getTokenDecimalsCached(quote, network)
    // Policy: require at least 0.01 quote token and 1e-6 base token as a minimum chunk size
    const minQuoteFill = minUnitsForDecimals(quoteDec, 2) // 0.01 quote unit
    const minBaseFill = minUnitsForDecimals(baseDec, 6)  // 0.000001 base unit

    if (quoteIn < minQuoteFill || baseOut < minBaseFill) {
      console.log(`[executor] ${network}: below min-fill -> finalize limiting side. quoteIn=${quoteIn.toString()} (min=${minQuoteFill.toString()}), baseOut=${baseOut.toString()} (min=${minBaseFill.toString()})`)

      // Decide limiting side: if baseOut hit sellRemBase or baseFromSellAvail, seller is limiting.
      // If quoteIn hit buyRemQuote or baseFromBuyAvail via minOut, buyer is limiting.
      try {
        let closedAny = false
        // Heuristics to determine which side was the binding constraint
        // We recompute some caps to detect which equality held.
        const baseFromBuyAvail_local = minOut(diag.availBuy, buy.amountIn, buy.amountOutMin)
        const baseFromSellAvail_local = diag.availSell

        // If baseOut equals sellRemBase or baseFromSellAvail, seller limited
        const sellerLimited = (baseOut === sellRemBase) || (baseOut === baseFromSellAvail_local)
        // If quoteIn is very close to buyRemQuote or baseOut equals baseFromBuyAvail, buyer limited
        const buyerLimited = (quoteIn >= buyRemQuote) || (baseOut === baseFromBuyAvail_local)

        if (sellerLimited && !buyerLimited) {
          console.log(`[executor] ${network}: seller limiting -> closing sell order ${sellRow.order_id}`)
          await updateOrderRemaining(sellRow.order_id, 0n, 'filled', network)
          closedAny = true
        } else if (buyerLimited && !sellerLimited) {
          console.log(`[executor] ${network}: buyer limiting -> closing buy order ${buyRow.order_id}`)
          await updateOrderRemaining(buyRow.order_id, 0n, 'filled', network)
          closedAny = true
        } else {
          // Ambiguous: close both to guarantee no retries
          console.log(`[executor] ${network}: ambiguous limiter -> closing both orders ${buyRow.order_id} and ${sellRow.order_id}`)
          await updateOrderRemaining(buyRow.order_id, 0n, 'filled', network)
          await updateOrderRemaining(sellRow.order_id, 0n, 'filled', network)
          closedAny = true
        }

        // As a safety, if their remainders are below thresholds, close both anyway
        if (buyRemQuote < minQuoteFill) {
          console.log(`[executor] ${network}: also closing buy order ${buyRow.order_id} due to dust remainder ${buyRemQuote.toString()} < ${minQuoteFill.toString()}`)
          await updateOrderRemaining(buyRow.order_id, 0n, 'filled', network)
          closedAny = true
        }
        if (sellRemBase < minBaseFill) {
          console.log(`[executor] ${network}: also closing sell order ${sellRow.order_id} due to dust remainder ${sellRemBase.toString()} < ${minBaseFill.toString()}`)
          await updateOrderRemaining(sellRow.order_id, 0n, 'filled', network)
          closedAny = true
        }

        if (!closedAny) {
          console.log(`[executor] ${network}: min-fill guard triggered but no side conclusively limiting; closing both orders to prevent reprocessing.`)
          await updateOrderRemaining(buyRow.order_id, 0n, 'filled', network)
          await updateOrderRemaining(sellRow.order_id, 0n, 'filled', network)
        }
      } catch (e) {
        console.warn('[executor] min-fill finalization failed:', e?.message || e)
      }
      return false
    }
  } catch (e) {
    console.warn('[executor] dust guard error (continuing):', e?.message || e)
  }

  console.log(`[executor] ${network}: decision: proceed match baseOut=${baseOut.toString()} quoteIn=${quoteIn.toString()} buyRemQuote=${buyRemQuote.toString()} sellRemBase=${sellRemBase.toString()}`)

  // Preflight diagnostics (reuse diag)
  const pre = {
    pair: `${base}/${quote}`,
    sigBuyOk: !!diag.sigBuyOk,
    sigSellOk: !!diag.sigSellOk,
    availBuy: diag.availBuy.toString(),
    availSell: diag.availSell.toString(),
    buyerAllowance: diag.buyerAllowance.toString(),
    buyerBalance: diag.buyerBalance.toString(),
    sellerAllowance: diag.sellerAllowance.toString(),
    sellerBalance: diag.sellerBalance.toString(),
    amountQuote: quoteIn.toString(),
    amountBase: baseOut.toString(),
    buyId: buyRow.order_id,
    sellId: sellRow.order_id,
    bidPrice1e18: pBid?.toString?.(),
    askPrice1e18: pAsk?.toString?.()
  }
  console.log(`[executor] ${network}: preflight diagnostics for ${base}/${quote}:`, pre)

  // Human-friendly price (quote per base) for logs only
  const humanBid = Number(pBid) / 1e18
  const humanAsk = Number(pAsk) / 1e18
  console.log('[executor] matching', {
    pair: `${base}/${quote}`,
    bidPrice: humanBid,
    askPrice: humanAsk,
    quoteIn: quoteIn.toString(),
    baseOut: baseOut.toString(),
    buyId: buyRow.order_id,
    sellId: sellRow.order_id
  })

  // Reserve both orders atomically to avoid duplicate execution
  let lockedBuy = false, lockedSell = false
  lockedBuy = await reserveOrder(buyRow.order_id, network)
  if (!lockedBuy) {
    console.log(`[executor] ${network}: failed to reserve buy order ${buyRow.order_id}`)
    // Reconcile: if order remainder is now dust or zero, close it to avoid retries
    try {
      const freshBuy = await fetchOrderRow(buyRow.order_id, network)
      if (freshBuy) {
        const freshRemaining = toBN(freshBuy.remaining || 0)
        const qDec = await getTokenDecimalsCached(quote, network)
        const minQ = minUnitsForDecimals(qDec, 2)
        if (freshRemaining === 0n || freshRemaining < minQ) {
          console.log(`[executor] ${network}: reconciling buy ${buyRow.order_id} -> close (remaining=${freshRemaining.toString()})`)
          await updateOrderRemaining(buyRow.order_id, 0n, 'filled', network)
        }
      }
    } catch {}
    return false
  }
  lockedSell = await reserveOrder(sellRow.order_id, network)
  if (!lockedSell) {
    console.log(`[executor] ${network}: failed to reserve sell order ${sellRow.order_id}`)
    await releaseOrder(buyRow.order_id, network, 'open')
    // Reconcile seller dust
    try {
      const freshSell = await fetchOrderRow(sellRow.order_id, network)
      if (freshSell) {
        const freshRemaining = toBN(freshSell.remaining || 0)
        const bDec = await getTokenDecimalsCached(base, network)
        const minB = minUnitsForDecimals(bDec, 6)
        if (freshRemaining === 0n || freshRemaining < minB) {
          console.log(`[executor] ${network}: reconciling sell ${sellRow.order_id} -> close (remaining=${freshRemaining.toString()})`)
          await updateOrderRemaining(sellRow.order_id, 0n, 'filled', network)
        }
      }
    } catch {}
    return false
  }

  try {
    console.log(`[executor] ${network}: attempting to match orders for ${base}/${quote}`)
    const settlementContract = network === 'base' ? settlementBase : settlement
    const tx = await settlementContract.matchOrders(buy, sigBuy, sell, sigSell, baseOut, quoteIn)
    console.log(`[executor] ${network}: match tx sent: ${tx.hash}`)
    const receipt = await tx.wait()
    console.log(`[executor] ${network}: match tx confirmed in block ${receipt.blockNumber}`)
    // Persist fill record for UI consumption
    try {
      // Insert into fills table
      const network = buyRow.network || 'bsc'
      await supabase.from('fills').insert({
        network: network,
        buy_order_id: buyRow.order_id,
        sell_order_id: sellRow.order_id,
        amount_base: baseOut.toString(),
        amount_quote: quoteIn.toString(),
        tx_hash: receipt.hash || tx.hash,
        block_number: receipt.blockNumber,
        created_at: new Date().toISOString()
      })

      // Also insert enriched trade data for market stats
      const baseAddr = (buyRow.base_address || sellRow.base_address || '').toLowerCase()
      const quoteAddr = (buyRow.quote_address || sellRow.quote_address || '').toLowerCase()
      const pair = baseAddr && quoteAddr ? `${baseAddr}/${quoteAddr}` : 'unknown'

      // Determine decimals for human price: DB lookup first, then canonical overrides (cannot be overridden)
      let baseDec = 18
      let quoteDec = 18
      try {
        // 1) Fetch from tokens table if available
        const decRows = []
        if (baseAddr) decRows.push({ addr: baseAddr, role: 'base' })
        if (quoteAddr) decRows.push({ addr: quoteAddr, role: 'quote' })
        if (decRows.length && supabase) {
          const { data: t } = await supabase
            .from('tokens')
            .select('address,decimals')
            .eq('network', network)
            .in('address', decRows.map(x => x.addr))
          if (t && Array.isArray(t)) {
            for (const row of t) {
              const a = (row.address || '').toLowerCase()
              if (a === baseAddr && row.decimals != null) baseDec = Number(row.decimals)
              if (a === quoteAddr && row.decimals != null) quoteDec = Number(row.decimals)
            }
          }
        }
        // 2) Apply canonical overrides last to avoid bad DB values
        if (network === 'base') {
          if (baseAddr === '0x4200000000000000000000000000000000000006') baseDec = 18 // WETH
          if (quoteAddr === '0x4200000000000000000000000000000000000006') quoteDec = 18 // WETH
          if (baseAddr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') baseDec = 6  // USDC (unlikely base)
          if (quoteAddr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') quoteDec = 6 // USDC
          if (quoteAddr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' && quoteDec !== 6) {
            console.warn('[executor] WARNING: USDC on Base detected with non-6 decimals from DB; forcing to 6')
          }
        }
      } catch {}
      // Compute human price = (quote/10^qDec) / (base/10^bDec)
      const qFloat = Number(quoteIn)
      const bFloat = Number(baseOut)
      const priceHuman = (qFloat / Math.pow(10, quoteDec)) / (bFloat / Math.pow(10, baseDec))
      console.log('[executor] inserting trade', {
        network,
        pair,
        baseAddr,
        quoteAddr,
        baseDec,
        quoteDec,
        amountBase: baseOut.toString(),
        amountQuote: quoteIn.toString(),
        priceHuman
      })

      await supabase.from('trades').insert({
        network: network,
        pair: pair,
        base_address: baseAddr,
        quote_address: quoteAddr,
        amount_base: baseOut.toString(),
        amount_quote: quoteIn.toString(),
        price: priceHuman,
        tx_hash: receipt.hash || tx.hash,
        block_number: receipt.blockNumber,
        created_at: new Date().toISOString()
      })

      // Award rewards to maker and taker
      try {
        console.log('[executor] Starting reward calculation for trade...')
        // Determine maker and taker (the order that was placed first is the maker)
        // Note: orders table uses 'maker' field for the user address
        const buyCreated = new Date(buyRow.created_at || 0).getTime()
        const sellCreated = new Date(sellRow.created_at || 0).getTime()
        const makerAddress = buyCreated <= sellCreated ? buyRow.maker : sellRow.maker
        const takerAddress = buyCreated <= sellCreated ? sellRow.maker : buyRow.maker

        console.log('[executor] Trade participants:', {
          buyAddress: buyRow.maker,
          sellAddress: sellRow.maker,
          buyCreated: new Date(buyRow.created_at).toISOString(),
          sellCreated: new Date(sellRow.created_at).toISOString(),
          makerAddress,
          takerAddress
        })

        // Calculate volume in USD (use quote amount if it's a stablecoin)
        let volumeUsd = 0
        const stablecoins = [
          '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC on Base
          '0x55d398326f99059ff775485246999027b3197955', // USDT on BSC
          '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC on BSC
        ]
        if (stablecoins.includes(quoteAddr)) {
          // Quote is stablecoin, use quote amount directly
          volumeUsd = Number(quoteIn) / Math.pow(10, quoteDec)
          console.log('[executor] Quote is stablecoin, volumeUsd:', volumeUsd)
        } else {
          // Estimate USD value using price (price = quote/base, so base * price = quote value)
          // If we don't have USD price, use a rough estimate
          volumeUsd = (Number(baseOut) / Math.pow(10, baseDec)) * priceHuman
          console.log('[executor] Quote is not stablecoin, estimated volumeUsd:', volumeUsd, 'price:', priceHuman)
        }

        console.log('[executor] Calling awardTradeRewards with:', {
          network,
          makerAddress,
          takerAddress,
          volumeUsd,
          baseAddr,
          quoteAddr,
          amountBase: Number(baseOut) / Math.pow(10, baseDec),
          amountQuote: Number(quoteIn) / Math.pow(10, quoteDec),
          txHash: receipt.hash || tx.hash
        })

        await awardTradeRewards(
          network,
          makerAddress,
          takerAddress,
          volumeUsd,
          baseAddr,
          quoteAddr,
          Number(baseOut) / Math.pow(10, baseDec),
          Number(quoteIn) / Math.pow(10, quoteDec),
          receipt.hash || tx.hash
        )
      } catch (rewardErr) {
        console.error('[executor] failed to award rewards:', rewardErr?.message || rewardErr)
        console.error('[executor] reward error stack:', rewardErr?.stack)
      }

      // Broadcast real-time update to clients
      try {
      const INDEXER_BASE = 'https://cookbook-hjnhgq.fly.dev'
        await fetch(`${INDEXER_BASE}/api/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            network,
            base: baseAddr,
            quote: quoteAddr,
            type: 'new_fill',
            data: {
              amount_base: baseOut.toString(),
              amount_quote: quoteIn.toString(),
              price: priceHuman,
              tx_hash: receipt.hash || tx.hash
            }
          })
        })
      } catch (broadcastErr) {
        console.warn('[executor] failed to broadcast update:', broadcastErr?.message || broadcastErr)
      }
    } catch (insErr) {
      console.warn('[executor] failed to insert trade records:', insErr?.message || insErr)
    }
  } catch (e) {
    const sel = decodeRevertSelector(e?.data)
    console.error('[executor] match revert:', sel || 'unknown', 'selector', (e?.data ? e.data.slice(0,10) : 'n/a'))
    console.error('[executor] context:', pre)
    // Provide extra hints on common reasons
    if (sel === 'PriceTooLow') {
      console.error('[executor] hint: prices not mutually compatible at chosen size; check min constraints and crossing condition pBid >= pAsk')
    } else if (sel === 'Overfill') {
      console.error('[executor] hint: baseOut exceeded on-chain availableToFill; try reducing size or requery availabilities')
    } else if (sel === 'InvalidOrder') {
      console.error('[executor] hint: order may be expired, cancelled, or minNonce bumped')
    } else if (sel === 'BadSignature') {
      console.error('[executor] hint: signature does not match order digest/domain')
    }
    // Release locks on failure
    try { if (lockedBuy) await releaseOrder(buyRow.order_id, network, 'open') } catch {}
    try { if (lockedSell) await releaseOrder(sellRow.order_id, network, 'open') } catch {}
    throw e
  }

  const baseDelivered = minOut(quoteIn, buy.amountIn, buy.amountOutMin)
  const newBuyRem = buyRemQuote - quoteIn
  const newSellRem = sellRemBase - baseOut
  await updateOrderRemaining(buyRow.order_id, newBuyRem, newBuyRem === 0n ? 'filled' : 'open', network)
  await updateOrderRemaining(sellRow.order_id, newSellRem, newSellRem === 0n ? 'filled' : 'open', network)
  // No need to release explicitly; status is set by updateOrderRemaining
  return true
}

async function runCrossChain() {
  if (!EXECUTOR_ENABLED) {
    console.log(`[executor] cross-chain: executor disabled`)
    return
  }
  if (!supabase) {
    console.log(`[executor] cross-chain: supabase not available`)
    return
  }
  if (!walletBSC || !walletBase) {
    console.log(`[executor] cross-chain: both networks not connected`)
    return
  }

  console.log(`[executor] cross-chain: starting cross-chain execution cycle`)

  try {
    console.log(`[executor] cross-chain: fetching open orders from both networks...`)
    const rows = await fetchOpenOrdersCrossChain()
    console.log(`[executor] cross-chain: fetched ${rows.length} total orders`)

    if (!rows.length) {
      console.log(`[executor] cross-chain: no open orders found`)
      return
    }

    const byPair = new Map()
    for (const r of rows) {
      const base = (r.base || '').toLowerCase()
      const quote = (r.quote || '').toLowerCase()
      if (!base || !quote) {
        console.log(`[executor] cross-chain: skipping order with missing base/quote:`, r.order_id)
        continue
      }
      const key = `${base}|${quote}`
      if (!byPair.has(key)) byPair.set(key, { base, quote, bids: [], asks: [] })
      const grp = byPair.get(key)
      const side = classifyRowSide(base, quote, r)
      if (side === 'ask') grp.asks.push(r)
      else if (side === 'bid') grp.bids.push(r)
      else {
        console.log(`[executor] cross-chain: order ${r.order_id} has invalid side for pair ${base}/${quote}`)
      }
    }

    console.log(`[executor] cross-chain: organized into ${byPair.size} trading pairs`)

    for (const [pairKey, { base, quote, bids, asks }] of byPair.entries()) {
      console.log(`[executor] cross-chain: pair ${pairKey} - bids: ${bids.length}, asks: ${asks.length}`)

      if (!bids.length || !asks.length) {
        console.log(`[executor] cross-chain: skipping pair ${pairKey} - missing bids or asks`)
        continue
      }

      console.log(`[executor] cross-chain: checking pair ${base}/${quote} for cross-chain matches`)
      try {
        const done = await tryMatchPairCrossChain(base, quote, bids, asks)
        if (done) {
          console.log(`[executor] cross-chain: successfully matched cross-chain pair ${base}/${quote}`)
          return // one match per tick
        } else {
          console.log(`[executor] cross-chain: no matches found for cross-chain pair ${base}/${quote}`)
        }
      } catch (e) {
        console.error(`[executor] cross-chain: match error for ${base}/${quote}:`, e?.message || e)
      }
    }

    console.log(`[executor] cross-chain: execution cycle completed - no matches found`)

  } catch (e) {
    console.error(`[executor] cross-chain: execution cycle failed:`, e?.message || e)
  }
}

async function processOrders(rows, network = 'bsc') {
  const byPair = new Map()
  for (const r of rows) {
    const base = (r.base || '').toLowerCase()
    const quote = (r.quote || '').toLowerCase()
    if (!base || !quote) {
      console.log(`[executor] ${network}: skipping order with missing base/quote:`, r.order_id)
      continue
    }
    const key = `${base}|${quote}`
    if (!byPair.has(key)) byPair.set(key, { base, quote, bids: [], asks: [] })
    const grp = byPair.get(key)
    const side = classifyRowSide(base, quote, r)
    if (side === 'ask') grp.asks.push(r)
    else if (side === 'bid') grp.bids.push(r)
    else {
      console.log(`[executor] ${network}: order ${r.order_id} has invalid side for pair ${base}/${quote}`)
    }
  }

  console.log(`[executor] ${network}: organized into ${byPair.size} trading pairs`)

  let matchesThisCycle = 0
  const maxMatchesPerCycle = 5
  for (const [pairKey, { base, quote, bids, asks }] of byPair.entries()) {
    console.log(`[executor] ${network}: pair ${pairKey} - bids: ${bids.length}, asks: ${asks.length}`)

    if (!bids.length || !asks.length) {
      console.log(`[executor] ${network}: skipping pair ${pairKey} - missing bids or asks`)
      continue
    }

    console.log(`[executor] ${network}: checking pair ${base}/${quote} for matches`)
    try {
      const done = await tryMatchPairOnce(base, quote, bids, asks, network)
      if (done) {
        matchesThisCycle++
        console.log(`[executor] ${network}: successfully matched pair ${base}/${quote} (${matchesThisCycle}/${maxMatchesPerCycle})`)
        if (matchesThisCycle >= maxMatchesPerCycle) {
          console.log(`[executor] ${network}: reached max matches per cycle (${maxMatchesPerCycle}), stopping`)
          break
        }
      } else {
        console.log(`[executor] ${network}: no matches found for pair ${base}/${quote}`)
      }
    } catch (e) {
      console.error(`[executor] ${network}: match error for ${base}/${quote}:`, e?.message || e)
    }
  }

  return matchesThisCycle
}

async function runSolana() {
  if (!EXECUTOR_ENABLED) {
    console.log(`[executor] solana: executor disabled`)
    return
  }
  if (!supabase) {
    console.log(`[executor] solana: supabase not available`)
    return
  }

  console.log(`[executor] solana: starting execution cycle`)

  try {
    // Fetch open orders for Solana
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('network', 'solana')
      .eq('status', 'open')
      .gt('remaining', '0')
      .order('updated_at', { ascending: true })
      .limit(500)
    if (error) throw error
    console.log(`[executor] solana: fetched ${data.length} orders`)

    if (data.length > 0) {
      await processOrdersSolana(data)
    }

  } catch (e) {
    console.error(`[executor] solana: execution cycle failed:`, e?.message || e)
  }
}

async function processOrdersSolana(rows) {
  const byPair = new Map()
  for (const r of rows) {
    const base = (r.base || '').toLowerCase()
    const quote = (r.quote || '').toLowerCase()
    if (!base || !quote) {
      console.log(`[executor] solana: skipping order with missing base/quote:`, r.order_id)
      continue
    }
    const key = `${base}|${quote}`
    if (!byPair.has(key)) byPair.set(key, { base, quote, bids: [], asks: [] })
    const grp = byPair.get(key)
    const side = classifyRowSide(base, quote, r)
    if (side === 'ask') grp.asks.push(r)
    else if (side === 'bid') grp.bids.push(r)
    else {
      console.log(`[executor] solana: order ${r.order_id} has invalid side for pair ${base}/${quote}`)
    }
  }

  console.log(`[executor] solana: organized into ${byPair.size} trading pairs`)

  for (const [pairKey, { base, quote, bids, asks }] of byPair.entries()) {
    console.log(`[executor] solana: pair ${pairKey} - bids: ${bids.length}, asks: ${asks.length}`)

    if (!bids.length || !asks.length) {
      console.log(`[executor] solana: skipping pair ${pairKey} - missing bids or asks`)
      continue
    }

    console.log(`[executor] solana: checking pair ${base}/${quote} for matches`)
    try {
      const done = await tryMatchPairSolana(base, quote, bids, asks)
      if (done) {
        console.log(`[executor] solana: successfully matched pair ${base}/${quote}`)
        return // one match per cycle
      } else {
        console.log(`[executor] solana: no matches found for pair ${base}/${quote}`)
      }
    } catch (e) {
      console.error(`[executor] solana: match error for ${base}/${quote}:`, e?.message || e)
    }
  }
}

async function tryMatchPairSolana(base, quote, bids, asks) {
  console.log(`[executor] solana: sorting ${bids.length} bids and ${asks.length} asks for ${base}/${quote}`)

  bids.sort((a, b) => {
    const pb = priceBid(b)
    const pa = priceBid(a)
    if (pb === null && pa === null) return 0
    if (pb === null) return 1
    if (pa === null) return -1
    if (pb !== pa) return Number(pb - pa)
    return new Date(a.created_at || a.updated_at) - new Date(b.created_at || b.updated_at)
  })
  asks.sort((a, b) => {
    const pa = priceAsk(a)
    const pb = priceAsk(b)
    if (pa === null && pb === null) return 0
    if (pa === null) return 1
    if (pb === null) return -1
    if (pa !== pb) return Number(pa - pb)
    return new Date(a.created_at || a.updated_at) - new Date(b.created_at || b.updated_at)
  })

  const bestBid = bids[0]
  const bestAsk = asks[0]

  if (!bestBid || !bestAsk) {
    console.log(`[executor] solana: no best bid or ask available for ${base}/${quote}`)
    return false
  }

  if (bestBid.maker === bestAsk.maker) {
    console.log(`[executor] solana: skipping ${base}/${quote} - same maker (${bestBid.maker})`)
    return false
  }

  const pBid = priceBid(bestBid)
  const pAsk = priceAsk(bestAsk)

  console.log(`[executor] solana: best bid price: ${pBid ? Number(pBid) / 1e18 : 'null'}, best ask price: ${pAsk ? Number(pAsk) / 1e18 : 'null'}`)

  if (pBid === null || pAsk === null) {
    console.log(`[executor] solana: null prices detected for ${base}/${quote}`)
    return false
  }

  if (!(pBid >= pAsk)) {
    console.log(`[executor] solana: prices not crossing for ${base}/${quote} - bid: ${Number(pBid) / 1e18}, ask: ${Number(pAsk) / 1e18}`)
    return false
  }

  console.log(`[executor] solana: ✅ MATCHING bid (${bestBid?.order_id}) with ask (${bestAsk?.order_id}) for ${base}/${quote}`)

  const buyRow = bestBid
  const sellRow = bestAsk
  const buy = normalizeOrderJson(buyRow.order_json || buyRow.order || {})
  const sell = normalizeOrderJson(sellRow.order_json || sellRow.order || {})

  // Remaining amounts
  let buyRemQuote = toBN(buyRow.remaining || buy.amountIn)
  let sellRemBase = toBN(sellRow.remaining || sell.amountIn)

  if (buyRemQuote <= 0n || sellRemBase <= 0n) {
    console.log(`[executor] solana: skipping ${base}/${quote} - insufficient remaining amounts`)
    return false
  }

  // Cap amounts
  let baseOut = minOut(buyRemQuote, buy.amountIn, buy.amountOutMin)
  if (baseOut > sellRemBase) baseOut = sellRemBase
  if (baseOut <= 0n) return false

  let quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
  if (quoteNeededBySell > buyRemQuote) {
    baseOut = (buyRemQuote * sell.amountIn) / sell.amountOutMin
    if (baseOut <= 0n) return false
    quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
    if (quoteNeededBySell > buyRemQuote) return false
  }

  const buyerMinBaseForQuoteIn = minOut(quoteNeededBySell, buy.amountIn, buy.amountOutMin)
  // Ensure buyer receives at least their minimum base for the quote being spent.
  // If buyer's minimum exceeds baseOut, we cannot satisfy constraints at this size.
  if (buyerMinBaseForQuoteIn > baseOut) {
    // Try to reduce the quote to match the chosen baseOut and re-validate.
    quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
    const buyerMinForAdjustedQuote = minOut(quoteNeededBySell, buy.amountIn, buy.amountOutMin)
    if (buyerMinForAdjustedQuote > baseOut) return false
  }

  const quoteIn = quoteNeededBySell

  // Use Jupiter to get quote and check if it meets the requirements
  try {
    const jupiterQuote = await getJupiterQuote(quote, base, quoteIn.toString())
    const expectedOut = BigInt(jupiterQuote.outAmount)
    if (expectedOut < baseOut) {
      console.log(`[executor] solana: Jupiter quote does not meet required base out: ${expectedOut} < ${baseOut}`)
      return false
    }
    console.log(`[executor] solana: Jupiter quote ok, expected base out: ${expectedOut}`)
  } catch (e) {
    console.log(`[executor] solana: Jupiter quote failed:`, e?.message || e)
    return false
  }

  // Reserve both orders to avoid duplicate off-chain fills
  let lockedBuy = await reserveOrder(buyRow.order_id, 'solana')
  if (!lockedBuy) { console.log('[executor] solana: failed to reserve buy order', buyRow.order_id); return false }
  let lockedSell = await reserveOrder(sellRow.order_id, 'solana')
  if (!lockedSell) { console.log('[executor] solana: failed to reserve sell order', sellRow.order_id); await releaseOrder(buyRow.order_id, 'solana', 'open'); return false }

  // For now, since no actual execution, mark as filled
  const newBuyRem = buyRemQuote - quoteIn
  const newSellRem = sellRemBase - baseOut
  await updateOrderRemaining(buyRow.order_id, newBuyRem, newBuyRem === 0n ? 'filled' : 'open', 'solana')
  await updateOrderRemaining(sellRow.order_id, newSellRem, newSellRem === 0n ? 'filled' : 'open', 'solana')

  // Record trade
  const baseAddr = (buyRow.base_address || sellRow.base_address || '').toLowerCase()
  const quoteAddr = (buyRow.quote_address || sellRow.quote_address || '').toLowerCase()
  const pair = baseAddr && quoteAddr ? `${baseAddr}/${quoteAddr}` : 'unknown'

  let baseDec = 9 // Solana default
  let quoteDec = 9

  const qFloat = Number(quoteIn)
  const bFloat = Number(baseOut)
  const priceHuman = (qFloat / Math.pow(10, quoteDec)) / (bFloat / Math.pow(10, baseDec))

  try {
    await supabase.from('trades').insert({
      network: 'solana',
      pair: pair,
      base_address: baseAddr,
      quote_address: quoteAddr,
      amount_base: baseOut.toString(),
      amount_quote: quoteIn.toString(),
      price: priceHuman,
      tx_hash: 'placeholder-jupiter-swap',
      block_number: 0,
      created_at: new Date().toISOString()
    })
  } catch (e) {
    console.warn('[executor] solana: failed to insert trade:', e?.message || e)
  }

  return true
}

async function runOnce(network = 'bsc') {
  if (network === 'solana') {
    await runSolana()
    return
  }

  if (!EXECUTOR_ENABLED) {
    console.log(`[executor] ${network}: executor disabled`)
    return
  }
  if (!supabase) {
    console.log(`[executor] ${network}: supabase not available`)
    return
  }
  if (network === 'bsc' && !settlement) {
    console.log(`[executor] ${network}: BSC settlement contract not available`)
    return
  }
  if (network === 'base' && !settlementBase) {
    console.log(`[executor] ${network}: Base settlement contract not available`)
    return
  }

  const busyFlag = network === 'base' ? busyBase : busyBSC
  if (busyFlag) {
    console.log(`[executor] ${network}: executor busy, skipping`)
    return
  }

  console.log(`[executor] ${network}: starting execution cycle`)
  if (network === 'base') {
    busyBase = true
  } else {
    busyBSC = true
  }

  try {
    // First check conditional orders (using current market prices)
    console.log(`[executor] ${network}: checking conditional orders...`)
    const triggeredOrderIds = await checkAndTriggerConditionalOrders(network)

    // Then fetch and process ALL open orders (including newly triggered ones)
    console.log(`[executor] ${network}: fetching open orders...`)
    const allRows = await fetchOpenOrdersAll(network)
    console.log(`[executor] ${network}: fetched ${allRows.length} total orders`)

    if (allRows.length > 0) {
      console.log(`[executor] ${network}: processing all open orders...`)
      await processOrders(allRows, network)
    } else {
      console.log(`[executor] ${network}: no open orders found`)
    }

    // Update prices for liquidity orders
    await updateLiquidityOrderPrices(network)

    console.log(`[executor] ${network}: execution cycle completed`)

  } catch (e) {
    console.error(`[executor] ${network}: execution cycle failed:`, e?.message || e)
  } finally {
    if (network === 'base') {
      busyBase = false
    } else {
      busyBSC = false
    }
  }
}

;(async () => {
  const ok = await init()
  if (!ok) return

  // Run immediately on startup
  console.log('[executor] starting initial execution cycle...')
  runOnce('bsc').catch((e) => console.error('[executor] initial BSC run failed:', e))
  runOnce('base').catch((e) => console.error('[executor] initial Base run failed:', e))
  runOnce('solana').catch((e) => console.error('[executor] initial Solana run failed:', e))
  runCrossChain().catch((e) => console.error('[executor] initial cross-chain run failed:', e))

  // Then run on interval
  setInterval(() => {
    console.log('[executor] running scheduled execution cycle...')
    runOnce('bsc').catch((e) => console.error('[executor] scheduled BSC run failed:', e))
    runOnce('base').catch((e) => console.error('[executor] scheduled Base run failed:', e))
    runOnce('solana').catch((e) => console.error('[executor] scheduled Solana run failed:', e))
    runCrossChain().catch((e) => console.error('[executor] scheduled cross-chain run failed:', e))
  }, EXECUTOR_INTERVAL_MS)
})()






































