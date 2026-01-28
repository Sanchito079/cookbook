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
const CUSTODIAL_ADDRESS = '0x6E11b5c17258C3F3ea684881Da4bB591C4C7bE05'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE

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
  { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' }
]

// Cache for token decimals
const decimalsCache = new Map()

// Function to fetch decimals from contract
async function fetchTokenDecimals(tokenAddr, network = 'bsc') {
  if (!tokenAddr) return 18
  const addr = tokenAddr.toString().toLowerCase()
  const cacheKey = `${network}:${addr}`

  // Check cache
  if (decimalsCache.has(cacheKey)) {
    return decimalsCache.get(cacheKey)
  }

  try {
    const provider = network === 'base' ? providerBase : providerBSC
    if (!provider) return 18

    const contract = new Contract(addr, [
      { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' }
    ], provider)

    const decimals = await contract.decimals()
    const decimalsNum = Number(decimals)

    // Cache result
    decimalsCache.set(cacheKey, decimalsNum)
    console.log(`[executor] Fetched decimals for ${addr} on ${network}: ${decimalsNum}`)
    return decimalsNum
  } catch (error) {
    console.warn(`[executor] Failed to fetch decimals for ${addr} on ${network}:`, error.message)
    // Fallback to DB or hardcoded
    try {
      if (supabase) {
        const { data } = await supabase
          .from('tokens')
          .select('decimals')
          .eq('address', addr)
          .eq('network', network)
          .single()
        if (data?.decimals) {
          decimalsCache.set(cacheKey, data.decimals)
          return data.decimals
        }
      }
    } catch {}

    // Hardcoded fallbacks
    if (addr === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') return 18 // WBNB
    if (addr === '0x55d398326f99059ff775485246999027b3197955') return 18 // USDT BSC
    if (addr === '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d') return 18 // USDC BSC
    if (addr === '0x4200000000000000000000000000000000000006') return 18 // WETH Base
    if (addr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') return 6 // USDC Base

    return 18 // Default
  }
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
  if (buyerMinBaseForQuoteIn < baseOut) {
    baseOut = buyerMinBaseForQuoteIn
    if (baseOut <= 0n) return false
    quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
    if (quoteNeededBySell > buyRemQuote) {
      baseOut = (buyRemQuote * sell.amountIn) / sell.amountOutMin // floor
      if (baseOut <= 0n) return false
      quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
      if (quoteNeededBySell > buyRemQuote) return false
    }
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
  if (baseOut > sellRemBase) baseOut = sellRemBase
  if (baseOut > baseFromSellAvail) baseOut = baseFromSellAvail
  if (baseOut > baseFromBuyAvail) baseOut = baseFromBuyAvail
  if (baseOut <= 0n) return false

  // Seller requires at least this much quote for that base, use ceil to avoid underpayment
  let quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)

  // If buyer can't cover, reduce baseOut using seller ratio inverted (floor), then recompute ceil quote
  if (quoteNeededBySell > buyRemQuote) {
    baseOut = (buyRemQuote * sell.amountIn) / sell.amountOutMin // floor
    if (baseOut <= 0n) return false
    if (baseOut > sellRemBase) baseOut = sellRemBase
    if (baseOut > baseFromSellAvail) baseOut = baseFromSellAvail
    if (baseOut > baseFromBuyAvail) baseOut = baseFromBuyAvail
    if (baseOut <= 0n) return false
    quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
    if (quoteNeededBySell > buyRemQuote) return false
  }

  // Enforce buyer's min base for the chosen quote (floor)
  const buyerMinBaseForQuoteIn = minOut(quoteNeededBySell, buy.amountIn, buy.amountOutMin)
  if (buyerMinBaseForQuoteIn < baseOut) {
    baseOut = buyerMinBaseForQuoteIn
    if (baseOut <= 0n) return false
    quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
    if (quoteNeededBySell > buyRemQuote) {
      // Final shrink to satisfy seller given buyer budget
      baseOut = (buyRemQuote * sell.amountIn) / sell.amountOutMin // floor
      if (baseOut <= 0n) return false
      quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
      if (quoteNeededBySell > buyRemQuote) return false
    }
  }

  const quoteIn = quoteNeededBySell

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
  if (!lockedBuy) { console.log(`[executor] ${network}: failed to reserve buy order ${buyRow.order_id}`); return false }
  lockedSell = await reserveOrder(sellRow.order_id, network)
  if (!lockedSell) { console.log(`[executor] ${network}: failed to reserve sell order ${sellRow.order_id}`); await releaseOrder(buyRow.order_id, network, 'open'); return false }

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
  if (buyerMinBaseForQuoteIn < baseOut) {
    baseOut = buyerMinBaseForQuoteIn
    if (baseOut <= 0n) return false
    quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
    if (quoteNeededBySell > buyRemQuote) {
      baseOut = (buyRemQuote * sell.amountIn) / sell.amountOutMin
      if (baseOut <= 0n) return false
      quoteNeededBySell = ceilDiv(baseOut * sell.amountOutMin, sell.amountIn)
      if (quoteNeededBySell > buyRemQuote) return false
    }
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
    // Check for new custodial deposits
    await checkCustodialDeposits(network)

    // Create orders from liquidity provisions
    await createOrdersFromProvisions(network)

    // Update prices for existing custodial orders
    await updateCustodialOrderPrices(network)

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

    // Attribute fills to provisions
    await attributeFillsToProvisions(network)

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

// =============================
// LIQUIDITY PROVISION FUNCTIONS
// =============================

async function checkCustodialDeposits(network = 'bsc') {
  if (!supabase) return

  console.log(`[executor] ${network}: checking custodial deposits...`)

  try {
    // Get custodial address
    const custodialAddr = CUSTODIAL_ADDRESS.toLowerCase()

    // Get provider for network
    const provider = network === 'base' ? providerBase : providerBSC
    if (!provider) return

    // Get all tokens that have provisions in the database for this network
    // Include both claimed provisions AND pending_claim provisions to detect new deposits
    const { data: existingProvisions } = await supabase
      .from('liquidity_provisions')
      .select('token_address')
      .eq('network', network)

    // Get unique token addresses from existing provisions (already filtered by network)
    const tokensFromDb = [...new Set(existingProvisions?.map(p => p.token_address) || [])]

    // Also include known tokens for backward compatibility
    const knownTokens = [
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
      '0x55d398326f99059ff775485246999027b3197955', // USDT
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
      '0x4200000000000000000000000000000006' // WETH (base)
    ].filter(addr => {
      // Filter by network - only include tokens that belong to this network
      if (network === 'bsc' && addr === '0x4200000000000000000000000000000006') return false
      if (network === 'base' && addr !== '0x4200000000000000000000000000000000006' && addr !== '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') return false
      return true
    })

    // Combine both lists - both are already network-specific
    const tokensToCheck = [...new Set([...tokensFromDb, ...knownTokens])]

    for (const tokenAddr of tokensToCheck) {
      // Get current balance
      const tokenContract = new Contract(tokenAddr, ERC20_MIN_ABI, provider)
      const balance = await tokenContract.balanceOf(custodialAddr).catch(() => 0n)
      const balanceStr = balance.toString()

      // Get sum of remaining amounts in provisions (including pending_claim to prevent duplicates)
      const { data: provisions } = await supabase
        .from('liquidity_provisions')
        .select('remaining_amount')
        .eq('network', network)
        .eq('token_address', tokenAddr)

      const totalRemaining = provisions?.reduce((sum, p) => sum + toBN(p.remaining_amount), 0n) || 0n

      if (toBN(balanceStr) > totalRemaining) {
        const excess = toBN(balanceStr) - totalRemaining
        console.log(`[executor] ${network}: detected deposit of ${excess.toString()} ${tokenAddr} to custodial`)

        // Check if provision already exists for this token/network (any depositor)
        const { data: existingProvision } = await supabase
          .from('liquidity_provisions')
          .select('id, pair_key, amount_deposited, remaining_amount')
          .eq('network', network)
          .eq('token_address', tokenAddr)
          .single()

        if (existingProvision) {
          // Update existing provision with detected deposit amount
          const newAmountDeposited = toBN(existingProvision.amount_deposited || '0') + excess
          const newRemaining = toBN(existingProvision.remaining_amount || '0') + excess
          const { error: updateError } = await supabase
            .from('liquidity_provisions')
            .update({
              amount_deposited: newAmountDeposited.toString(),
              remaining_amount: newRemaining.toString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', existingProvision.id)

          if (updateError) {
            console.warn(`[executor] ${network}: error updating provision:`, updateError.message)
          } else {
            console.log(`[executor] ${network}: updated provision ${existingProvision.id} with ${excess.toString()} ${tokenAddr}`)
          }
        } else {
          // Create pending provision without pair_key - user will provide it when claiming
          const { error: insertError } = await supabase.from('liquidity_provisions').insert({
            network,
            depositor: 'pending_claim',
            token_address: tokenAddr,
            amount_deposited: excess.toString(),
            min_price_per_token: '0', // Will be set on claim
            remaining_amount: excess.toString(),
            pair_key: null // Will be set on claim
          })

          if (insertError) {
            console.warn(`[executor] ${network}: error creating provision:`, insertError.message)
          } else {
            console.log(`[executor] ${network}: created pending provision for ${excess.toString()} ${tokenAddr}`)
          }
        }
      }
    }
  } catch (e) {
    console.warn(`[executor] ${network}: error checking custodial deposits:`, e?.message || e)
  }
}

async function createOrdersFromProvisions(network = 'bsc') {
  const wallet = network === 'base' ? walletBase : walletBSC
  if (!supabase || !wallet) return

  console.log(`[executor] ${network}: creating orders from liquidity provisions...`)

  try {
    // Get provisions with remaining amount (excluding pending_claim - only claimed provisions)
    const { data: provisions } = await supabase
      .from('liquidity_provisions')
      .select('*')
      .eq('network', network)
      .gt('remaining_amount', '0')
      .neq('depositor', 'pending_claim')

    if (!provisions || provisions.length === 0) {
      console.log(`[executor] ${network}: no provisions with remaining amount found`)
      return
    }

    console.log(`[executor] ${network}: found ${provisions.length} provisions to process`)

    // Get recent prices for pairs
    const pairPrices = new Map()
    for (const p of provisions) {
      // Skip provisions without pair_key (not yet claimed)
      if (!p.pair_key) {
        console.log(`[executor] ${network}: skipping provision ${p.id} - no pair_key set`)
        continue
      }

      if (pairPrices.has(p.pair_key)) continue

      const [base, quote] = p.pair_key.split('/')
      const { data: trades } = await supabase
        .from('trades')
        .select('price')
        .eq('network', network)
        .eq('base_address', base)
        .eq('quote_address', quote)
        .order('created_at', { ascending: false })
        .limit(10)

      if (trades && trades.length > 0) {
        const avgPrice = trades.reduce((sum, t) => sum + Number(t.price), 0) / trades.length
        pairPrices.set(p.pair_key, avgPrice)
      }
    }

    for (const provision of provisions) {
      // Skip provisions without pair_key (not yet claimed)
      if (!provision.pair_key) {
        console.log(`[executor] ${network}: skipping provision ${provision.id} - no pair_key set`)
        continue
      }

      // Skip provisions that are still pending_claim (not yet claimed by user)
      if (provision.depositor === 'pending_claim') {
        console.log(`[executor] ${network}: skipping provision ${provision.id} - still pending_claim`)
        continue
      }

      const tokenAddr = provision.token_address
      const remaining = toBN(provision.remaining_amount)
      const minPrice = toBN(provision.min_price_per_token)

      console.log(`[executor] ${network}: processing provision ${provision.id}, token=${tokenAddr}, remaining=${remaining.toString()}, minPrice=${minPrice.toString()}`)

      // Check if orders already exist for this provision to prevent duplicates
      const { data: existingOrders } = await supabase
        .from('orders')
        .select('order_id')
        .eq('liquidity_provision_id', provision.id)
        .eq('status', 'open')
        .limit(1)

      if (existingOrders && existingOrders.length > 0) {
        console.log(`[executor] ${network}: skipping provision ${provision.id} - orders already exist`)
        continue
      }

      // Use pair_key to determine quote token
      const [baseAddr, quoteAddr] = provision.pair_key.split('/')
      if (baseAddr.toLowerCase() !== tokenAddr.toLowerCase()) {
        console.log(`[executor] ${network}: provision pair_key mismatch for ${provision.id}`)
        continue
      }

      // Get current market price
      let currentPrice = pairPrices.get(provision.pair_key) || 0

      // For pending_claim provisions with no price data, use a default price of 1 for stablecoins
      if (currentPrice === 0 && provision.depositor === 'pending_claim') {
        // Check if this is a stablecoin pair (USDT or USDC as quote)
        const stablecoinQuotes = ['0x55d398326f99059ff775485246999027b3197955', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913']
        if (stablecoinQuotes.includes(quoteAddr.toLowerCase())) {
          currentPrice = 1 // Default to 1:1 for stablecoin pairs
          console.log(`[executor] ${network}: using default price of 1 for stablecoin pair ${provision.pair_key}`)
        }
      }

      // Skip if no price data and not a stablecoin pair
      if (currentPrice <= Number(minPrice)) {
        console.log(`[executor] ${network}: skipping provision ${provision.id} - price ${currentPrice} <= min ${minPrice}`)
        continue
      }

      // Get decimals
      const inDecimals = await fetchTokenDecimals(tokenAddr, network)
      const outDecimals = await fetchTokenDecimals(quoteAddr, network)

      // Calculate amount to sell (up to remaining, but reasonable chunk)
      const amountIn = remaining > 10n ** BigInt(inDecimals) ? 10n ** BigInt(inDecimals) : remaining
      const amountOutMin = (amountIn * toBN(Math.floor(currentPrice * 10 ** (outDecimals + 18)).toString())) / (10n ** BigInt(inDecimals + 18))

      // Create order
      const order = {
        maker: CUSTODIAL_ADDRESS,
        tokenIn: tokenAddr,
        tokenOut: quoteAddr,
        amountIn: amountIn.toString(),
        amountOutMin: amountOutMin.toString(),
        expiration: (Math.floor(Date.now() / 1000) + 86400 * 7).toString(), // 7 days
        nonce: Date.now().toString(),
        receiver: '0x0000000000000000000000000000000000000000',
        salt: Math.floor(Math.random() * 1000000).toString()
      }

      // Sign order
      const signature = await signOrder(order, wallet, network)

      // Insert order
      const orderId = crypto.randomUUID()
      const orderHash = crypto.createHash('sha1').update(JSON.stringify({
        network,
        maker: order.maker.toLowerCase(),
        nonce: order.nonce,
        tokenIn: order.tokenIn.toLowerCase(),
        tokenOut: order.tokenOut.toLowerCase(),
        salt: order.salt
      })).digest('hex')

      console.log(`[executor] ${network}: inserting order ${orderId} for provision ${provision.id}, amountIn=${order.amountIn}, amountOutMin=${order.amountOutMin}`)

      const { error: insertError } = await supabase.from('orders').insert({
        network,
        order_id: orderId,
        order_hash: orderHash,
        maker: order.maker,
        token_in: order.tokenIn,
        token_out: order.tokenOut,
        amount_in: order.amountIn,
        amount_out_min: order.amountOutMin,
        remaining: order.amountIn,
        price: currentPrice.toString(),
        side: 'ask',
        base: tokenAddr,
        quote: quoteAddr,
        base_address: tokenAddr,
        quote_address: quoteAddr,
        pair: `${tokenAddr}/${quoteAddr}`,
        nonce: order.nonce,
        receiver: order.receiver,
        salt: order.salt,
        signature,
        order_json: order,
        expiration: new Date(Number(order.expiration) * 1000).toISOString(),
        status: 'open',
        source: 'custodial',
        liquidity_provision_id: provision.id,
        owner_min_price: provision.min_price_per_token,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

      if (insertError) {
        console.warn(`[executor] ${network}: error inserting order ${orderId}:`, insertError.message)
      } else {
        console.log(`[executor] ${network}: created custodial order ${orderId} for provision ${provision.id}`)
      }
    }
  } catch (e) {
    console.warn(`[executor] ${network}: error creating orders from provisions:`, e?.message || e)
  }
}

async function signOrder(order, wallet, network) {
  const settlementContract = network === 'base' ? settlementBase : settlement
  if (!settlementContract) throw new Error('Settlement contract not available')

  // Get domain separator from contract
  const domainSeparator = await settlementContract.DOMAIN_SEPARATOR().catch(() => null)
  const orderTypehash = await settlementContract.ORDER_TYPEHASH().catch(() => null)

  if (!domainSeparator || !orderTypehash) {
    throw new Error('Could not get domain/order typehash from contract')
  }

  // Use contract's domain for signing
  const domain = {
    name: 'OrderBook',
    version: '1',
    chainId: network === 'base' ? 8453 : 56,
    verifyingContract: network === 'base' ? SETTLEMENT_ADDRESS_BASE : SETTLEMENT_ADDRESS_BSC
  }

  const types = {
    Order: [
      { name: 'maker', type: 'address' },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'expiration', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'salt', type: 'uint256' }
    ]
  }

  const signature = await wallet.signTypedData(domain, types, order)
  return signature
}

async function updateCustodialOrderPrices(network = 'bsc') {
  if (!supabase) return

  console.log(`[executor] ${network}: updating custodial order prices...`)

  try {
    // Get custodial orders
    const { data: orders } = await supabase
      .from('orders')
      .select('*, liquidity_provisions!inner(min_price_per_token)')
      .eq('network', network)
      .eq('source', 'custodial')
      .eq('status', 'open')

    if (!orders || orders.length === 0) return

    // Group by pair
    const pairs = new Map()
    for (const order of orders) {
      const pair = `${order.token_in}/${order.token_out}`.toLowerCase()
      if (!pairs.has(pair)) pairs.set(pair, [])
      pairs.get(pair).push(order)
    }

    // Get latest prices
    for (const [pair, pairOrders] of pairs.entries()) {
      const [base, quote] = pair.split('/')
      const { data: trades } = await supabase
        .from('trades')
        .select('price')
        .eq('network', network)
        .eq('base_address', base)
        .eq('quote_address', quote)
        .order('created_at', { ascending: false })
        .limit(20)

      if (!trades || trades.length === 0) continue

      const latestPrice = Number(trades[0].price)
      const avgPrice = trades.reduce((sum, t) => sum + Number(t.price), 0) / trades.length

      // Use weighted average towards recent
      const newPrice = (latestPrice * 0.7) + (avgPrice * 0.3)

      for (const order of pairOrders) {
        const minPrice = Number(order.liquidity_provisions.min_price_per_token)
        if (newPrice <= minPrice) continue

        // Cancel old order
        await supabase
          .from('orders')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('order_id', order.order_id)

        // Create new order with updated price
        const inDecimals = await fetchTokenDecimals(order.token_in, network)
        const outDecimals = await fetchTokenDecimals(order.token_out, network)
        const amountIn = toBN(order.amount_in)
        const newAmountOutMin = (amountIn * toBN(Math.floor(newPrice * 10 ** (outDecimals + 18)).toString())) / (10n ** BigInt(inDecimals + 18))

        const newOrder = { ...order.order_json }
        newOrder.amountOutMin = newAmountOutMin.toString()
        newOrder.nonce = (Number(order.nonce) + 1).toString()

        const wallet = network === 'base' ? walletBase : walletBSC
        const signature = await signOrder(newOrder, wallet, network)

        const orderId = crypto.randomUUID()
        const orderHash = crypto.createHash('sha1').update(JSON.stringify({
          network,
          maker: newOrder.maker.toLowerCase(),
          nonce: newOrder.nonce,
          tokenIn: newOrder.tokenIn.toLowerCase(),
          tokenOut: newOrder.tokenOut.toLowerCase(),
          salt: newOrder.salt
        })).digest('hex')

        await supabase.from('orders').insert({
          ...order,
          order_id: orderId,
          order_hash: orderHash,
          amount_out_min: newAmountOutMin.toString(),
          price: newPrice.toString(),
          nonce: newOrder.nonce,
          signature,
          order_json: newOrder,
          updated_at: new Date().toISOString()
        })

        console.log(`[executor] ${network}: updated price for custodial order ${orderId} from ${order.price} to ${newPrice}`)
      }
    }
  } catch (e) {
    console.warn(`[executor] ${network}: error updating custodial prices:`, e?.message || e)
  }
}

async function attributeFillsToProvisions(network = 'bsc') {
  if (!supabase) return

  console.log(`[executor] ${network}: attributing fills to provisions...`)

  try {
    // Get recent fills for custodial orders
    const { data: fills } = await supabase
      .from('fills')
      .select('*, orders!inner(liquidity_provision_id)')
      .eq('network', network)
      .gte('created_at', new Date(Date.now() - 60000).toISOString()) // Last minute

    if (!fills || fills.length === 0) return

    for (const fill of fills) {
      const provisionId = fill.orders.liquidity_provision_id
      if (!provisionId) continue

      const filledAmount = toBN(fill.amount_base)
      const proceeds = toBN(fill.amount_quote)

      // Update provision
      const { data: provision } = await supabase
        .from('liquidity_provisions')
        .select('remaining_amount, proceeds_earned, proceeds_token')
        .eq('id', provisionId)
        .single()

      if (provision) {
        const newRemaining = toBN(provision.remaining_amount) - filledAmount
        const newProceeds = toBN(provision.proceeds_earned) + proceeds

        await supabase
          .from('liquidity_provisions')
          .update({
            remaining_amount: newRemaining.toString(),
            proceeds_earned: newProceeds.toString(),
            proceeds_token: provision.proceeds_token || fill.orders.token_out,
            updated_at: new Date().toISOString()
          })
          .eq('id', provisionId)

        console.log(`[executor] ${network}: attributed fill ${filledAmount.toString()} to provision ${provisionId}`)
      }
    }
  } catch (e) {
    console.warn(`[executor] ${network}: error attributing fills:`, e?.message || e)
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







