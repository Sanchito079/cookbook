import { useEffect, useMemo, useState, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import { BrowserProvider, Contract, parseUnits, MaxUint256, JsonRpcProvider } from 'ethers'
import { DynamicWidget, useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { useThemeStyles } from './theme'
import toast, { Toaster } from 'react-hot-toast'
import { fetchTokenDecimals } from './helpers_decimals'
import { fetchTokenUsdPrice } from './helpers'
import MobileApp from './mobile/MobileApp'
import { useTranslation } from 'react-i18next'
import i18n from './i18n'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token'
import { Twitter } from 'lucide-react'
import { SiTelegram, SiDiscord } from 'react-icons/si'

// ==========================
// Config
// ==========================
const SETTLEMENT_ADDRESS = '0x7DBA6a1488356428C33cC9fB8Ef3c8462c8679d0'
const BASE_SETTLEMENT_ADDRESS = '0xBBf7A39F053BA2B8F4991282425ca61F2D871f45'

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


const ERC20_ABI = [
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' }
]

const TOKENS = [
  { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18, network: 'bsc' },
  { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 6, network: 'bsc' },
  { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18, network: 'bsc' },
  { symbol: 'CAKE', address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', decimals: 18, network: 'bsc' },
  // Base tokens
  { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18, network: 'base' },
  { symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, network: 'base' }
]

const BSC_CHAIN_ID = 56
const BSC_HEX = '0x38'
const BSC_PARAMS = {
  chainId: BSC_HEX,
  chainName: 'BNB Smart Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: ['https://bsc-dataseed.defibit.io/'],
  blockExplorerUrls: ['https://bscscan.com']
}

const BASE_CHAIN_ID = 8453
const BASE_HEX = '0x2105'
const BASE_PARAMS = {
  chainId: BASE_HEX,
  chainName: 'Base',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org'],
  blockExplorerUrls: ['https://basescan.org']
}

// Read-only providers for balance fetching
const BSC_PROVIDER = new JsonRpcProvider('https://bsc-dataseed.defibit.io/')
const BASE_PROVIDER = new JsonRpcProvider('https://mainnet.base.org')

// ==========================
// Helpers
// ==========================
const hasMetaMask = () => typeof window !== 'undefined' && typeof window.ethereum !== 'undefined'

// Real markets integration: WBNB canonical address (lowercase)
const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'.toLowerCase()
// Indexer base URL (override with VITE_INDEXER_BASE for prod)
const INDEXER_BASE = (import.meta?.env?.VITE_INDEXER_BASE) || 'https://cookbook-hjnhgq.fly.dev'

// Prefer a local, known-good WBNB logo regardless of DB data
const getTokenLogo = (token) => {
  try {
    const addr = (token?.address || '').toLowerCase()
    if (addr === WBNB_ADDRESS) {
      return 'https://coin-images.coingecko.com/coins/images/12591/large/binance-coin-logo.png?1696512401'
    }
    return token?.logoUrl || null
  } catch {
    return token?.logoUrl || null
  }
}

// Generate a placeholder logo with first letter of token symbol
const TokenLogo = ({ token, size = 18 }) => {
  const logoUrl = getTokenLogo(token);
  const [imageError, setImageError] = useState(false);

  if (logoUrl && !imageError) {
    return (
      <img
        src={logoUrl}
        alt={token.symbol}
        style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%' }}
        onError={() => setImageError(true)}
      />
    );
  }

  // Generate placeholder with first letter
  const firstLetter = (token?.symbol || '?')[0].toUpperCase();
  const colors = [
    '#4da3ff', '#00e39f', '#ff5c8a', '#ffa94d', '#9b59b6',
    '#3498db', '#e74c3c', '#f39c12', '#1abc9c', '#34495e'
  ];
  const colorIndex = (token?.symbol || '').charCodeAt(0) % colors.length;
  const bgColor = colors[colorIndex];

  return (
    <div style={{
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '50%',
      background: bgColor,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: `${size * 0.5}px`,
      fontWeight: '700',
      color: '#fff',
      flexShrink: 0
    }}>
      {firstLetter}
    </div>
  );
};


// ==========================
// SAL Order Modal Component
// ==========================
function SALOrderModal({ theme, selectedNetwork, account, onClose, onSuccess }) {
  const [step, setStep] = useState(1) // 1: Token Selection, 2: Price Settings, 3: Review
  const [baseToken, setBaseToken] = useState('')
  const [quoteToken, setQuoteToken] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [initialPrice, setInitialPrice] = useState('')
  const [curveType, setCurveType] = useState('linear')
  const [maxPrice, setMaxPrice] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [expiration, setExpiration] = useState(30) // days
  const [loading, setLoading] = useState(false)
  const [tokenValidation, setTokenValidation] = useState(null)
  const [isValidatingToken, setIsValidatingToken] = useState(false)

  // Validate token address
  const validateTokenAddress = async (address, network) => {
    if (!address || address.length < 20) {
      setTokenValidation(null)
      return
    }

    setIsValidatingToken(true)
    try {
      const response = await fetch(`${INDEXER_BASE}/api/tokens/validate?address=${address}&network=${network}`)
      if (!response.ok) throw new Error('Validation failed')

      const data = await response.json()
      setTokenValidation(data)
    } catch (error) {
      console.error('Token validation error:', error)
      setTokenValidation({ error: error.message })
    } finally {
      setIsValidatingToken(false)
    }
  }

  // Reset modal state
  const resetModal = () => {
    setStep(1)
    setBaseToken('')
    setQuoteToken('')
    setTotalAmount('')
    setInitialPrice('')
    setCurveType('linear')
    setMaxPrice('')
    setMinPrice('')
    setExpiration(30)
    setTokenValidation(null)
    setIsValidatingToken(false)
  }

  // Available quote tokens based on network
  const getQuoteTokens = () => {
    if (selectedNetwork === 'bsc') {
      return [
        { symbol: 'WBNB', address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', logoUrl: 'https://coin-images.coingecko.com/coins/images/12591/large/binance-coin-logo.png?1696512401' },
        { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', logoUrl: 'https://assets.trustwalletapp.com/blockchains/smartchain/assets/0x55d398326f99059fF775485246999027B3197955/logo.png' }
      ]
    } else if (selectedNetwork === 'base') {
      return [
        { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', logoUrl: 'https://assets.trustwalletapp.com/blockchains/base/assets/0x4200000000000000000000000000000000000006/logo.png' },
        { symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', logoUrl: 'https://assets.trustwalletapp.com/blockchains/base/assets/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/logo.png' }
      ]
    }
    return []
  }

  const quoteTokens = getQuoteTokens()

  const handleCreateSALOrder = async () => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    setLoading(true)
    try {
      const payload = {
        network: selectedNetwork,
        maker: account,
        tokenIn: baseToken,
        tokenOut: quoteToken,
        totalAmount: totalAmount.toString(),
        initialPrice: initialPrice.toString(),
        curveType,
        maxPrice: maxPrice || undefined,
        minPrice: minPrice || undefined,
        expiration: Math.floor(Date.now() / 1000) + (expiration * 24 * 60 * 60), // Convert days to seconds
        salt: Date.now().toString()
      }

      const response = await fetch(`${INDEXER_BASE}/api/sal-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create SAL order')
      }

      const result = await response.json()
      console.log('SAL Order created:', result)

      onSuccess()
    } catch (error) {
      console.error('Error creating SAL order:', error)
      toast.error(`Failed to create SAL order: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const modalStyles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999
    },
    modal: {
      background: theme === 'dark' ? 'rgba(42, 52, 65, 0.95)' : 'rgba(255, 255, 255, 0.95)',
      borderRadius: 12,
      padding: 24,
      maxWidth: 500,
      width: '90%',
      maxHeight: '90vh',
      overflow: 'auto',
      border: '1px solid rgba(255,255,255,0.2)',
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 24
    },
    title: {
      fontSize: 20,
      fontWeight: 700,
      color: theme === 'dark' ? '#fff' : '#000'
    },
    closeButton: {
      background: 'none',
      border: 'none',
      fontSize: 24,
      cursor: 'pointer',
      color: '#8fb3c9'
    },
    stepIndicator: {
      display: 'flex',
      justifyContent: 'center',
      marginBottom: 24
    },
    step: {
      width: 40,
      height: 40,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 14,
      fontWeight: 600,
      margin: '0 8px'
    },
    activeStep: {
      background: 'linear-gradient(135deg, #4da3ff, #00e39f)',
      color: '#fff'
    },
    inactiveStep: {
      background: 'rgba(255,255,255,0.1)',
      color: '#8fb3c9'
    },
    formGroup: {
      marginBottom: 16
    },
    label: {
      display: 'block',
      fontSize: 14,
      fontWeight: 600,
      color: theme === 'dark' ? '#fff' : '#000',
      marginBottom: 8
    },
    input: {
      width: '100%',
      padding: 12,
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.2)',
      background: theme === 'dark' ? '#0f172a' : '#f8fafc',
      color: theme === 'dark' ? '#fff' : '#000',
      fontSize: 14
    },
    select: {
      width: '100%',
      padding: 12,
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.2)',
      background: theme === 'dark' ? '#0f172a' : '#f8fafc',
      color: theme === 'dark' ? '#fff' : '#000',
      fontSize: 14
    },
    tokenGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
      marginBottom: 16
    },
    tokenOption: {
      padding: 16,
      borderRadius: 8,
      border: '2px solid rgba(255,255,255,0.1)',
      background: 'rgba(255,255,255,0.05)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      transition: 'all 0.2s'
    },
    selectedToken: {
      border: '2px solid #4da3ff',
      background: 'rgba(77, 163, 255, 0.1)'
    },
    tokenLogo: {
      width: 32,
      height: 32,
      borderRadius: '50%'
    },
    tokenInfo: {
      flex: 1
    },
    tokenSymbol: {
      fontSize: 16,
      fontWeight: 600,
      color: theme === 'dark' ? '#fff' : '#000'
    },
    tokenName: {
      fontSize: 12,
      color: '#8fb3c9'
    },
    buttonGroup: {
      display: 'flex',
      gap: 12,
      marginTop: 24
    },
    button: {
      flex: 1,
      padding: 12,
      borderRadius: 8,
      border: 'none',
      fontSize: 14,
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    primaryButton: {
      background: 'linear-gradient(135deg, #4da3ff, #00e39f)',
      color: '#fff'
    },
    secondaryButton: {
      background: 'rgba(255,255,255,0.1)',
      color: theme === 'dark' ? '#fff' : '#000'
    },
    disabledButton: {
      opacity: 0.5,
      cursor: 'not-allowed'
    },
    curvePreview: {
      marginTop: 16,
      padding: 16,
      background: 'rgba(255,255,255,0.05)',
      borderRadius: 8,
      fontSize: 12,
      color: '#8fb3c9'
    }
  }

  const renderStep1 = () => (
    <div>
      <div style={modalStyles.formGroup}>
        <label style={modalStyles.label}>Select Your Token (What you want to sell)</label>
        <input
          type="text"
          placeholder="Enter token address (0x...)"
          value={baseToken}
          onChange={(e) => {
            setBaseToken(e.target.value)
            validateTokenAddress(e.target.value, selectedNetwork)
          }}
          style={modalStyles.input}
        />
        <div style={{ fontSize: 12, color: '#8fb3c9', marginTop: 4 }}>
          Enter the contract address of your token
        </div>

        {/* Token Validation Feedback */}
        {isValidatingToken && (
          <div style={{ fontSize: 12, color: '#4da3ff', marginTop: 8 }}>
            🔍 Checking token...
          </div>
        )}

        {tokenValidation && !tokenValidation.error && (
          <div style={{
            fontSize: 12,
            color: tokenValidation.existingMarkets.length > 0 ? '#00e39f' : '#4da3ff',
            marginTop: 8,
            padding: 8,
            background: 'rgba(0, 227, 159, 0.1)',
            borderRadius: 4,
            border: '1px solid rgba(0, 227, 159, 0.3)'
          }}>
            {tokenValidation.existingMarkets.length > 0 ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>🎉 Token Found in Markets!</div>
                <div>{tokenValidation.message}</div>
                <div style={{ marginTop: 4, fontSize: 11 }}>
                  Markets: {tokenValidation.marketPairs.join(', ')}
                </div>
              </div>
            ) : tokenValidation.existsInTokens ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>✅ Token Found in Database</div>
                <div>{tokenValidation.message}</div>
              </div>
            ) : (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>🆕 New Token</div>
                <div>{tokenValidation.message}</div>
              </div>
            )}
          </div>
        )}

        {tokenValidation && tokenValidation.error && (
          <div style={{
            fontSize: 12,
            color: '#ff5c8a',
            marginTop: 8,
            padding: 8,
            background: 'rgba(255, 92, 138, 0.1)',
            borderRadius: 4,
            border: '1px solid rgba(255, 92, 138, 0.3)'
          }}>
            ❌ Validation Error: {tokenValidation.error}
          </div>
        )}
      </div>

      <div style={modalStyles.formGroup}>
        <label style={modalStyles.label}>Select Quote Token (What you'll receive)</label>
        <div style={modalStyles.tokenGrid}>
          {quoteTokens.map((token) => (
            <div
              key={token.address}
              style={{
                ...modalStyles.tokenOption,
                ...(quoteToken === token.address ? modalStyles.selectedToken : {})
              }}
              onClick={() => setQuoteToken(token.address)}
            >
              <img src={token.logoUrl} alt={token.symbol} style={modalStyles.tokenLogo} />
              <div style={modalStyles.tokenInfo}>
                <div style={modalStyles.tokenSymbol}>{token.symbol}</div>
                <div style={modalStyles.tokenName}>{token.symbol} on {selectedNetwork.toUpperCase()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div>
      <div style={modalStyles.formGroup}>
        <label style={modalStyles.label}>Total Amount to Sell</label>
        <input
          type="number"
          placeholder="1000000"
          value={totalAmount}
          onChange={(e) => setTotalAmount(e.target.value)}
          style={modalStyles.input}
        />
        <div style={{ fontSize: 12, color: '#8fb3c9', marginTop: 4 }}>
          Total tokens you'll provide for liquidity
        </div>
      </div>

      <div style={modalStyles.formGroup}>
        <label style={modalStyles.label}>Starting Price (per token)</label>
        <input
          type="number"
          step="0.000001"
          placeholder="0.10"
          value={initialPrice}
          onChange={(e) => setInitialPrice(e.target.value)}
          style={modalStyles.input}
        />
        <div style={{ fontSize: 12, color: '#8fb3c9', marginTop: 4 }}>
          Initial price buyers will see
        </div>
      </div>

      <div style={modalStyles.formGroup}>
        <label style={modalStyles.label}>Price Adjustment Curve</label>
        <select
          value={curveType}
          onChange={(e) => setCurveType(e.target.value)}
          style={modalStyles.select}
        >
          <option value="linear">Linear - Steady price increase</option>
          <option value="exponential">Exponential - Accelerating price increase</option>
          <option value="stepwise">Step-wise - Price jumps at thresholds</option>
        </select>
      </div>

      <div style={modalStyles.formGroup}>
        <label style={modalStyles.label}>Maximum Price (optional)</label>
        <input
          type="number"
          step="0.000001"
          placeholder="Leave empty for no limit"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          style={modalStyles.input}
        />
      </div>

      <div style={modalStyles.formGroup}>
        <label style={modalStyles.label}>Minimum Price (optional)</label>
        <input
          type="number"
          step="0.000001"
          placeholder="Leave empty for no limit"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          style={modalStyles.input}
        />
      </div>

      <div style={modalStyles.formGroup}>
        <label style={modalStyles.label}>Order Duration (days)</label>
        <input
          type="number"
          min="1"
          max="365"
          value={expiration}
          onChange={(e) => setExpiration(e.target.value)}
          style={modalStyles.input}
        />
      </div>

      <div style={modalStyles.curvePreview}>
        <strong>How {curveType} pricing works:</strong><br />
        {curveType === 'linear' && 'Price increases steadily as tokens are sold (predictable)'}
        {curveType === 'exponential' && 'Price increases slowly at first, then accelerates (prevents dumps)'}
        {curveType === 'stepwise' && 'Price stays constant, then jumps at 25%, 50%, 75% sold'}
      </div>
    </div>
  )

  const renderStep3 = () => (
    <div>
      <h3 style={{ color: theme === 'dark' ? '#fff' : '#000', marginBottom: 16 }}>Review Your SAL Order</h3>

      <div style={{ background: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#8fb3c9' }}>Token to Sell:</span>
          <span style={{ color: theme === 'dark' ? '#fff' : '#000' }}>{baseToken.slice(0, 6)}...{baseToken.slice(-4)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#8fb3c9' }}>Receive Token:</span>
          <span style={{ color: theme === 'dark' ? '#fff' : '#000' }}>{quoteTokens.find(t => t.address === quoteToken)?.symbol || 'Unknown'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#8fb3c9' }}>Total Amount:</span>
          <span style={{ color: theme === 'dark' ? '#fff' : '#000' }}>{totalAmount}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#8fb3c9' }}>Starting Price:</span>
          <span style={{ color: theme === 'dark' ? '#fff' : '#000' }}>{initialPrice}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#8fb3c9' }}>Price Curve:</span>
          <span style={{ color: theme === 'dark' ? '#fff' : '#000' }}>{curveType}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#8fb3c9' }}>Duration:</span>
          <span style={{ color: theme === 'dark' ? '#fff' : '#000' }}>{expiration} days</span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#8fb3c9', lineHeight: 1.5 }}>
        <strong>What happens next:</strong><br />
        • Your SAL order will be created and stored on-chain<br />
        • Price will automatically adjust as tokens are sold<br />
        • You can cancel the order anytime<br />
        • Earnings accumulate automatically
      </div>
    </div>
  )

  return createPortal(
    <div style={modalStyles.overlay} onClick={() => { resetModal(); onClose(); }}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>🚀 Create SAL Order</h2>
          <button style={modalStyles.closeButton} onClick={() => { resetModal(); onClose(); }}>×</button>
        </div>

        <div style={modalStyles.stepIndicator}>
          <div style={{ ...modalStyles.step, ...(step >= 1 ? modalStyles.activeStep : modalStyles.inactiveStep) }}>1</div>
          <div style={{ ...modalStyles.step, ...(step >= 2 ? modalStyles.activeStep : modalStyles.inactiveStep) }}>2</div>
          <div style={{ ...modalStyles.step, ...(step >= 3 ? modalStyles.activeStep : modalStyles.inactiveStep) }}>3</div>
        </div>

        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}

        <div style={modalStyles.buttonGroup}>
          {step > 1 && (
            <button
              style={{ ...modalStyles.button, ...modalStyles.secondaryButton }}
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          )}

          {step < 3 ? (
            <button
              style={{ ...modalStyles.button, ...modalStyles.primaryButton }}
              onClick={() => {
                if (step === 1 && (!baseToken || !quoteToken)) {
                  toast.error('Please select both tokens')
                  return
                }
                if (step === 2 && (!totalAmount || !initialPrice)) {
                  toast.error('Please fill in amount and price')
                  return
                }
                setStep(step + 1)
              }}
            >
              Next
            </button>
          ) : (
            <button
              style={{
                ...modalStyles.button,
                ...modalStyles.primaryButton,
                ...(loading ? modalStyles.disabledButton : {})
              }}
              onClick={handleCreateSALOrder}
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create SAL Order'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ==========================
// App
// ==========================
function App() {
  const { t } = useTranslation()

  // Mobile detection - must be at the top before any conditional returns
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 480
    }
    return false
  })

  const [view, setView] = useState('markets') // 'markets' | 'trade'
  
  const [filterType, setFilterType] = useState('all') // 'all' | 'trending' | 'hot' | 'new' | 'volume' | 'gainers' | 'losers'

  // Network selection state
  const [selectedNetwork, setSelectedNetwork] = useState(() => {
    try {
      const saved = localStorage.getItem('selectedNetwork')
      return saved && saved !== 'null' ? saved : 'bsc'
    } catch {
      return 'bsc'
    }
  })

  // Markets view pagination and search
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(100)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const isSearching = useMemo(() => searchQuery.trim().length > 0, [searchQuery])

  const currentNetworkRef = useRef(selectedNetwork);
  const lastChainChangeRef = useRef(0);

  // Wallet/network
  const [account, setAccount] = useState(null)
  const [chainId, setChainId] = useState(null)
  const [status, setStatus] = useState('')

  // For Trade view state
  const [selected, setSelected] = useState(() => {
    try {
      const saved = localStorage.getItem('selectedPair')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  const [baseToken, setBaseToken] = useState(TOKENS.find(t => t.network === 'bsc' && t.symbol === 'WBNB') || TOKENS[0])
  const [quoteToken, setQuoteToken] = useState(TOKENS.find(t => t.network === 'bsc' && t.symbol === 'USDC') || TOKENS[1])
  const [baseDecimals, setBaseDecimals] = useState(18)
  const [quoteDecimals, setQuoteDecimals] = useState(18)
  const [domainSeparator, setDomainSeparator] = useState('')

  // Approvals
  const [approveToken, setApproveToken] = useState('base')
  const [approveAmount, setApproveAmount] = useState('1000000')
  // Smart approve+sign state
  const [needsApproval, setNeedsApproval] = useState(false)
  const [smartLabel, setSmartLabel] = useState('')
  const [smartBusy, setSmartBusy] = useState(false)

  // Order builder
  const [amountIn, setAmountIn] = useState('0')
  const [amountOutMin, setAmountOutMin] = useState('0')
  const [expirationMins, setExpirationMins] = useState('60')
  const [nonce, setNonce] = useState('0')
  const [receiver, setReceiver] = useState('')
  const [salt, setSalt] = useState('0')
  const [orderJson, setOrderJson] = useState('')
  const [signature, setSignature] = useState('')
  const [tradeSide, setTradeSide] = useState('buy')

  // Conditional orders
  const [isConditional, setIsConditional] = useState(false)
  const [conditionalType, setConditionalType] = useState('stop_loss')
  const [triggerPrice, setTriggerPrice] = useState('')
  const [conditionalExpiration, setConditionalExpiration] = useState('')

  // Crosschain check
  const isCrossChainPair = useMemo(() => selected?.network === 'crosschain' || (baseToken.network && quoteToken.network && baseToken.network !== quoteToken.network), [selected, baseToken.network, quoteToken.network])

  useEffect(() => {
    // Auto-select token to approve based on the current side
    setApproveToken(tradeSide === 'sell' ? 'base' : 'quote')
  }, [tradeSide])

  useEffect(() => {
    setSmartLabel(t('app.signOrder'))
  }, [t])

  // Update allowance check whenever dependencies change
  useEffect(() => {
    (async () => {
      try { await checkAndUpdateAllowance() } catch {}
    })()
  }, [tradeSide, amountIn, account, selectedNetwork, baseToken?.address, quoteToken?.address, baseDecimals, quoteDecimals, isConditional])

  // Reset conditional order when switching to crosschain pair
  useEffect(() => {
    if (isCrossChainPair && isConditional) {
      setIsConditional(false)
    }
  }, [isCrossChainPair, isConditional])

  // Fill / Match
  const [fillOrderJson, setFillOrderJson] = useState('')
  const [fillSignature, setFillSignature] = useState('')
  const [fillAmountIn, setFillAmountIn] = useState('0')
  const [fillTakerMinOut, setFillTakerMinOut] = useState('0')

  // Track last placed order and resulting tx hash (for UI link)
  const [lastPlacedOrderId, setLastPlacedOrderId] = useState(null)
  const [lastOrderSignedAt, setLastOrderSignedAt] = useState(null)
  const [lastTxHash, setLastTxHash] = useState(null)
  // Track last signed order payload for cancel
  const [lastSignedOrder, setLastSignedOrder] = useState(null)

  const [buyOrderJson, setBuyOrderJson] = useState('')
  const [buySig, setBuySig] = useState('')
  const [sellOrderJson, setSellOrderJson] = useState('')
  const [sellSig, setSellSig] = useState('')
  const [amountBase, setAmountBase] = useState('0')

  // Orderbook state
  const [obAsks, setObAsks] = useState([])
  const [obBids, setObBids] = useState([])
  const [obLoading, setObLoading] = useState(false)
  const [obError, setObError] = useState('')

  // Recent fills state
  const [recentFills, setRecentFills] = useState([])
  const [fillsLoading, setFillsLoading] = useState(false)
  const [fillsError, setFillsError] = useState('')
  const [fillsCurrentPage, setFillsCurrentPage] = useState(1)
  const [fillsItemsPerPage] = useState(10) // Show 10 fills per page

  // Pagination logic for fills
  const fillsTotalPages = Math.ceil(recentFills.length / fillsItemsPerPage)
  const paginatedFills = useMemo(() => {
    const startIndex = (fillsCurrentPage - 1) * fillsItemsPerPage
    const endIndex = startIndex + fillsItemsPerPage
    return recentFills.slice(startIndex, endIndex)
  }, [recentFills, fillsCurrentPage, fillsItemsPerPage])

  // Trading stats
  const [currentPrice, setCurrentPrice] = useState('0.00')
  const [priceChange, setPriceChange] = useState('0.00')
  const [volume24h, setVolume24h] = useState('0')

  // Auto-calculate amountOutMin based on amountIn and current price
  useEffect(() => {
    if (!amountIn || !currentPrice || currentPrice === '0.00') return
    const amtIn = parseFloat(amountIn)
    if (isNaN(amtIn) || amtIn <= 0) return
    const price = typeof currentPrice === 'number'
      ? currentPrice
      : parseFloat(String(currentPrice).replace(/,/g, ''))
    if (isNaN(price) || price <= 0) return
    let calculated
    if (tradeSide === 'sell') {
      calculated = amtIn * price
    } else {
      calculated = amtIn / price
    }
    setAmountOutMin(calculated.toFixed(6))
  }, [amountIn, tradeSide, currentPrice])

// Calculate USD value when amountIn or amountOutMin changes
useEffect(() => {
  const calcUsd = async () => {
    // For amountIn
    if (!amountIn || Number(amountIn) <= 0) {
      setUsdValue('')
    } else {
      const tokenToPrice = tradeSide === 'sell' ? baseToken : quoteToken
      const tokenNetwork = selectedNetwork === 'crosschain' ? tokenToPrice.network : selectedNetwork
      const price = await fetchTokenUsdPrice(tokenNetwork, tokenToPrice.address)
      if (price) {
        const usd = Number(amountIn) * price
        setUsdValue(`$${usd.toFixed(2)}`)
      } else {
        setUsdValue('')
      }
    }

    // For min receive (amountOutMin)
    if (!amountOutMin || Number(amountOutMin) <= 0) {
      setUsdValueMinReceive('')
    } else {
      const tokenToPriceMin = tradeSide === 'sell' ? quoteToken : baseToken
      const tokenNetworkMin = selectedNetwork === 'crosschain' ? tokenToPriceMin.network : selectedNetwork
      const priceMin = await fetchTokenUsdPrice(tokenNetworkMin, tokenToPriceMin.address)
      if (priceMin) {
        const usdMin = Number(amountOutMin) * priceMin
        setUsdValueMinReceive(`$${usdMin.toFixed(2)}`)
      } else {
        setUsdValueMinReceive('')
      }
    }
  }
  calcUsd()
}, [amountIn, amountOutMin, tradeSide, baseToken.address, quoteToken.address, selectedNetwork])

  // Global DEX stats
  const [globalStats, setGlobalStats] = useState(null)
  const [globalStatsLoading, setGlobalStatsLoading] = useState(false)
  const [globalStatsError, setGlobalStatsError] = useState('')

  // User balances
  const [baseBalance, setBaseBalance] = useState('0')
  const [quoteBalance, setQuoteBalance] = useState('0')

  // USD value for amount input
  const [usdValue, setUsdValue] = useState('')
  const [usdValueMinReceive, setUsdValueMinReceive] = useState('')


  // My open orders
  const [myOpenOrders, setMyOpenOrders] = useState([])
  const [myOpenOrdersLoading, setMyOpenOrdersLoading] = useState(false)
  const [myOpenOrdersError, setMyOpenOrdersError] = useState('')
  // Header My Orders modal state
  const [myOrdersOpen, setMyOrdersOpen] = useState(false)

  // My watchlist
  const [myWatchlist, setMyWatchlist] = useState([])
  const [myWatchlistLoading, setMyWatchlistLoading] = useState(false)
  const [myWatchlistError, setMyWatchlistError] = useState('')

  // User watchlist for toggle buttons
  const [userWatchlist, setUserWatchlist] = useState([])

  // Token symbols cache for orders
  const [tokenSymbols, setTokenSymbols] = useState({})

  // Fetch conditional orders from API
  const fetchConditionalOrders = async () => {
    if (!account) return [];
    try {
      const network = (selectedNetwork && selectedNetwork !== 'null') ? selectedNetwork : 'bsc';
      const makerParam = account;
      const url = `${INDEXER_BASE}/api/conditional-orders?network=${network}&maker=${makerParam}`;
      console.log('[DEBUG] Fetching conditional orders from:', url);
      const res = await fetch(url);
      console.log('[DEBUG] Conditional orders response status:', res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      console.log('[DEBUG] Conditional orders fetched:', json.data?.length || 0);
      return json.data || [];
    } catch (e) {
      console.error('Failed to fetch conditional orders:', e);
      return [];
    }
  };

  // Get token info with caching
  const getTokenInfo = async (address) => {
    if (tokenSymbols[address]) return tokenSymbols[address];
    try {
      // Handle hardcoded crosschain pairs
      if (selectedNetwork === 'crosschain') {
        if (address === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') {
          const info = { symbol: 'WBNB', logoUrl: 'https://assets.trustwalletapp.com/blockchains/smartchain/assets/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c/logo.png' };
          setTokenSymbols(prev => ({ ...prev, [address]: info }));
          return info;
        } else if (address === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') {
          const info = { symbol: 'USDC', logoUrl: 'https://assets.trustwalletapp.com/blockchains/base/assets/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/logo.png' };
          setTokenSymbols(prev => ({ ...prev, [address]: info }));
          return info;
        }
      }
      const res = await fetch(`${INDEXER_BASE}/api/token/info?network=${selectedNetwork}&address=${address}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const info = {
        symbol: json.symbol || 'UNKNOWN',
        logoUrl: json.logoUrl || null
      };
      setTokenSymbols(prev => ({ ...prev, [address]: info }));
      return info;
    } catch (e) {
      console.error('Failed to fetch token info:', e);
      return { symbol: 'UNKNOWN', logoUrl: null };
    }
  };

  // Format order for display
  const formatOrder = async (order) => {
    try {
      // Ensure amountIn and amountOutMin are defined to prevent BigInt errors
      if (order.amountIn == null) order.amountIn = '0';
      if (order.amountOutMin == null) order.amountOutMin = '0';

      // Handle conditional orders (shape differs from regular orders)
      if (order.isConditional) {
        let baseAddr = order.base_token;
        let quoteAddr = order.quote_token;
        const triggerPrice = order.trigger_price ?? order.triggerPrice;
        const conditionalType = order.type ?? order.conditionalType;

        try {
          // For Solana, prefer canonical addresses from order_template (tokenIn/tokenOut)
          if (selectedNetwork === 'solana' && order.order_template) {
            const tin = (order.order_template.tokenIn || '').toString();
            const tout = (order.order_template.tokenOut || '').toString();
            if (tin && tout) {
              if (tin.toLowerCase() === (baseAddr || '').toString().toLowerCase()) {
                baseAddr = tin;
                quoteAddr = tout;
              } else if (tin.toLowerCase() === (quoteAddr || '').toString().toLowerCase()) {
                baseAddr = tout;
                quoteAddr = tin;
              }
            }
          }

          const [baseInfo, quoteInfo] = await Promise.all([
            getTokenInfo(baseAddr),
            getTokenInfo(quoteAddr)
          ]);

          const baseToken = { symbol: baseInfo.symbol, address: baseAddr, logoUrl: baseInfo.logoUrl };
          const quoteToken = { symbol: quoteInfo.symbol, address: quoteAddr, logoUrl: quoteInfo.logoUrl };
          const expires = order.expiration ? new Date(order.expiration).toLocaleString() : 'No expiry';

          // For conditional, format amounts from order_template if available
          let amountInFormatted = 'N/A';
          let amountOutMinFormatted = 'N/A';
          if (order.order_template) {
            const template = order.order_template;
            // Ensure template amounts are defined
            if (template.amountIn == null) template.amountIn = '0';
            if (template.amountOutMin == null) template.amountOutMin = '0';
            const [baseDecs, quoteDecs] = await Promise.all([
              fetchTokenDecimals(baseAddr, provider, selectedNetwork),
              fetchTokenDecimals(quoteAddr, provider, selectedNetwork)
            ]);
            const isSell = (template.tokenIn || '').toLowerCase() === baseAddr.toLowerCase();
            amountInFormatted = isSell ? formatUnitsStr(template.amountIn, baseDecs, 6) : formatUnitsStr(template.amountIn, quoteDecs, 6);
            amountOutMinFormatted = isSell ? formatUnitsStr(template.amountOutMin, quoteDecs, 6) : formatUnitsStr(template.amountOutMin, baseDecs, 6);
          }

          return {
            ...order,
            id: order.conditional_order_id,
            base_symbol: baseInfo.symbol,
            quote_symbol: quoteInfo.symbol,
            baseToken,
            quoteToken,
            price: `$${String(triggerPrice || '0')}`,
            amountInFormatted,
            amountOutMinFormatted,
            expires,
            conditionalType: conditionalType || 'conditional',
            tokenInSymbol: isSell ? baseInfo.symbol : quoteInfo.symbol,
            tokenOutSymbol: isSell ? quoteInfo.symbol : baseInfo.symbol
          };
        } catch (e) {
          console.error('Failed to format conditional order:', e, order);
          return {
            id: order.conditional_order_id,
            base_symbol: 'UNKNOWN',
            quote_symbol: 'UNKNOWN',
            baseToken: { symbol: 'UNKNOWN', address: baseAddr || '', logoUrl: null },
            quoteToken: { symbol: 'UNKNOWN', address: quoteAddr || '', logoUrl: null },
            price: `$${String(triggerPrice || '0')}`,
            amountInFormatted: 'N/A',
            amountOutMinFormatted: 'N/A',
            expires: order.expiration ? new Date(order.expiration).toLocaleString() : 'No expiry',
            conditionalType: conditionalType || 'conditional'
          };
        }
      }

      // Regular order formatting with Solana-safe address handling
      const isSell = selectedNetwork === 'solana'
        ? ((order.tokenIn || '').toString().toLowerCase() === (order.base_address || '').toString().toLowerCase())
        : ((order.tokenIn || '').toString().toLowerCase() === (order.base_address || '').toString().toLowerCase());

      const baseAddr = selectedNetwork === 'solana'
        ? (isSell ? (order.tokenIn || '') : (order.tokenOut || ''))
        : (order.base_address || '').toLowerCase();
      const quoteAddr = selectedNetwork === 'solana'
        ? (isSell ? (order.tokenOut || '') : (order.tokenIn || ''))
        : (order.quote_address || '').toLowerCase();

      // Ensure amountIn and amountOutMin are defined to prevent BigInt errors
      if (order.amountIn == null) order.amountIn = '0';
      if (order.amountOutMin == null) order.amountOutMin = '0';

      // Fetch decimals for the order's base and quote tokens
      const [baseDecs, quoteDecs] = await Promise.all([
        fetchTokenDecimals(baseAddr, provider, selectedNetwork),
        fetchTokenDecimals(quoteAddr, provider, selectedNetwork)
      ]);

      // Get token info for base and quote
      const [baseInfo, quoteInfo] = await Promise.all([
        getTokenInfo(baseAddr),
        getTokenInfo(quoteAddr)
      ]);

      const amountInNum = Number(order.amountIn);
      const amountOutMinNum = Number(order.amountOutMin);

      // Calculate price: for sell orders, price = amountOutMin / amountIn (quote per base)
      // For buy orders, price = amountIn / amountOutMin (quote per base)
      let price = 0;
      if (isSell) {
        price = (amountOutMinNum / (10 ** quoteDecs)) / (amountInNum / (10 ** baseDecs));
      } else {
        price = (amountInNum / (10 ** quoteDecs)) / (amountOutMinNum / (10 ** baseDecs));
      }

      // Format amounts with decimals
      const amountInFormatted = isSell ? formatUnitsStr(order.amountIn, baseDecs, 6) : formatUnitsStr(order.amountIn, quoteDecs, 6);
      const amountOutMinFormatted = isSell ? formatUnitsStr(order.amountOutMin, quoteDecs, 6) : formatUnitsStr(order.amountOutMin, baseDecs, 6);

      // Format expiration time
      const expires = order.expiration ? new Date(order.expiration).toLocaleString() : 'No expiry';

      // Create token objects for logos
      const baseToken = { symbol: baseInfo.symbol, address: baseAddr, logoUrl: baseInfo.logoUrl };
      const quoteToken = { symbol: quoteInfo.symbol, address: quoteAddr, logoUrl: quoteInfo.logoUrl };

      return {
        ...order,
        id: order.order_id,
        base_symbol: baseInfo.symbol,
        quote_symbol: quoteInfo.symbol,
        baseToken,
        quoteToken,
        price: price.toFixed(6),
        amountInFormatted,
        amountOutMinFormatted,
        expires,
        tokenInSymbol: isSell ? baseInfo.symbol : quoteInfo.symbol,
        tokenOutSymbol: isSell ? quoteInfo.symbol : baseInfo.symbol
      };
    } catch (e) {
      console.error('Failed to format order:', e);
      return null;
    }
  };

  // GeckoTerminal pool path (e.g., bsc/pools/0x...)
  const [geckoPoolId, setGeckoPoolId] = useState('')

  // Mobile trade view state
  const [tradeView, setTradeView] = useState('chart') // 'chart', 'trade', 'orders'

  // SAL Order modal state
  const [showSALOrderModal, setShowSALOrderModal] = useState(false)
  const [modalKey, setModalKey] = useState(0)


  const { primaryWallet } = useDynamicContext()
  const { theme, styles, toggleTheme } = useThemeStyles()

  // Mobile detection effect
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 480)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Theme body class effect
  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme')
    } else {
      document.body.classList.remove('light-theme')
    }
  }, [theme])

  // Listen for network changes
  useEffect(() => {
    const eth = primaryWallet?.connector?.getProvider?.() || (typeof window !== 'undefined' && window.ethereum);
    if (!eth) return;

    const handleChainChanged = (chainIdHex) => {
      console.log('[DESKTOP] Chain changed event:', chainIdHex);
      const now = Date.now();
      if (now - lastChainChangeRef.current < 1000) return;
      lastChainChangeRef.current = now;

      const newChainId = parseInt(chainIdHex, 16);
      console.log('[DESKTOP] New chainId:', newChainId, 'currentNetworkRef:', currentNetworkRef.current);
      setChainId(newChainId);
      const newSelected = newChainId === BASE_CHAIN_ID ? 'base' : (newChainId === BSC_CHAIN_ID ? 'bsc' : 'bsc');
      console.log('[DESKTOP] New selected network:', newSelected);
      if (newSelected !== currentNetworkRef.current) {
        console.log('[DESKTOP] Updating selectedNetwork to:', newSelected);
        currentNetworkRef.current = newSelected;
        setSelectedNetwork(newSelected);
        const networkName = newSelected.toUpperCase();
        setStatus(`Connected to ${networkName}`);
        toast.success(`Switched to ${networkName} network`, {
          duration: 3000,
          position: 'top-center'
        });
      }
    };

    try {
      eth.on('chainChanged', handleChainChanged);
    } catch (e) {
      console.error('[DESKTOP] Failed to add chainChanged listener:', e);
    }

    return () => {
      try {
        eth.off('chainChanged', handleChainChanged);
      } catch (e) {
        console.error('[DESKTOP] Failed to remove chainChanged listener:', e);
      }
    };
  }, [primaryWallet]);

  // One-time full app refresh after a successful chain change
  useEffect(() => {
    const eth = primaryWallet?.connector?.getProvider?.() || (typeof window !== 'undefined' && window.ethereum);
    if (!eth) return;

    const handleChainChangedReload = (chainIdHex) => {
      const newChainId = parseInt(chainIdHex, 16);
      const newIdStr = String(newChainId);
      const lastReload = localStorage.getItem('lastReloadChain');
      if (lastReload !== newIdStr) {
        try { localStorage.setItem('lastReloadChain', newIdStr); } catch {}
        setTimeout(() => { window.location.reload(); }, 50);
      }
    };

    try {
      eth.on('chainChanged', handleChainChangedReload);
    } catch (e) {
      console.error('[DESKTOP] Failed to add reload chainChanged listener:', e);
    }
    return () => {
      try {
        eth.off('chainChanged', handleChainChangedReload);
      } catch (e) {
        console.error('[DESKTOP] Failed to remove reload chainChanged listener:', e);
      }
    };
  }, [primaryWallet]);

  // ===== Helpers =====

  // ===== Orderbook formatting helpers =====
  const toLowerSafe = (s) => (s || '').toString().toLowerCase()
  const scalePrice = (serverPrice, bDec, qDec) => {
    const p = Number(serverPrice || 0)
    if (!Number.isFinite(p)) return 0
    // Prices are now stored as human-readable
    return p
  }
  function formatUnitsStr(value, decimals, maxFrac = 6) {
    try {
      const val = BigInt(value || '0')
      const d = BigInt(10) ** BigInt(decimals || 0)
      const whole = val / d
      const frac = val % d
      let fracStr = frac.toString().padStart(Number(decimals), '0').slice(0, maxFrac)
      fracStr = fracStr.replace(/0+$/, '')
      const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      if (fracStr) {
        return `${wholeStr}.${fracStr}`
      } else {
        return wholeStr
      }
    } catch (e) {
      console.error('formatUnitsStr error:', e, value, decimals)
      return '0'
    }
  }
  const formatNumberFixed = (n, maxFrac = 8) => {
    const num = Number(n)
    if (!Number.isFinite(num)) return '0'
    if (num < 0.0001 && num > 0) {
      // For very small numbers, use scientific notation or more decimals
      return num.toFixed(10).replace(/\.?0+$/, '')
    }
    return num.toLocaleString(undefined, { maximumFractionDigits: maxFrac })
  }
  const formatPrice = (price) => {
    const num = Number(price)
    if (!Number.isFinite(num)) return '0.00'
    if (num >= 1) {
      return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } else {
      return num.toLocaleString(undefined, { maximumFractionDigits: 8 }).replace(/\.?0+$/, '')
    }
  }
  const computeObRow = (o) => {
    const baseAddr = toLowerSafe(selected?.base?.address || baseToken.address)
    const quoteAddr = toLowerSafe(selected?.quote?.address || quoteToken.address)
    const isAsk = toLowerSafe(o.tokenIn) === baseAddr && toLowerSafe(o.tokenOut) === quoteAddr
    const pTrue = scalePrice(o.price, baseDecimals, quoteDecimals)
    const priceStr = formatPrice(pTrue)
    let amountBaseStr = '0'
    let baseAmtFloat = 0
    let totalQuote = 0

    if (isAsk) {
      // Sell order: selling base for quote
      // amountIn = base amount they want to sell
      amountBaseStr = formatUnitsStr(o.amountIn, baseDecimals, 6)
      baseAmtFloat = parseFloat((amountBaseStr || '0').replace(/,/g, '')) || 0
      totalQuote = pTrue * baseAmtFloat
    } else {
      // Buy order: buying base with quote
      // amountOutMin = base amount they want to buy
      let baseAmt = 0
      if (o.amountOutMin && o.amountOutMin !== '0') {
        amountBaseStr = formatUnitsStr(o.amountOutMin, baseDecimals, 6)
        baseAmt = parseFloat((amountBaseStr || '0').replace(/,/g, '')) || 0
      } else {
        // Fallback: calculate from amountIn (quote) and price
        const quoteAmtStr = formatUnitsStr(o.amountIn, quoteDecimals, 6)
        const quoteAmt = parseFloat((quoteAmtStr || '0').replace(/,/g, '')) || 0
        baseAmt = quoteAmt / pTrue
        amountBaseStr = formatNumberFixed(baseAmt, 6)
      }
      baseAmtFloat = baseAmt
      totalQuote = pTrue * baseAmtFloat
    }

    const totalQuoteStr = formatNumberFixed(totalQuote, 6)
    return { priceStr, amountBaseStr, totalQuoteStr, isAsk }
  }

  const computeDepthData = () => {
    const bids = {}
    const asks = {}
    obBids.forEach(o => {
      const row = computeObRow(o)
      const price = parseFloat(row.priceStr.replace(/,/g, ''))
      const volume = parseFloat(row.amountBaseStr.replace(/,/g, ''))
      bids[price] = (bids[price] || 0) + volume
    })
    obAsks.forEach(o => {
      const row = computeObRow(o)
      const price = parseFloat(row.priceStr.replace(/,/g, ''))
      const volume = parseFloat(row.amountBaseStr.replace(/,/g, ''))
      asks[price] = (asks[price] || 0) + volume
    })
    // Sort bids descending, asks ascending
    const bidPrices = Object.keys(bids).map(Number).sort((a,b)=>b-a)
    const askPrices = Object.keys(asks).map(Number).sort((a,b)=>a-b)
    // Cumulative
    let cumBid = 0
    const bidData = bidPrices.map(p => {
      cumBid += bids[p]
      return { price: p, volume: cumBid }
    })
    let cumAsk = 0
    const askData = askPrices.map(p => {
      cumAsk += asks[p]
      return { price: p, volume: cumAsk }
    })
    return { bidData, askData }
  }

  // Tolerant parser for pasted JSON (handles code fences and extra text)
  function parseOrderText(txt) {
    let s = (txt || '').trim()
    if (!s) throw new Error('Empty order JSON')
    // Strip markdown code fences
    if (s.startsWith('```')) {
      s = s.replace(/^```(?:json|js)?\s*/i, '')
      if (s.endsWith('```')) s = s.slice(0, -3)
      s = s.trim()
    }
    try {
      return JSON.parse(s)
    } catch (e1) {
      // Fallback: extract first {...} block
      const i = s.indexOf('{')
      const j = s.lastIndexOf('}')
      if (i >= 0 && j > i) {
        const sub = s.slice(i, j + 1)
        try { return JSON.parse(sub) } catch {}
      }
      throw e1
    }
  }

  // Persist selected network to localStorage
  useEffect(() => {
    try {
      console.log('[NETWORK DEBUG] Saving to localStorage:', selectedNetwork)
      if (selectedNetwork && selectedNetwork !== 'null') {
        localStorage.setItem('selectedNetwork', selectedNetwork)
      } else {
        localStorage.removeItem('selectedNetwork')
      }
      currentNetworkRef.current = selectedNetwork;
      console.log('[NETWORK DEBUG] Saved successfully. Current localStorage value:', localStorage.getItem('selectedNetwork'))
    } catch (e) {
      console.error('[NETWORK DEBUG] Failed to save selected network to localStorage:', e)
    }
  }, [selectedNetwork])

  // Update tokens when network changes
  useEffect(() => {
    if (selectedNetwork === 'base') {
      setSelected(null)
      setBaseToken(TOKENS.find(t => t.network === 'base' && t.symbol === 'WETH') || TOKENS.find(t => t.network === 'base'))
      setQuoteToken(TOKENS.find(t => t.network === 'base' && t.symbol === 'USDC') || TOKENS.find(t => t.network === 'base'))
    } else if (selectedNetwork === 'bsc') {
      setSelected(null)
      setBaseToken(TOKENS.find(t => t.network === 'bsc' && t.symbol === 'WBNB'))
      setQuoteToken(TOKENS.find(t => t.network === 'bsc' && t.symbol === 'USDC'))
    }
    // For solana and crosschain, keep current tokens or handle separately if needed
  }, [selectedNetwork])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('geckoPoolId')
      if (saved) setGeckoPoolId(saved)
    } catch {}
  }, [])

  useEffect(() => {
    try {
      if (geckoPoolId) localStorage.setItem('geckoPoolId', geckoPoolId)
      else localStorage.removeItem('geckoPoolId')
    } catch {}
  }, [geckoPoolId])

  // Poll fills endpoint for the last placed order to surface tx link
  useEffect(() => {
    if (!lastPlacedOrderId || !lastOrderSignedAt) return
    let attempts = 0
    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      attempts++
      try {
        const resp = await fetch(`${INDEXER_BASE}/api/fills?network=${selectedNetwork}&orderId=${lastPlacedOrderId}&since=${lastOrderSignedAt}`)
        if (resp.ok) {
          const json = await resp.json()
          const row = (json?.data || []).find(r => r?.txHash)
          if (row?.txHash) {
            setLastTxHash(row.txHash)
            // Trigger immediate refresh of fills and orderbook after trade execution
            loadRecentFills().catch(() => {})
            loadOrderBook().catch(() => {})
            loadMyOrders().catch(() => {})
            return // stop polling
          }
        }
      } catch {}
      if (attempts < 30) { // ~60s total at 2s interval
        setTimeout(poll, 2000)
      }
    }
    poll()
    return () => { cancelled = true }
  }, [lastPlacedOrderId, lastOrderSignedAt, selectedNetwork])


  // Show toast notification when fill completes
  useEffect(() => {
    if (!lastTxHash) return
    const explorerUrl = selectedNetwork === 'base' ? 'https://basescan.org' : 'https://bscscan.com'
    const explorerName = selectedNetwork === 'base' ? 'BaseScan' : 'BscScan'
    toast.success(
      (t) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>🎉 Trade Executed!</div>
          <a
            href={`${explorerUrl}/tx/${lastTxHash}`}
            target="_blank"
            rel="noreferrer"
            style={{
              color: '#4da3ff',
              textDecoration: 'underline',
              fontSize: 14
            }}
            onClick={() => toast.dismiss(t.id)}
          >
            View on {explorerName} →
          </a>
        </div>
      ),
      {
        duration: 8000,
        position: 'top-right',
        style: {
          background: theme === 'dark' ? '#1e2936' : '#fff',
          color: theme === 'dark' ? '#fff' : '#000',
          border: '1px solid rgba(74, 222, 128, 0.3)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          padding: '16px',
          maxWidth: '400px'
        }
      }
    )
  }, [lastTxHash, theme])

  const provider = useMemo(() => {
    try {
      if (selectedNetwork === 'solana') {
        // For Solana, we don't use ethers provider
        return null
      }
      if (primaryWallet?.connector?.getProvider) {
        const w = primaryWallet.connector.getProvider()
        if (w) return new BrowserProvider(w)
      }
    } catch {}
    if (hasMetaMask()) return new BrowserProvider(window.ethereum)
    return null
  }, [primaryWallet, selectedNetwork])

  // When Dynamic wallet connects, derive account/state automatically
  useEffect(() => {
    (async () => {
      try {
        console.log('[NETWORK DEBUG] Wallet connection effect triggered. selectedNetwork:', selectedNetwork)
        if (selectedNetwork === 'solana') {
          // For Solana, use Dynamic wallet
          if (primaryWallet?.address) {
            const addr = primaryWallet.address
            setAccount(addr)
            setChainId(101)
            setStatus(`Connected to Solana: ${addr}`)
          } else {
            setAccount(null)
            setChainId(101)
            setStatus('Solana network selected - connect wallet to sign orders')
          }
          return
        }

        if (!primaryWallet) {
          console.log('[NETWORK DEBUG] No primary wallet connected yet')
          return
        }
        if (selectedNetwork !== 'crosschain') {
          console.log('[NETWORK DEBUG] Switching to network:', selectedNetwork)
          await switchToNetwork(selectedNetwork)
        }
        const s = await getSigner()
        const addr = await s.getAddress()
        const net = await provider.getNetwork()
        setAccount(addr)
        setChainId(Number(net.chainId))
        const networkName = selectedNetwork === 'crosschain' ? (Number(net.chainId) === BASE_CHAIN_ID ? 'Base' : 'BSC') : selectedNetwork.toUpperCase()
        setStatus(`Connected to ${networkName}${selectedNetwork === 'crosschain' ? ' (Cross-Chain Mode)' : ''}`)
        console.log('[NETWORK DEBUG] Connected to:', networkName)
        await refreshTokenMeta((selected?.base || baseToken).address, (selected?.quote || quoteToken).address)
        const c = await getContract(false)
        setDomainSeparator(await c.DOMAIN_SEPARATOR())
        await fetchBalances()
      } catch (e) {
        console.error('[NETWORK DEBUG] Error in wallet connection effect:', e)
      }
    })()
  }, [primaryWallet, selectedNetwork])

  const getSigner = async () => {
    if (!provider) throw new Error('No provider')
    return provider.getSigner()
  }

  const getContract = async (withSigner = false) => {
    const p = provider
    if (!p) throw new Error('No provider')
    // For cross-chain, use the custodial address as settlement address
    const settlementAddr = selectedNetwork === 'crosschain' ? '0x70c992e6a19c565430fa0c21933395ebf1e907c3' : (selectedNetwork === 'base' ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS)
    if (withSigner) {
      const s = await getSigner()
      return new Contract(settlementAddr, SETTLEMENT_ABI, s)
    }
    return new Contract(settlementAddr, SETTLEMENT_ABI, p)
  }

  const getErc20 = async (address, withSigner = false) => {
    const p = provider
    if (!p) throw new Error('No provider')
    if (withSigner) {
      const s = await getSigner()
      return new Contract(address, ERC20_ABI, s)
    }
    return new Contract(address, ERC20_ABI, p)
  }

  const switchToNetwork = async (network = 'bsc') => {
    const eth = (primaryWallet?.connector?.getProvider && primaryWallet.connector.getProvider()) || (hasMetaMask() ? window.ethereum : null)
    if (!eth) throw new Error('No wallet provider detected')

    // For Solana, no network switching needed
    if (network === 'solana') {
      return 101 // Solana chain ID
    }

    // Validate and resolve target chain metadata
    if (network !== 'bsc' && network !== 'base') {
      throw new Error(`Unknown network: ${network}`)
    }
    const targetChainId = network === 'base' ? BASE_CHAIN_ID : BSC_CHAIN_ID
    const targetHex = network === 'base' ? BASE_HEX : BSC_HEX
    const targetParams = network === 'base' ? BASE_PARAMS : BSC_PARAMS

    // Debug: trace switching intent
    try { console.debug('[switchToNetwork]', { network, targetChainId, targetHex }) } catch {}

    const current = await eth.request({ method: 'eth_chainId' })
    if (current === targetHex) return targetChainId

    try {
      if (primaryWallet?.connector?.switchNetwork) {
        // Some connectors require a known mapping for the chainId. Guard against undefined.
        if (!targetChainId) throw new Error('Resolved targetChainId is undefined')
        await primaryWallet.connector.switchNetwork(targetChainId)
      } else {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetHex }] })
      }
      return targetChainId
    } catch (e) {
      // If the chain is not added, attempt to add it first then retry.
      if (e?.code === 4902 || e?.data?.originalError?.code === 4902) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [targetParams] })
        return targetChainId
      }
      throw e
    }
  }

  const connect = async () => {
    try {
      if (selectedNetwork === 'solana') {
        // For Solana, use Dynamic wallet
        if (primaryWallet) {
          const addr = primaryWallet.address
          setAccount(addr)
          setChainId(101)
          setStatus(`Connected to Solana: ${addr}`)
        } else {
          setAccount(null)
          setChainId(101)
          setStatus('Solana network selected - connect wallet to sign orders')
        }
        return
      }

      if (selectedNetwork !== 'crosschain') {
        await switchToNetwork(selectedNetwork)
      }
      // If using injected provider fallback, request accounts
      if (!primaryWallet && hasMetaMask()) {
        await window.ethereum.request({ method: 'eth_requestAccounts' })
      }
      const s = await getSigner()
      const addr = await s.getAddress()
      const net = await provider.getNetwork()
      setAccount(addr)
      setChainId(Number(net.chainId))
      const networkName = selectedNetwork === 'crosschain' ? (Number(net.chainId) === BASE_CHAIN_ID ? 'Base' : 'BSC') : (selectedNetwork === 'solana' ? 'Solana' : selectedNetwork.toUpperCase())
      setStatus(`Connected to ${networkName}${selectedNetwork === 'crosschain' ? ' (Cross-Chain Mode)' : ''}`)
      // Load decimals for selected pair
      await refreshTokenMeta((selected?.base || baseToken).address, (selected?.quote || quoteToken).address)
      const c = await getContract(false)
      setDomainSeparator(await c.DOMAIN_SEPARATOR())
    } catch (e) {
      console.error(e)
      setStatus(`Connect failed: ${e.message ?? e}`)
    }
  }

  const refreshTokenMeta = async (baseAddr, quoteAddr) => {
    try {
      // Fetch decimals dynamically from contracts
      const [d0, d1] = await Promise.all([
        fetchTokenDecimals(baseAddr, provider, selectedNetwork),
        fetchTokenDecimals(quoteAddr, provider, selectedNetwork)
      ])
      setBaseDecimals(Number(d0))
      setQuoteDecimals(Number(d1))
    } catch (error) {
      console.warn('Failed to fetch decimals from contracts:', error)
      // Fallback to known tokens or default
      const b = TOKENS.find(t => t.address.toLowerCase() === baseAddr.toLowerCase()) || { decimals: 18 }
      const q = TOKENS.find(t => t.address.toLowerCase() === quoteAddr.toLowerCase()) || { decimals: 18 }
      setBaseDecimals(b.decimals)
      setQuoteDecimals(q.decimals)
    }
  }

  const fetchBalances = async () => {
    if (!account) return
    if (selectedNetwork === 'solana') {
      try {
        const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=c6f5ba2f-2147-43d6-82fc-1f62b2e419cd')
        // Fetch base token balance
        let baseBal = '0'
        if (baseToken.address.toLowerCase() === 'so11111111111111111111111111111111111111112') { // WSOL
          const bal = await connection.getBalance(new PublicKey(account))
          baseBal = (bal / 10**9).toFixed(6)
        } else {
          try {
            const ata = await getAssociatedTokenAddress(new PublicKey(baseToken.address), new PublicKey(account))
            const tokenAccount = await connection.getTokenAccountBalance(ata)
            baseBal = tokenAccount.value.uiAmountString || '0'
          } catch {
            baseBal = '0'
          }
        }
        // Fetch quote token balance
        let quoteBal = '0'
        if (quoteToken.address.toLowerCase() === 'so11111111111111111111111111111111111111112') { // WSOL
          const bal = await connection.getBalance(new PublicKey(account))
          quoteBal = (bal / 10**9).toFixed(6)
        } else {
          try {
            const ata = await getAssociatedTokenAddress(new PublicKey(quoteToken.address), new PublicKey(account))
            const tokenAccount = await connection.getTokenAccountBalance(ata)
            quoteBal = tokenAccount.value.uiAmountString || '0'
          } catch {
            quoteBal = '0'
          }
        }
        setBaseBalance(baseBal)
        setQuoteBalance(quoteBal)
      } catch (e) {
        console.error('Failed to fetch Solana balances:', e)
        setBaseBalance('N/A')
        setQuoteBalance('N/A')
      }
      return
    }
    // If no provider available, skip balance fetching
    if (!provider) {
      setBaseBalance('N/A')
      setQuoteBalance('N/A')
      return
    }
    try {
      let baseBal, quoteBal

      if (selectedNetwork === 'crosschain') {
        // For cross-chain, fetch balances from respective networks using read-only providers
        const baseProvider = baseToken.network === 'base' ? BASE_PROVIDER : BSC_PROVIDER
        const quoteProvider = quoteToken.network === 'base' ? BASE_PROVIDER : BSC_PROVIDER

        const baseContract = new Contract(baseToken.address, ERC20_ABI, baseProvider)
        const quoteContract = new Contract(quoteToken.address, ERC20_ABI, quoteProvider)

        const balances = await Promise.all([
          baseContract.balanceOf(account),
          quoteContract.balanceOf(account)
        ])
        baseBal = balances[0]
        quoteBal = balances[1]
      } else {
        // For single network, use the wallet provider
        const baseContract = await getErc20(baseToken.address)
        const quoteContract = await getErc20(quoteToken.address)

        const balances = await Promise.all([
          baseContract.balanceOf(account),
          quoteContract.balanceOf(account)
        ])
        baseBal = balances[0]
        quoteBal = balances[1]
      }

      setBaseBalance(formatUnitsStr(baseBal, baseDecimals, 6))
      setQuoteBalance(formatUnitsStr(quoteBal, quoteDecimals, 6))
    } catch (e) {
      console.error('Failed to fetch balances:', e)
      // Set to 'N/A' instead of '0' to indicate balance fetch failed
      setBaseBalance('N/A')
      setQuoteBalance('N/A')
    }
  }

  // ============ Markets view ============
  const [pairs, setPairs] = useState([])
  const [pairsLoading, setPairsLoading] = useState(false)
  const [pairsError, setPairsError] = useState('')
  const [pairsPage, setPairsPage] = useState(1)
  const [pairsTotal, setPairsTotal] = useState(0)

  // Filter and sort pairs based on selected filter and search query
  const filteredPairs = useMemo(() => {
    const baseList = isSearching ? searchResults : pairs
    if (!baseList.length) return []

    let filtered = [...baseList]

    // First apply search filter (only when not in backend search mode)
    if (!isSearching && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(p => {
        const baseSymbol = (p.base?.symbol || '').toLowerCase()
        const quoteSymbol = (p.quote?.symbol || '').toLowerCase()
        const baseAddress = (p.base?.address || '').toLowerCase()
        const quoteAddress = (p.quote?.address || '').toLowerCase()
        const pair = (p.pair || '').toLowerCase()

        return baseSymbol.includes(query) ||
                quoteSymbol.includes(query) ||
                baseAddress.includes(query) ||
                quoteAddress.includes(query) ||
                pair.includes(query)
      })
    }

    const hasTradingData = (market) => {
      const price = market.price && market.price !== '-' && market.price !== '0.00';
      const volume = market.volume && market.volume !== '0' && parseFloat(market.volume.replace(/,/g, '')) > 0;
      const change = market.change && market.change !== '0.00';
      return price || volume || change;
    }

    // Then apply sorting based on filter type
    switch (filterType) {
      case 'trending':
        // Sort by volume descending (highest volume first)
        filtered.sort((a, b) => {
          const aVol = Number((a.volume || '0').replace(/,/g, ''))
          const bVol = Number((b.volume || '0').replace(/,/g, ''))
          return bVol - aVol
        })
        break
      case 'hot':
        // Sort by absolute price change (highest change first)
        filtered.sort((a, b) => Math.abs(Number(b.change || 0)) - Math.abs(Number(a.change || 0)))
        break
      case 'new':
        // For now, sort by most recent (this would need timestamp data from server)
        // Placeholder: sort by volume as proxy
        filtered.sort((a, b) => {
          const aVol = Number((a.volume || '0').replace(/,/g, ''))
          const bVol = Number((b.volume || '0').replace(/,/g, ''))
          return bVol - aVol
        })
        break
      case 'volume':
        // Sort by 24h volume descending
        filtered.sort((a, b) => {
          const aVol = Number((a.volume || '0').replace(/,/g, ''))
          const bVol = Number((b.volume || '0').replace(/,/g, ''))
          return bVol - aVol
        })
        break
      case 'gainers':
        // Sort by positive price change descending (from orderbook trades)
        filtered.sort((a, b) => Number(b.change || 0) - Number(a.change || 0))
        break
      case 'losers':
        // Sort by negative price change ascending (most negative first, from orderbook trades)
        filtered.sort((a, b) => Number(a.change || 0) - Number(b.change || 0))
        break
      case 'all':
      default:
        // Prioritize pairs with trading data, then sort by volume
        filtered.sort((a, b) => {
          const aHas = hasTradingData(a);
          const bHas = hasTradingData(b);
          if (aHas !== bHas) {
            return bHas - aHas;
          }
          const aVol = Number((a.volume || '0').replace(/,/g, ''));
          const bVol = Number((b.volume || '0').replace(/,/g, ''));
          return bVol - aVol;
        })
        break
    }

    return filtered
  }, [pairs, searchResults, filterType, searchQuery, isSearching])

  // Pagination logic
  const totalPages = Math.ceil(filteredPairs.length / itemsPerPage)
  const paginatedPairs = useMemo(() => {
    if (isSearching) return filteredPairs
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return filteredPairs.slice(startIndex, endIndex)
  }, [filteredPairs, currentPage, itemsPerPage, isSearching])

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
    setPairsPage(1)
  }, [searchQuery, selectedNetwork])

  const loadMarkets = async (page = 1) => {
    // Loading state is now managed by useEffect to show skeleton on network change
    try {
      // Fetch two pages (limit=50 each) in parallel to load up to 100 pairs
      const buildUrl = (pg) => `${INDEXER_BASE}/api/markets/wbnb/new?network=${selectedNetwork}&pages=3&duration=1h&page=${pg}&limit=50`
      const [res1, res2] = await Promise.all([
        fetch(buildUrl(1)),
        fetch(buildUrl(2))
      ])
      if (!res1.ok) throw new Error(`HTTP ${res1.status}`)
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`)
      const [json1, json2] = await Promise.all([res1.json(), res2.json()])
      const data1 = Array.isArray(json1.data) ? json1.data : []
      const data2 = Array.isArray(json2.data) ? json2.data : []
      const merged = [...data1, ...data2]
      // Dedupe by normalized pair key (base/quote addresses)
      const seen = new Set()
      const deduped = merged.filter(m => {
        const b = (m.base?.address || '').toLowerCase()
        const q = (m.quote?.address || '').toLowerCase()
        if (!b || !q) return false
        const key = b < q ? `${b}_${q}` : `${q}_${b}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      setPairs(deduped)
      // Prefer total from the first page if available
      const total = (json1.total || 0)
      setPairsTotal(total)
      setPairsPage(page)
      // Clear any previous error on successful load
      if (pairsError) setPairsError('')
    } catch (e) {
      console.error('Markets fetch error:', e)
      // Only set error if not already set, to avoid UI flicker
      if (!pairsError) setPairsError(e?.message || String(e))
    } finally {
      setPairsLoading(false)
    }
  }


  useEffect(() => {
    // Show loading on initial load or network change
    setPairsLoading(true)
    loadMarkets(pairsPage)

    // Add realtime polling for market prices and volumes (only current page)
    const marketsInterval = setInterval(() => {
      loadMarkets(pairsPage).catch(() => {})
    }, 30000) // Poll markets every 30 seconds for price/volume updates

    return () => clearInterval(marketsInterval)
  }, [selectedNetwork, pairsPage])

  const onSelectPair = async (p) => {
    console.log('[NETWORK DEBUG] Pair selected:', p.pair, 'Network:', p.network)
    setSelected(p)
    setBaseToken(p.base)
    setQuoteToken(p.quote)
    if (p.network === 'crosschain' || (p.base?.network && p.quote?.network && p.base.network !== p.quote.network)) {
      console.log('[NETWORK DEBUG] Setting network to crosschain')
      setSelectedNetwork('crosschain')
    } else {
      const newNetwork = p.network || 'bsc'
      console.log('[NETWORK DEBUG] Setting network to:', newNetwork)
      setSelectedNetwork(newNetwork)
    }
    await refreshTokenMeta(p.base.address, p.quote.address)
    if (p.geckoPoolId) setGeckoPoolId(p.geckoPoolId)
    setView('trade')
  }

  // Global markets search effect (fetch backend when typing)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const q = (searchQuery || '').trim()
      if (!q) {
        setSearchResults([])
        setSearchError('')
        setSearchLoading(false)
        return
      }
      setSearchLoading(true)
      setSearchError('')
      try {
        const fetchNet = async (net) => {
          const url = `${INDEXER_BASE}/api/markets/search?network=${net}&q=${encodeURIComponent(q)}`
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const json = await res.json()
          return Array.isArray(json.data) ? json.data : []
        }
        let results = []
        if (selectedNetwork === 'crosschain') {
          const [bsc, base] = await Promise.all([
            fetchNet('bsc'),
            fetchNet('base')
          ])
          const merged = [...bsc, ...base]
          const seen = new Set()
          results = merged.filter(m => {
            const key = `${m.network || ''}:${(m.poolAddress || '').toLowerCase() || (((m.base?.address || '').toLowerCase()) + '_' + ((m.quote?.address || '').toLowerCase()))}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
        } else {
          results = await fetchNet(selectedNetwork)
        }
        if (!cancelled) setSearchResults(results)
      } catch (e) {
        if (!cancelled) setSearchError(e?.message || String(e))
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }
    const t = setTimeout(run, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [searchQuery, selectedNetwork])

  //

  const loadOrderBook = async () => {
    try {
      if (!selected?.base?.address || !selected?.quote?.address) {
        console.log('[DESKTOP ORDERBOOK] Missing addresses:', selected)
        return
      }
      // Remove loading state for realtime updates to avoid UI flicker
      // setObLoading(true); setObError('')

      let allAsks = []
      let allBids = []

      const baseAddr = selectedNetwork === 'solana' ? selected.base.address : selected.base.address.toLowerCase()
      const quoteAddr = selectedNetwork === 'solana' ? selected.quote.address : selected.quote.address.toLowerCase()
      const url = `${INDEXER_BASE}/api/orders?network=${selectedNetwork}&base=${baseAddr}&quote=${quoteAddr}`

      console.log('[DESKTOP ORDERBOOK] Loading orderbook for network:', selectedNetwork)
      console.log('[DESKTOP ORDERBOOK] Base address:', baseAddr)
      console.log('[DESKTOP ORDERBOOK] Quote address:', quoteAddr)
      console.log('[DESKTOP ORDERBOOK] URL:', url)

      const res = await fetch(url)
      console.log('[DESKTOP ORDERBOOK] Response status:', res.status)

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()

      console.log('[DESKTOP ORDERBOOK] Response data:', json)

      allAsks = (Array.isArray(json.asks) ? json.asks : []).filter(o => {
        const tag = String(o?.type || o?.tag || '').toLowerCase();
        return tag === 'regular' || (!o?.isConditional && tag !== 'conditional');
      })
      allBids = (Array.isArray(json.bids) ? json.bids : []).filter(o => {
        const tag = String(o?.type || o?.tag || '').toLowerCase();
        return tag === 'regular' || (!o?.isConditional && tag !== 'conditional');
      })

      console.log('[DESKTOP ORDERBOOK] Asks count:', allAsks.length, 'Bids count:', allBids.length)

      setObAsks(allAsks)
      setObBids(allBids)
      // Clear any previous error on successful load
      if (obError) setObError('')
    } catch (e) {
      console.error('[DESKTOP ORDERBOOK] Error:', e)
      // Only set error if not already set, to avoid UI flicker
      if (!obError) setObError(e?.message || String(e))
    } finally {
      // setObLoading(false)
    }
  }

  const loadRecentFills = async () => {
    console.log('[DEBUG] loadRecentFills called, selectedNetwork:', selectedNetwork, 'selected:', selected)
    try {
      if (!selected?.base?.address || !selected?.quote?.address) {
        console.log('[DEBUG] loadRecentFills: no selected base/quote, returning')
        return
      }
      // Remove loading state for realtime updates to avoid UI flicker
      // setFillsLoading(true); setFillsError('')

      let allFills = []

      const baseAddr = selectedNetwork === 'solana' ? selected.base.address : selected.base.address.toLowerCase()
      const quoteAddr = selectedNetwork === 'solana' ? selected.quote.address : selected.quote.address.toLowerCase()
      const url = `${INDEXER_BASE}/api/fills?network=${selectedNetwork}&base=${baseAddr}&quote=${quoteAddr}&limit=500`
      console.log('[DEBUG] loadRecentFills: calling API with URL:', url)
      const res = await fetch(url)
      console.log('[DEBUG] loadRecentFills: response ok:', res.ok, 'status:', res.status)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      console.log('[DEBUG] loadRecentFills: API response data length:', json.data?.length || 0)
      allFills = Array.isArray(json.data) ? json.data : []
      console.log('[DEBUG] loadRecentFills: parsed fills:', allFills.length, 'items')

      setRecentFills(allFills)
      console.log('[DEBUG] loadRecentFills: set recentFills to length:', allFills.length)

      // Calculate trading stats from fills
      if (allFills.length > 0) {
        // Current price is the latest fill price, adjusted for decimals
        const latestFill = allFills[0] // already sorted by created_at desc
        const latestPrice = (Number(latestFill.amountQuote) / (10 ** quoteDecimals)) / (Number(latestFill.amountBase) / (10 ** baseDecimals))
        setCurrentPrice(formatPrice(latestPrice))

        // 24h volume: sum of all fills in last 24h, adjusted for decimals
        const now = Date.now()
        const oneDayAgo = now - 24 * 60 * 60 * 1000
        const recentFills24h = allFills.filter(f => new Date(f.createdAt).getTime() > oneDayAgo)
        const totalVolume = recentFills24h.reduce((sum, f) => sum + Number(f.amountQuote) / (10 ** quoteDecimals), 0)
        setVolume24h(totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 }))

        // Price change: compare latest price to price 24h ago
        if (recentFills24h.length > 1) {
          const oldestFill = recentFills24h[recentFills24h.length - 1]
          const oldestPrice = (Number(oldestFill.amountQuote) / (10 ** quoteDecimals)) / (Number(oldestFill.amountBase) / (10 ** baseDecimals))
          const change = ((latestPrice - oldestPrice) / oldestPrice) * 100
          setPriceChange(formatNumberFixed(change, 2))
        } else {
          setPriceChange('0.00')
        }
      } else {
        // Fallback to market price if no fills
        const marketPrice = selected?.price && selected.price !== '-' ? selected.price : '0.00'
        const marketChange = selected?.change ? selected.change : '0.00'
        setCurrentPrice(marketPrice)
        setPriceChange(marketChange)
        setVolume24h('0')
      }
      // Clear any previous error on successful load
      if (fillsError) setFillsError('')
    } catch (e) {
      console.error('[DEBUG] loadRecentFills: error:', e)
      // Only set error if not already set, to avoid UI flicker
      if (!fillsError) setFillsError(e?.message || String(e))
    } finally {
      // setFillsLoading(false)
    }
  }

  const loadMyOrders = async () => {
    try {
      if (!account) return
      console.log('[DEBUG] loadMyOrders called, account:', account, 'selectedNetwork:', selectedNetwork)
      // setMyOpenOrdersLoading(true); setMyOpenOrdersError('')

      const makerParam = selectedNetwork === 'solana' ? account : account.toLowerCase()

      // Fetch all orders for the maker
      const url = `${INDEXER_BASE}/api/orders?network=${selectedNetwork}&maker=${makerParam}&status=open,cancelled,filled`
      console.log('[DEBUG] Fetching regular orders from:', url)
      const res = await fetch(url)
      let allOrders = []
      if (res.ok) {
        const json = await res.json()
        allOrders = Array.isArray(json.data) ? json.data : []
        // Filter to only regular orders
        allOrders = allOrders.filter(o => {
          const tag = String(o?.type || o?.tag || '').toLowerCase();
          return tag === 'regular' || (!o?.isConditional && tag !== 'conditional');
        })
        console.log('[DEBUG] Regular orders fetched:', allOrders.length)
      } else {
        console.log('[DEBUG] Regular orders fetch failed:', res.status)
      }

      // Conditional orders (treated as open/pending by default)
      const conditionalOrders = []
      const conditionalWithStatus = (conditionalOrders || []).map(c => {
        let order_template = c.order_template
        if (typeof order_template === 'string') {
          try {
            order_template = JSON.parse(order_template)
          } catch (e) {
            console.error('Failed to parse order_template:', e)
            order_template = null
          }
        }
        return { ...c, isConditional: true, status: c.status || 'open', order_template }
      })
      console.log('[DEBUG] Conditional orders after processing:', conditionalWithStatus.length)

      // Merge and dedupe by order_id
      const merged = [...allOrders, ...conditionalWithStatus]
      console.log('[DEBUG] Total merged orders:', merged.length)
      const byId = new Map()
      for (const o of merged) {
        const id = o.order_id || o.orderId || o.id || o.conditional_order_id
        if (!id) continue
        const existing = byId.get(id)
        if (!existing) byId.set(id, o)
        else {
          // Prefer non-open statuses and the one with newer timestamp
          const exStatus = (existing.status || '').toLowerCase()
          const newStatus = (o.status || '').toLowerCase()
          const rank = (s) => (s === 'filled' ? 2 : s === 'cancelled' ? 1 : 0)
          const exTs = new Date(existing.updated_at || existing.created_at || 0).getTime()
          const newTs = new Date(o.updated_at || o.created_at || 0).getTime()
          if (rank(newStatus) > rank(exStatus) || newTs > exTs) byId.set(id, o)
        }
      }
      let allOrdersRaw = Array.from(byId.values())
      console.log('[DEBUG] After dedupe:', allOrdersRaw.length)


      // Sort by updated_at/created_at desc
      allOrdersRaw.sort((a, b) => {
        const ta = new Date(a.updated_at || a.created_at || 0).getTime()
        const tb = new Date(b.updated_at || b.created_at || 0).getTime()
        return tb - ta
      })

      // Format orders for display (preserve status)
      const formattedOrders = []
      for (const order of allOrdersRaw) {
        const formatted = await formatOrder(order)
        if (formatted) {
          formattedOrders.push({ ...formatted, status: order.status || formatted.status || 'open' })
        } else {
          console.log('[DEBUG] formatOrder returned null for order:', order.id || order.conditional_order_id)
        }
      }
      console.log('[DEBUG] Formatted orders:', formattedOrders.length)

      setMyOpenOrders(formattedOrders)
      if (myOpenOrdersError) setMyOpenOrdersError('')
    } catch (e) {
      console.error('[DEBUG] loadMyOrders error:', e)
      if (!myOpenOrdersError) setMyOpenOrdersError(e?.message || String(e))
    } finally {
      // setMyOpenOrdersLoading(false)
    }
  }

  const loadMyWatchlist = async () => {
    try {
      if (!account) return
      setMyWatchlistLoading(true)
      setMyWatchlistError('')
      const url = `${INDEXER_BASE}/api/watchlist/markets?user_id=${account}&network=${selectedNetwork}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      // Deduplicate markets by pair and network
      let markets = (json.data || []).filter((market, index, self) =>
        index === self.findIndex(m => m.pair === market.pair && m.network === market.network)
      )
      // Filter by selected network (show all for crosschain, else filter by network)
      if (selectedNetwork !== 'crosschain') {
        markets = markets.filter(market => market.network === selectedNetwork)
      }
      setMyWatchlist(markets)
    } catch (e) {
      console.error('Failed to load watchlist:', e)
      setMyWatchlistError(e?.message || String(e))
    } finally {
      setMyWatchlistLoading(false)
    }
  }

  // Load my watchlist when entering the view and when account/network changes
  useEffect(() => {
    if (view === 'myWatchlist') {
      loadMyWatchlist();
    }
  }, [view, account, selectedNetwork]);

  const loadUserWatchlist = async () => {
    if (!account) return
    try {
      const url = `${INDEXER_BASE}/api/watchlist?user_id=${account}&network=${selectedNetwork}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setUserWatchlist(json.data || [])
    } catch (e) {
      console.error('Failed to load user watchlist:', e)
    }
  }

  const toggleWatchlist = async (pair) => {
    if (!account) return
    try {
      const isInWatchlist = userWatchlist.some(w => w.pair === pair.pair && w.network === pair.network)
      const url = isInWatchlist ? `${INDEXER_BASE}/api/watchlist/remove` : `${INDEXER_BASE}/api/watchlist/add`
      const body = {
        user_id: account,
        pair: pair.pair,
        network: pair.network,
        pool_address: pair.pool_address || null
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Update local state
      if (isInWatchlist) {
        setUserWatchlist(prev => prev.filter(w => !(w.pair === pair.pair && w.network === pair.network)))
      } else {
        setUserWatchlist(prev => [...prev, { pair: pair.pair, network: pair.network, pool_address: pair.pool_address }])
      }
    } catch (e) {
      console.error('Failed to toggle watchlist:', e)
    }
  }

  // Helper to get order ID from order object
  const getOrderId = (order) => {
    if (order.order_id || order.orderId) return order.order_id || order.orderId
    // Fallback: generate order ID like the server does
    const crypto = window.crypto || window.msCrypto
    if (!crypto) return 'unknown'
    const data = JSON.stringify({
      maker: order.maker,
      nonce: order.nonce,
      tokenIn: order.tokenIn,
      tokenOut: order.tokenOut,
      salt: order.salt
    })
    return crypto.subtle.digest('SHA-1', new TextEncoder().encode(data)).then(hash => {
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
    })
  }

  useEffect(() => {
    if (view !== 'trade') return
    // Initial load when entering trade view or when pair/account changes
    loadOrderBook()
    loadRecentFills()
    loadMyOrders()
    fetchBalances()

    // Add realtime polling for orderbook, fills, and trading stats
    const orderbookInterval = setInterval(() => {
      loadOrderBook().catch(() => {})
    }, 10000) // Poll orderbook every 10 seconds

    const fillsInterval = setInterval(() => {
      loadRecentFills().catch(() => {})
    }, 5000) // Poll fills every 5 seconds

    const myOrdersInterval = setInterval(() => {
      loadMyOrders().catch(() => {})
    }, 15000) // Poll my orders every 15 seconds

    return () => {
      clearInterval(orderbookInterval)
      clearInterval(fillsInterval)
      clearInterval(myOrdersInterval)
    }
  }, [view, selected?.base?.address, selected?.quote?.address, account])

  // Reset fills page when new fills are loaded
  useEffect(() => {
    setFillsCurrentPage(1)
  }, [recentFills.length])

  // Load global DEX stats
  const loadGlobalStats = async () => {
    setGlobalStatsLoading(true)
    setGlobalStatsError('')
    try {
      const res = await fetch(`${INDEXER_BASE}/api/stats/global`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setGlobalStats(data)
    } catch (e) {
      console.error('Failed to load global stats:', e)
      setGlobalStatsError(e?.message || String(e))
    } finally {
      setGlobalStatsLoading(false)
    }
  }

  // Load global stats on mount and periodically
  useEffect(() => {
    loadGlobalStats()
    const interval = setInterval(loadGlobalStats, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [])

  // Load my open orders when in myOrders view
  useEffect(() => {
    if (view === 'myOrders') {
      loadMyOrders();
    }
  }, [view, account, selectedNetwork]);

  // Load my watchlist when in myWatchlist view
  useEffect(() => {
    if (view === 'myWatchlist') {
      loadMyWatchlist();
    }
  }, [view, account, selectedNetwork]);

  // Load user watchlist for toggle buttons
  useEffect(() => {
    loadUserWatchlist();
  }, [account, selectedNetwork]);

  // ============ Trade actions (approvals, signing, fills) ============
  const onApprove = async () => {
    try {
      // For crosschain manual approve, switch to the token's network
      if (selectedNetwork === 'crosschain') {
        const tokenToApprove = approveToken === 'base' ? baseToken : quoteToken
        const networkForApproval = tokenToApprove.network
        await switchToNetwork(networkForApproval)
      } else {
        await switchToNetwork(selectedNetwork)
      }
      const tokenAddr = approveToken === 'base' ? baseToken.address : quoteToken.address
      const decs = approveToken === 'base' ? baseDecimals : quoteDecimals
      const erc = await getErc20(tokenAddr, true)
      const isCrossChainPair = selected?.network === 'crosschain' || (baseToken.network && quoteToken.network && baseToken.network !== quoteToken.network)
      const spenderAddr = isCrossChainPair ? '0x70c992e6a19c565430fa0c21933395ebf1e907c3' : (selectedNetwork === 'base' ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS)
      console.log(`[frontend] Manual approve: approving ${tokenAddr} for spender ${spenderAddr} on network ${selectedNetwork} (isCrossChain: ${isCrossChainPair})`)
      const amt = parseUnits(approveAmount || '0', decs)
      const tx = await erc.approve(spenderAddr, amt)
      setStatus(`Approve sent: ${tx.hash}. Waiting...`)
      await tx.wait()
      setStatus(`Approve confirmed for ${spenderAddr}`)
    } catch (e) {
      console.error(e)
      setStatus(`Approve failed: ${e.shortMessage ?? e.message ?? e}`)
    }
  }

  // Check allowance and update UI state
  const checkAndUpdateAllowance = async () => {
    try {
      console.log(`[debug] checkAndUpdateAllowance called: account ${account}, tradeSide ${tradeSide}, amountIn ${amountIn}, selectedNetwork ${selectedNetwork}, isCrossChain ${isCrossChainPair}, isConditional ${isConditional}`)
      if (!account || !provider) return


      const isSell = tradeSide === 'sell'
      const tokenAddr = isSell ? baseToken.address : quoteToken.address
      const decs = isSell ? baseDecimals : quoteDecimals
      if (!tokenAddr || !decs) return

      const spender = isCrossChainPair ? '0x70c992e6a19c565430fa0c21933395ebf1e907c3' : (selectedNetwork === 'base' ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS)
      console.log(`[debug] Checking allowance: token ${tokenAddr}, spender ${spender}, isCrossChain ${isCrossChainPair}`)
      const erc = await getErc20(tokenAddr)

      // Determine required allowance from amountIn input
      const requiredStr = amountIn && Number(amountIn) > 0 ? amountIn : '0'
      const required = parseUnits(requiredStr, decs)

      // If required is 0, no approval needed (except for crosschain, but since required 0, no)
      if (required === 0n && !isCrossChainPair) {
        setNeedsApproval(false)
        setSmartLabel('Sign Order')
        return
      }

      const current = await erc.allowance(account, spender)
      console.log(`[debug] Allowance result: ${current} for token ${tokenAddr}, spender ${spender}, account ${account}`)
      const need = (typeof current === 'bigint' ? current : BigInt(current?.toString?.() || '0')) < required
      console.log(`[debug] Allowance check: token ${tokenAddr}, spender ${spender}, account ${account}, current ${current}, required ${required}, need ${need}, isCrossChain ${isCrossChainPair}`)
      setNeedsApproval(need)
      setSmartLabel(need ? t('app.approveSign') : t('app.signOrder'))
    } catch (e) {
      console.log('[debug] checkAndUpdateAllowance error:', e)
      // On error, default to requiring approval to be safe
      setNeedsApproval(true)
      setSmartLabel('Approve + Sign')
    }
  }

  // Unified smart action: Approve if needed then Sign or Create Conditional
  const onSmartApproveThenSign = async () => {
    if (smartBusy) return
    setSmartBusy(true)
    try {
      if (selectedNetwork === 'crosschain') {
        // For crosschain, switch to the network of the token being approved
        const tokenToApprove = approveToken === 'base' ? baseToken : quoteToken
        const networkForApproval = tokenToApprove.network || TOKENS.find(t => t.address.toLowerCase() === tokenToApprove.address.toLowerCase())?.network || 'bsc'
        await switchToNetwork(networkForApproval)
      } else {
        await switchToNetwork(selectedNetwork)
      }

      // Recheck allowance just before acting
      await checkAndUpdateAllowance()

      if (needsApproval) {
        const isSell = tradeSide === 'sell'
        const tokenAddr = isSell ? baseToken.address : quoteToken.address
        const decs = isSell ? baseDecimals : quoteDecimals
        const spender = isCrossChainPair ? '0x70c992e6a19c565430fa0c21933395ebf1e907c3' : (selectedNetwork === 'base' ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS)
        console.log(`[frontend] Approving ${tokenAddr} for spender ${spender} on network ${selectedNetwork} (isCrossChain: ${isCrossChainPair})`)
        const erc = await getErc20(tokenAddr, true)
        const requiredStr = amountIn && Number(amountIn) > 0 ? amountIn : '0'
        const required = parseUnits(requiredStr, decs)
        console.log(`[debug] Approving: token ${tokenAddr}, spender ${spender}, required ${required}, amountIn ${amountIn}, decs ${decs}`)

        // Approve unlimited for crosschain to avoid re-approval
        const approveAmount = isCrossChainPair ? MaxUint256 : required
        const tx = await erc.approve(spender, approveAmount)
        setStatus(`Approve sent: ${tx.hash}. Waiting...`)
        await tx.wait()
        setStatus('Approve confirmed')
        // Wait a bit for blockchain to update
        await new Promise(resolve => setTimeout(resolve, 3000))
      }

      // After approval (if any), create conditional or sign order
      if (isConditional) {
        await createConditionalOrder()
      } else {
        await signOrder()
      }

      // Update allowance state post actions
      await checkAndUpdateAllowance()
    } catch (e) {
      console.error(e)
      setStatus(`Action failed: ${e.shortMessage ?? e.message ?? e}`)
    } finally {
      setSmartBusy(false)
    }
  }

  const randomizeSalt = () => {
    try {
      const crypto = window.crypto || window.msCrypto
      const buf = new Uint32Array(2)
      crypto.getRandomValues(buf)
      const s = (BigInt(buf[0]) << 32n) + BigInt(buf[1])
      setSalt(s.toString())
    } catch {
      setSalt((Date.now()).toString())
    }
  }

  const buildOrder = async () => {
    let makerAddr = account
    if (!makerAddr) {
      try {
        const s = await getSigner()
        makerAddr = await s.getAddress()
      } catch {}
    }
    if (!makerAddr) throw new Error('Connect first')

    // Ensure decimals are loaded before building order
    if (baseDecimals === 18 && quoteDecimals === 18) {
      // If both are default 18, try to refresh them
      await refreshTokenMeta(baseToken.address, quoteToken.address)
    }

    const now = Math.floor(Date.now() / 1000)
    const exp = now + Number(expirationMins || '0') * 60
    const isSell = tradeSide === 'sell'
    const tokenInAddr = isSell ? baseToken.address : quoteToken.address
    const tokenOutAddr = isSell ? quoteToken.address : baseToken.address

    // Use the fetched decimals from state
    const inDecimals = isSell ? baseDecimals : quoteDecimals
    const outDecimals = isSell ? quoteDecimals : baseDecimals

    const amountInParsed = parseUnits(amountIn || '0', inDecimals)
    const amountOutMinParsed = parseUnits(amountOutMin || '0', outDecimals)
    const ord = {
      maker: makerAddr,
      tokenIn: tokenInAddr,
      tokenOut: tokenOutAddr,
      amountIn: amountInParsed,
      amountOutMin: amountOutMinParsed,
      expiration: BigInt(exp),
      nonce: BigInt(nonce || '0'),
      receiver: receiver || makerAddr,
      salt: BigInt(salt || '0')
    }
    return ord
  }

  const createConditionalOrder = async () => {
    try {
      if (selectedNetwork === 'solana') {
        // For Solana, sign the conditional order
        if (!primaryWallet?.signMessage) {
          throw new Error('Solana wallet not connected or does not support signing')
        }
        const ord = await buildOrder()
        const orderTemplate = JSON.parse(JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
        const expirationDate = conditionalExpiration ? new Date(Date.now() + Number(conditionalExpiration) * 24 * 60 * 60 * 1000).toISOString() : null

        // Sign the conditional order data
        const conditionalData = {
          network: selectedNetwork,
          maker: account,
          baseToken: selectedNetwork === 'solana' ? (selected?.base?.address || baseToken.address) : (selected?.base?.address || baseToken.address).toLowerCase(),
          quoteToken: selectedNetwork === 'solana' ? (selected?.quote?.address || quoteToken.address) : (selected?.quote?.address || quoteToken.address).toLowerCase(),
          type: conditionalType,
          triggerPrice: triggerPrice,
          orderTemplate: orderTemplate,
          expiration: expirationDate
        }
        const message = JSON.stringify(conditionalData)
        const encodedMessage = new TextEncoder().encode(message)
        const signature = await primaryWallet.signMessage(encodedMessage)

        const payload = {
          ...conditionalData,
          signature: signature
        }

        const resp = await fetch(`${INDEXER_BASE}/api/conditional-orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!resp.ok) {
          let errBody = ''
          try { errBody = await resp.text() } catch {}
          throw new Error(`conditional order post HTTP ${resp.status}${errBody ? `: ${errBody}` : ''}`)
        }
        const rjson = await resp.json()
        setStatus(`Conditional order created: ${rjson.id || 'ok'}`)
        // Refresh orders
        setTimeout(() => {
          loadMyOpenOrders().catch(() => {})
        }, 1000)
        return
      }

      if (selectedNetwork !== 'crosschain') {
        await switchToNetwork(selectedNetwork)
      }
      // For crosschain, sign on current network
      const s = await getSigner()
      const makerAddr = await s.getAddress()
      const ord = await buildOrder()

      const currentNet = await provider.getNetwork()
      // Sign the order template
      const targetChainId = isCrossChainPair ? Number(currentNet.chainId) : (selectedNetwork === 'base' ? BASE_CHAIN_ID : BSC_CHAIN_ID)
      const settlementAddr = isCrossChainPair ? (Number(currentNet.chainId) === BASE_CHAIN_ID ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS) : (selectedNetwork === 'base' ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS)
      const domain = { name: 'MinimalOrderBook', version: '1', chainId: targetChainId, verifyingContract: settlementAddr }
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
      const signature = await s.signTypedData(domain, types, ord)

      // Serialize the order template and signature
      const orderTemplate = JSON.parse(JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))

      const expirationDate = conditionalExpiration ? new Date(Date.now() + Number(conditionalExpiration) * 24 * 60 * 60 * 1000).toISOString() : null

      const payload = {
        network: selectedNetwork,
        maker: makerAddr,
        baseToken: selectedNetwork === 'solana' ? (selected?.base?.address || baseToken.address) : (selected?.base?.address || baseToken.address).toLowerCase(),
        quoteToken: selectedNetwork === 'solana' ? (selected?.quote?.address || quoteToken.address) : (selected?.quote?.address || quoteToken.address).toLowerCase(),
        type: conditionalType,
        triggerPrice: triggerPrice,
        orderTemplate: orderTemplate,
        signature: signature,
        expiration: expirationDate
      }

      const resp = await fetch(`${INDEXER_BASE}/api/conditional-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!resp.ok) {
        let errBody = ''
        try { errBody = await resp.text() } catch {}
        throw new Error(`conditional order post HTTP ${resp.status}${errBody ? `: ${errBody}` : ''}`)
      }
      const rjson = await resp.json()
      setStatus(`Conditional order created: ${rjson.id || 'ok'}`)
      // Refresh orders
      setTimeout(() => {
        loadMyOpenOrders().catch(() => {})
      }, 1000)
    } catch (e) {
      console.error(e)
      setStatus(`Conditional order failed: ${e?.message || e}`)
    }
  }

  const signOrder = async () => {
    try {
      if (selectedNetwork === 'solana') {
        // For Solana, use Jupiter Trigger Order API
        if (!primaryWallet) {
          throw new Error('Wallet not connected')
        }
        const ord = await buildOrder()
        const isSell = tradeSide === 'sell'
        const inputMint = isSell ? baseToken.address : quoteToken.address
        const outputMint = isSell ? quoteToken.address : baseToken.address
        const makingAmount = ord.amountIn.toString()
        const takingAmount = ord.amountOutMin.toString()

        // Call Jupiter createOrder
        const createPayload = {
          inputMint,
          outputMint,
          maker: account,
          payer: account,
          params: {
            makingAmount,
            takingAmount,
            expiredAt: ord.expiration.toString(),
            slippageBps: '0'
          },
          wrapAndUnwrapSol: true,
          computeUnitPrice: 'auto'
        }
        const createResp = await fetch('https://api.jup.ag/trigger/v1/createOrder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createPayload)
        })
        if (!createResp.ok) {
          const err = await createResp.json()
          throw new Error(`Jupiter createOrder failed: ${err.error || createResp.status}`)
        }
        const createData = await createResp.json()
        const unsignedTxBase64 = createData.transaction
        const requestId = createData.requestId

        // Deserialize and sign the transaction
        const unsignedTx = Transaction.from(Buffer.from(unsignedTxBase64, 'base64'))
        const signedTx = await primaryWallet.signTransaction(unsignedTx)
        const signedTxBase64 = signedTx.serialize().toString('base64')

        // Execute the order
        const executeResp = await fetch('https://api.jup.ag/trigger/v1/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            signedTransaction: signedTxBase64
          })
        })
        if (!executeResp.ok) {
          const err = await executeResp.json()
          throw new Error(`Jupiter execute failed: ${err.error || executeResp.status}`)
        }
        const executeData = await executeResp.json()
        const signature = executeData.signature
        setSignature(signature)
        setStatus('Order executed on Jupiter')

        // Post order to backend for storage in Supabase
        try {
          const payload = {
            network: selectedNetwork,
            base: selected?.base?.address || baseToken.address,
            quote: selected?.quote?.address || quoteToken.address,
            baseSymbol: selected?.base?.symbol || baseToken.symbol,
            quoteSymbol: selected?.quote?.symbol || quoteToken.symbol,
            order: JSON.parse(JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
            signature: signature,
            jupiterRequestId: requestId,
            jupiterOrderKey: createData.order
          }
          const resp = await fetch(`${INDEXER_BASE}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
          if (!resp.ok) {
            let errBody = ''
            try { errBody = await resp.text() } catch {}
            throw new Error(`order post HTTP ${resp.status}${errBody ? `: ${errBody}` : ''}`)
          }
          const rjson = await resp.json()
          setStatus(`Order executed and posted: ${rjson.id || 'ok'}`)
          if (rjson?.id) {
            setLastPlacedOrderId(rjson.id)
            setLastOrderSignedAt(new Date().toISOString())
            setLastTxHash(signature) // Use Jupiter signature
          }
          // Add small delay to allow order processing before refreshing
          setTimeout(() => {
            loadOrderBook().catch(() => {})
            loadMyOpenOrders().catch(() => {})
          }, 1000)
        } catch (postErr) {
          console.error(postErr)
          setStatus(`Order posted failed: ${postErr?.message || postErr}`)
        }
        return
      }

      if (selectedNetwork !== 'crosschain') {
        await switchToNetwork(selectedNetwork)
      }
      // For crosschain, sign on current network
      const s = await getSigner()
      const ord = await buildOrder()
      const currentNet = await provider.getNetwork()
      // Use correct chainId and settlement address for the selected network
      const targetChainId = isCrossChainPair ? Number(currentNet.chainId) : (selectedNetwork === 'base' ? BASE_CHAIN_ID : BSC_CHAIN_ID)
      const settlementAddr = isCrossChainPair ? (Number(currentNet.chainId) === BASE_CHAIN_ID ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS) : (selectedNetwork === 'base' ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS)

      // Ensure we're on the correct network before signing
      let signer = s
      if (selectedNetwork !== 'crosschain' && Number(currentNet.chainId) !== targetChainId) {
        await switchToNetwork(selectedNetwork)
        // Re-get signer after switch
        signer = await getSigner()
        const currentNetNew = await provider.getNetwork()
        if (Number(currentNetNew.chainId) !== targetChainId) {
          throw new Error(`Failed to switch to ${selectedNetwork} network. Please switch manually in your wallet.`)
        }
      }

      const domain = { name: 'MinimalOrderBook', version: '1', chainId: targetChainId, verifyingContract: settlementAddr }
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
      const sig = await signer.signTypedData(domain, types, ord)
      // Keep a copy of the last signed order for cancellation
      setLastSignedOrder(JSON.parse(JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))))
      // Safely serialize BigInt fields for display
      setOrderJson(JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
      setSignature(sig)
      setStatus('Order signed')

      // Post order to backend for storage in Supabase
      try {
        const payload = {
          network: selectedNetwork,
          base: selectedNetwork === 'solana' ? (selected?.base?.address || baseToken.address) : (selected?.base?.address || baseToken.address).toLowerCase(),
          quote: selectedNetwork === 'solana' ? (selected?.quote?.address || quoteToken.address) : (selected?.quote?.address || quoteToken.address).toLowerCase(),
          baseSymbol: selected?.base?.symbol || baseToken.symbol,
          quoteSymbol: selected?.quote?.symbol || quoteToken.symbol,
          order: JSON.parse(JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
          signature: sig
        }
        const resp = await fetch(`${INDEXER_BASE}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!resp.ok) {
          let errBody = ''
          try { errBody = await resp.text() } catch {}
          throw new Error(`order post HTTP ${resp.status}${errBody ? `: ${errBody}` : ''}`)
        }
        const rjson = await resp.json()
        setStatus(`Order signed and posted: ${rjson.id || 'ok'}`)
        if (rjson?.id) {
          setLastPlacedOrderId(rjson.id)
          setLastOrderSignedAt(new Date().toISOString())
          setLastTxHash(null) // Reset for new order
        }
        // Add small delay to allow order processing before refreshing
        setTimeout(() => {
          loadOrderBook().catch(() => {})
          loadMyOpenOrders().catch(() => {})
        }, 1000)
      } catch (postErr) {
        console.error(postErr)
        setStatus(`Order posted failed: ${postErr?.message || postErr}`)
      }
    } catch (e) {
      console.error(e)
      setStatus(`Sign failed: ${e.shortMessage ?? e.message ?? e}`)
    }
  }

  // Cancel last signed order on-chain
  const onCancelOrder = async () => {
    try {
      if (!lastSignedOrder) {
        setStatus('No order to cancel')
        return
      }
      if (selectedNetwork !== 'crosschain') {
        await switchToNetwork(selectedNetwork)
      }
      const c = await getContract(true)
      // Convert fields back to BigInt for contract call
      const ord = { ...lastSignedOrder }
      ord.amountIn = BigInt(ord.amountIn)
      ord.amountOutMin = BigInt(ord.amountOutMin)
      ord.expiration = BigInt(ord.expiration)
      ord.nonce = BigInt(ord.nonce)
      ord.salt = BigInt(ord.salt)
      const tx = await c.cancelOrder(ord)
      setStatus(`Cancel sent: ${tx.hash}. Waiting...`)
      await tx.wait()
      setStatus('Order cancelled')
      // Update order status in database via API
      try {
        const orderId = await getOrderId(ord)
        await fetch(`${INDEXER_BASE}/api/orders/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, network: selectedNetwork })
        })
      } catch (apiErr) {
        console.warn('Failed to update order status in DB:', apiErr)
      }
      // Clear local refs and refresh orderbook
      setLastSignedOrder(null)
      loadOrderBook().catch(() => {})
      loadMyOpenOrders().catch(() => {})
    } catch (e) {
      console.error(e)
      setStatus(`Cancel failed: ${e.shortMessage ?? e.message ?? e}`)
    }
  }

  // Cancel a specific order from the list
  const onCancelSpecificOrder = async (order) => {
    try {
      if (order.status === 'filled' || order.status === 'cancelled') {
        toast.error('Order is already filled or cancelled')
        return
      }
      const network = (selectedNetwork && selectedNetwork !== 'null') ? selectedNetwork : 'bsc';
      const INDEXER_BASE = import.meta?.env?.VITE_INDEXER_BASE || 'https://cookbook-hjnhgq.fly.dev';

      if (order.isConditional) {
        // Cancel conditional order
        const url = `${INDEXER_BASE}/api/conditional-orders/cancel`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: order.id, network })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else if (selectedNetwork === 'solana' && order.jupiterOrderKey) {
        // Cancel Jupiter order on Solana
        if (!primaryWallet) {
          throw new Error('Wallet not connected')
        }
        const cancelResp = await fetch('https://api.jup.ag/trigger/v1/cancelOrder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maker: account, order: order.jupiterOrderKey, computeUnitPrice: 'auto' })
        })
        if (!cancelResp.ok) {
          const err = await cancelResp.json()
          throw new Error(`Jupiter cancel failed: ${err.error || cancelResp.status}`)
        }
        const cancelData = await cancelResp.json()
        const unsignedTx = Transaction.from(Buffer.from(cancelData.transaction, 'base64'))
        const signedTx = await primaryWallet.signTransaction(unsignedTx)
        const signedTxBase64 = signedTx.serialize().toString('base64')
        const executeResp = await fetch('https://api.jup.ag/trigger/v1/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: cancelData.requestId, signedTransaction: signedTxBase64 })
        })
        if (!executeResp.ok) {
          const err = await executeResp.json()
          throw new Error(`Jupiter execute cancel failed: ${err.error || executeResp.status}`)
        }
        setStatus('Order cancelled on Jupiter')
      } else {
        // Cancel regular order on EVM
        if (selectedNetwork !== 'crosschain') {
          await switchToNetwork(selectedNetwork)
        }
        const c = await getContract(true)
        // Convert fields back to BigInt for contract call, with fallbacks
        const ord = { ...order }
        ord.amountIn = BigInt(ord.amountIn || '0')
        ord.amountOutMin = BigInt(ord.amountOutMin || '0')
        const expTime = new Date(ord.expiration).getTime()
        ord.expiration = BigInt(Math.floor((isNaN(expTime) ? Date.now() + 3600000 : expTime) / 1000)) // fallback to 1 hour from now
        ord.nonce = BigInt(ord.nonce || '0')
        ord.salt = BigInt(ord.salt || '0')
        const tx = await c.cancelOrder(ord)
        setStatus(`Cancel sent: ${tx.hash}. Waiting...`)
        await tx.wait()
        setStatus('Order cancelled')
      }

      // Update database for all networks
      const orderId = order.order_id || order.orderId || order.id
      const res = await fetch(`${INDEXER_BASE}/api/orders/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, network })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Update local state immediately to reflect the cancel
      setMyOpenOrders(prev => prev.filter(o => o.id !== order.id));

      // Refresh orderbook and my orders
      loadOrderBook().catch(() => {})
      loadMyOrders().catch(() => {})
    } catch (e) {
      console.error('Cancel failed:', e)
      toast.error(`Cancel failed: ${e.shortMessage ?? e.message ?? e}`)
      setStatus(`Cancel failed: ${e.shortMessage ?? e.message ?? e}`)
    }
  }

  const verifyOrderSig = async () => {
    try {
      const c = await getContract(false)
      const ord = parseOrderText(orderJson)
      ord.amountIn = BigInt(ord.amountIn)
      ord.amountOutMin = BigInt(ord.amountOutMin)
      ord.expiration = BigInt(ord.expiration)
      ord.nonce = BigInt(ord.nonce)
      ord.salt = BigInt(ord.salt)
      const ok = await c.verifySignature(ord, signature)
      setStatus(`Signature valid: ${ok}`)
    } catch (e) {
      console.error(e)
      setStatus(`Verify failed: ${e.message ?? e}`)
    }
  }

  const onAvailableToFill = async () => {
    try {
      const c = await getContract(false)
      const ord = parseOrderText(fillOrderJson || orderJson)
      ord.amountIn = BigInt(ord.amountIn)
      ord.amountOutMin = BigInt(ord.amountOutMin)
      ord.expiration = BigInt(ord.expiration)
      ord.nonce = BigInt(ord.nonce)
      ord.salt = BigInt(ord.salt)
      const avail = await c.availableToFill(ord)
      setStatus(`availableToFill: ${avail.toString()}`)
    } catch (e) {
      console.error(e)
      setStatus(`Check failed: ${e.message ?? e}`)
    }
  }

  const onFillOrder = async () => {
    try {
      if (selectedNetwork !== 'crosschain') {
        await switchToNetwork(selectedNetwork)
      }
      const c = await getContract(true)
      const ord = parseOrderText(fillOrderJson)
      ord.amountIn = BigInt(ord.amountIn)
      ord.amountOutMin = BigInt(ord.amountOutMin)
      ord.expiration = BigInt(ord.expiration)
      ord.nonce = BigInt(ord.nonce)
      ord.salt = BigInt(ord.salt)
      const tx = await c.fillOrder(
        ord,
        fillSignature,
        parseUnits(fillAmountIn || '0', baseDecimals),
        parseUnits(fillTakerMinOut || '0', quoteDecimals)
      )
      setStatus(`Fill sent: ${tx.hash}. Waiting...`)
      await tx.wait()
      const explorerUrl = selectedNetwork === 'base' ? 'https://basescan.org' : 'https://bscscan.com'
      setStatus(`Order filled: ${explorerUrl}/tx/${tx.hash}`)
    } catch (e) {
      console.error(e)
      setStatus(`Fill failed: ${e.shortMessage ?? e.message ?? e}`)
    }
  }

  const onMatchOrders = async () => {
    try {
      if (selectedNetwork !== 'crosschain') {
        await switchToNetwork(selectedNetwork)
      }
      const c = await getContract(true)
      const buy = parseOrderText(buyOrderJson)
      const sell = parseOrderText(sellOrderJson)
      for (const o of [buy, sell]) {
        o.amountIn = BigInt(o.amountIn)
        o.amountOutMin = BigInt(o.amountOutMin)
        o.expiration = BigInt(o.expiration)
        o.nonce = BigInt(o.nonce)
        o.salt = BigInt(o.salt)
      }
      const tx = await c.matchOrders(
        buy,
        buySig,
        sell,
        sellSig,
        parseUnits(amountBase || '0', quoteDecimals)
      )
      setStatus(`Match sent: ${tx.hash}. Waiting...`)
      await tx.wait()
      const explorerUrl = selectedNetwork === 'base' ? 'https://basescan.org' : 'https://bscscan.com'
      setStatus(`Orders matched: ${explorerUrl}/tx/${tx.hash}`)
    } catch (e) {
      console.error(e)
      setStatus(`Match failed: ${e.shortMessage ?? e.message ?? e}`)
    }
  }

  // Enforce selected network on mount and on chain changes
  useEffect(() => {
    const eth = (primaryWallet?.connector?.getProvider && primaryWallet.connector.getProvider()) || (hasMetaMask() ? window.ethereum : null)
    if (!eth) return

    const ensureNetwork = async () => {
      try { await switchToNetwork(selectedNetwork) } catch {}
    }

    const handler = (chainIdHex) => {
      const id = typeof chainIdHex === 'string' ? parseInt(chainIdHex, 16) : Number(chainIdHex)
      setChainId(id)
      if (selectedNetwork === 'crosschain') {
        // For cross-chain, allow both BSC and Base
        const networkName = id === BASE_CHAIN_ID ? 'Base' : 'BSC'
        setStatus(`Connected to ${networkName} (Cross-Chain Mode)`)
      } else {
        const targetChainId = selectedNetwork === 'base' ? BASE_CHAIN_ID : BSC_CHAIN_ID
        if (id !== targetChainId) {
          setStatus(`Wrong network: please switch to ${selectedNetwork.toUpperCase()} (${targetChainId})`)
          ensureNetwork()
        } else {
          setStatus(`Connected to ${selectedNetwork.toUpperCase()}`)
        }
      }
    }

    eth.on?.('chainChanged', handler)
    eth.request?.({ method: 'eth_chainId' }).then(handler).catch(() => {})
    if (selectedNetwork !== 'crosschain') {
      ensureNetwork()
    }

    return () => {
      eth.removeListener?.('chainChanged', handler)
    }
  }, [primaryWallet, selectedNetwork])

  // ============ Render ============
  // If mobile, render MobileApp
  if (isMobile) {
    return <MobileApp />
  }

  // Helper to resolve token decimals for formatting
  const resolveDecimals = (addr) => {
    try {
      const t = TOKENS.find(t => t.address.toLowerCase() === (addr || '').toLowerCase())
      return t?.decimals ?? 18
    } catch { return 18 }
  }

  // My Orders full-page view
  if (view === 'myOrders') {
    return (
      <div style={styles.app} className={`app ${theme}`}>
        <>
          <Toaster />
          <div style={styles.header} className="app-header">
            <div style={{ 
              ...styles.brand,
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              position: 'relative'
            }}>
              <span style={{ position: 'relative', display: 'inline-block' }}>
                <span style={{ 
                  position: 'absolute', 
                  top: '-18px', 
                  left: '50%', 
                  transform: 'translateX(-50%)',
                  fontSize: '18px',
                  lineHeight: 1
                }}>👨‍🍳</span>
                C
              </span>
              <span>ookbook</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} className="header-actions">
              <div style={{ fontSize: 11, color: '#8fb3c9', padding: '4px 8px', background: 'rgba(77, 163, 255, 0.1)', borderRadius: 4, border: '1px solid rgba(77, 163, 255, 0.3)' }}>
                {t('app.network')}: {selectedNetwork.toUpperCase()}
              </div>
              <button style={styles.toggle} onClick={toggleTheme}>{theme === 'dark' ? t('app.light') : t('app.dark')}</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#8fb3c9' }}>
                🌐 {t('app.language')}:
                <select
                  value={i18n.language}
                  onChange={(e) => i18n.changeLanguage(e.target.value)}
                  style={{
                    background: theme === 'dark' ? '#1e2936' : '#fff',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 4,
                    color: theme === 'dark' ? '#fff' : '#000',
                    padding: '4px 8px',
                    fontSize: 12,
                    marginLeft: 4
                  }}
                >
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                  <option value="es">Español</option>
                  <option value="ru">Русский</option>
                  <option value="ko">한국어</option>
                  <option value="pt">Português</option>
                  <option value="tr">Türkçe</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
              <button
                onClick={() => {
                  setView('markets')
                }}
                style={{ ...styles.toggle, padding: '8px 12px' }}
              >
                {t('app.backToMarkets')}
              </button>
              <button
                onClick={() => window.open('https://docs.cookbook.finance/', '_blank')}
                style={{ ...styles.toggle, padding: '8px 12px' }}
              >
                {t('app.docs')}
              </button>
              <DynamicWidget buttonClassName="btn-secondary" variant="modal" />
            </div>
          </div>
        </>

        <div style={{ padding: 16 }}>
          <div style={{ ...styles.card, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{t('app.myOrders')}</div>
              <div style={{ fontSize: 12, color: '#8fb3c9' }}>{t('app.address')}: {account || t('app.notConnected')}</div>
            </div>
            {!account ? (
              <div style={{ color: '#8fb3c9', marginTop: 12 }}>{t('app.connectWallet')}</div>
            ) : (
              <div style={{ marginTop: 12 }}>
                {myOpenOrdersLoading && (
                  <div style={{ color: '#8fb3c9' }}>Loading orders…</div>
                )}
                {myOpenOrdersError && (
                  <div style={{ color: '#ff6b6b' }}>Error: {myOpenOrdersError}</div>
                )}
                {!myOpenOrdersLoading && myOpenOrders.length === 0 && !myOpenOrdersError && (
                  <div style={{ color: '#8fb3c9' }}>No open orders found.</div>
                )}
                {myOpenOrders.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '0.6fr 1.4fr 1fr 1fr 0.8fr auto', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>Type</div>
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>Pair</div>
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>Amount In</div>
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>Min Out</div>
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>Price</div>
                    <div></div>
                      {myOpenOrders.map((o, idx) => {
                        return (
                          <>
                            <div key={'t-' + idx} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              {o.isConditional ? o.conditionalType.replace('_', ' ') : 'Limit'}
                            </div>
                            <div key={'p-' + idx} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <TokenLogo token={o.baseToken} size={18} />
                                {(o.base_symbol || '').toUpperCase()}/
                                <TokenLogo token={o.quoteToken} size={18} />
                                {(o.quote_symbol || '').toUpperCase()}
                              </div>
                              <div style={{ fontSize: 11, color: '#8fb3c9' }}>{(o.network || selectedNetwork).toUpperCase()}</div>
                            </div>
                            <div key={'ai-' + idx} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              {o.amountInFormatted} {o.tokenInSymbol}
                            </div>
                            <div key={'ao-' + idx} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              {o.amountOutMinFormatted} {o.tokenOutSymbol}
                            </div>
                            <div key={'pr-' + idx} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              {o.price}
                            </div>
                            <div key={'ac-' + idx} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              {o.status === 'filled' ? (
                                <span style={{ color: '#00e39f', fontWeight: 600 }}>Filled</span>
                              ) : o.status === 'cancelled' ? (
                                <span style={{ color: '#ff6b6b', fontWeight: 600 }}>Cancelled</span>
                              ) : (
                                <button
                                  onClick={() => onCancelSpecificOrder(o)}
                                  style={{ ...styles.btn, padding: '6px 10px' }}
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </>
                        )
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
  
        {/* SAL Order Creation Modal */}
        {showSALOrderModal && (
          <SALOrderModal
            key={modalKey}
            theme={theme}
            selectedNetwork={selectedNetwork}
            account={account}
            onClose={() => setShowSALOrderModal(false)}
            onSuccess={() => {
              setShowSALOrderModal(false)
              toast.success('SAL Order created successfully!')
            }}
          />
        )}
      </div>
    )
  }

  // My Watchlist full-page view
  if (view === 'myWatchlist') {
    return (
      <div style={styles.app} className={`app ${theme}`}>
        <>
          <Toaster />
          <div style={styles.header} className="app-header">
            <div style={{ 
              ...styles.brand,
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              position: 'relative'
            }}>
              <span style={{ position: 'relative', display: 'inline-block' }}>
                <span style={{ 
                  position: 'absolute', 
                  top: '-18px', 
                  left: '50%', 
                  transform: 'translateX(-50%)',
                  fontSize: '18px',
                  lineHeight: 1
                }}>👨‍🍳</span>
                C
              </span>
              <span>ookbook</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} className="header-actions">
              <div style={{ fontSize: 11, color: '#8fb3c9', padding: '4px 8px', background: 'rgba(77, 163, 255, 0.1)', borderRadius: 4, border: '1px solid rgba(77, 163, 255, 0.3)' }}>
                Network: {selectedNetwork.toUpperCase()}
              </div>
              <button style={styles.toggle} onClick={toggleTheme}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#8fb3c9' }}>
                🌐 {t('app.language')}:
                <select
                  value={i18n.language}
                  onChange={(e) => i18n.changeLanguage(e.target.value)}
                  style={{
                    background: theme === 'dark' ? '#1e2936' : '#fff',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 4,
                    color: theme === 'dark' ? '#fff' : '#000',
                    padding: '4px 8px',
                    fontSize: 12,
                    marginLeft: 4
                  }}
                >
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                  <option value="es">Español</option>
                  <option value="ru">Русский</option>
                  <option value="ko">한국어</option>
                  <option value="pt">Português</option>
                  <option value="tr">Türkçe</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
              <button
                onClick={() => {
                  setView('markets')
                }}
                style={{ ...styles.toggle, padding: '8px 12px' }}
              >
                Back to Markets
              </button>
              <button
                onClick={() => window.open('https://docs.cookbook.finance/', '_blank')}
                style={{ ...styles.toggle, padding: '8px 12px' }}
              >
                {t('app.docs')}
              </button>
              <DynamicWidget buttonClassName="btn-secondary" variant="modal" />
            </div>
          </div>
        </>

        <div style={{ padding: 16 }}>
          <div style={{ ...styles.card, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{t('app.myWatchlist')}</div>
              <div style={{ fontSize: 12, color: '#8fb3c9' }}>{t('app.address')}: {account || t('app.notConnected')}</div>
            </div>
            {!account ? (
              <div style={{ color: '#8fb3c9', marginTop: 12 }}>{t('app.connectWalletWatchlist')}</div>
            ) : (
              <div style={{ marginTop: 12 }}>
                {myWatchlistLoading && (
                  <div style={{ color: '#8fb3c9' }}>Loading watchlist…</div>
                )}
                {myWatchlistError && (
                  <div style={{ color: '#ff6b6b' }}>Error: {myWatchlistError}</div>
                )}
                {!myWatchlistLoading && myWatchlist.length === 0 && !myWatchlistError && (
                  <div style={{ color: '#8fb3c9' }}>No pairs in your watchlist. Add pairs from the Markets tab.</div>
                )}
                {myWatchlist.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>Pair</div>
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>Price</div>
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>Change</div>
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>Volume</div>
                    <div></div>
                      {myWatchlist.map((market, idx) => {
                        return (
                          <>
                            <div key={'p-' + idx} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <TokenLogo token={market.base} size={18} />
                                {(market.base?.symbol || '').toUpperCase()}/
                                <TokenLogo token={market.quote} size={18} />
                                {(market.quote?.symbol || '').toUpperCase()}
                              </div>
                              <div style={{ fontSize: 11, color: '#8fb3c9' }}>{market.network.toUpperCase()}</div>
                            </div>
                            <div key={'pr-' + idx} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              ${market.price}
                            </div>
                            <div key={'ch-' + idx} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', color: (parseFloat(market.change) >= 0 ? '#00e39f' : '#ff5c8a') }}>
                              {market.change || '0.00'}%
                            </div>
                            <div key={'vol-' + idx} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              ${market.volume || '0'}
                            </div>
                            <div key={'ac-' + idx} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              <button
                                onClick={() => onSelectPair(market)}
                                style={{ ...styles.btn, padding: '6px 10px' }}
                              >
                                Trade
                              </button>
                            </div>
                          </>
                        )
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Markets view (default)
  return (
    <div style={styles.app} className={`app ${theme}`}>
      <>
        <Toaster />
        <div style={styles.header} className="app-header">
          <div style={{ 
            ...styles.brand,
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            position: 'relative'
          }}>
            <span style={{ position: 'relative', display: 'inline-block' }}>
              <span style={{ 
                position: 'absolute', 
                top: '-18px', 
                left: '50%', 
                transform: 'translateX(-50%)',
                fontSize: '18px',
                lineHeight: 1
              }}>👨‍🍳</span>
              C
            </span>
            <span>ookbook</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} className="header-actions">
            <div style={{ fontSize: 11, color: '#8fb3c9', padding: '4px 8px', background: 'rgba(77, 163, 255, 0.1)', borderRadius: 4, border: '1px solid rgba(77, 163, 255, 0.3)' }}>
              Network: {selectedNetwork.toUpperCase()}
            </div>
            <button style={styles.toggle} onClick={toggleTheme}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#8fb3c9' }}>
              🌐 Language:
              <select
                value={i18n.language}
                onChange={(e) => i18n.changeLanguage(e.target.value)}
                style={{
                  background: theme === 'dark' ? '#1e2936' : '#fff',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 4,
                  color: theme === 'dark' ? '#fff' : '#000',
                  padding: '4px 8px',
                  fontSize: 12,
                  marginLeft: 4
                }}
              >
                <option value="en">English</option>
                <option value="zh">中文</option>
                <option value="es">Español</option>
                <option value="ru">Русский</option>
                <option value="ko">한국어</option>
                <option value="pt">Português</option>
                <option value="tr">Türkçe</option>
                <option value="ar">العربية</option>
              </select>
            </div>
            <button
              onClick={() => {
                setView('myOrders')
              }}
              style={{ ...styles.toggle, padding: '8px 12px' }}
            >
              {t('app.myOrders')}
            </button>
            <button
              onClick={() => {
                setView('myWatchlist')
              }}
              style={{ ...styles.toggle, padding: '8px 12px' }}
            >
              {t('app.myWatchlist')}
            </button>
            <button
              onClick={() => { setShowSALOrderModal(true); setModalKey(prev => prev + 1); }}
              style={{
                ...styles.toggle,
                padding: '8px 12px',
                background: 'linear-gradient(135deg, #4da3ff, #00e39f)',
                color: '#fff',
                fontWeight: '600'
              }}
            >
              🚀 Create SAL Order
            </button>
            <button
              onClick={() => window.open('https://docs.cookbook.finance/', '_blank')}
              style={{ ...styles.toggle, padding: '8px 12px' }}
            >
              {t('app.docs')}
            </button>
            <DynamicWidget buttonClassName="btn-secondary" variant="modal" />
          </div>
        </div>
      </>

      {view === 'markets' && (
        <div style={{ padding: 16 }}>
          <div style={{ ...styles.card, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{t('app.markets')}</div>
              <div className="markets-controls">
                {/* Network Selector */}
                <div className="markets-control-group">
                  <label style={{
                    fontSize: 14,
                    color: '#8fb3c9',
                    fontWeight: 500,
                    whiteSpace: 'nowrap'
                  }}>
                    {t('app.network')}:
                  </label>
                   <select
                    className="select"
                    value={selectedNetwork}
                    onChange={(e) => {
                      const newNetwork = e.target.value
                      console.log('[NETWORK DEBUG] Network dropdown changed to:', newNetwork)
                      setSelectedNetwork(newNetwork)
                    }}
                    style={{
                      minWidth: 120,
                      background: theme === 'dark' ? '#1e2936' : '#fff',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 8,
                      color: theme === 'dark' ? '#fff' : '#000',
                      padding: '8px 12px',
                      fontSize: 14
                    }}
                  >
                    <option value="bsc">BSC</option>
                    <option value="base">Base</option>
                    <option value="crosschain">Cross-Chain</option>
                  </select>
                </div>


                {/* Search Box */}
                <div className="markets-search-container">
                  <input
                    type="text"
                    className="input"
                    placeholder={t('app.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      paddingLeft: 40,
                      background: theme === 'dark' ? '#1e2936' : '#fff',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 8,
                      color: theme === 'dark' ? '#fff' : '#000'
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#8fb3c9',
                    fontSize: 14
                  }}>
                    🔍
                  </div>
                </div>

                {/* Filter Dropdown */}
                <div className="markets-control-group">
                  <label style={{
                    fontSize: 14,
                    color: '#8fb3c9',
                    fontWeight: 500,
                    whiteSpace: 'nowrap'
                  }}>
                    {t('app.filterBy')}:
                  </label>
                  <select
                    className="select"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    style={{
                      minWidth: 140,
                      background: theme === 'dark' ? '#1e2936' : '#fff',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 8,
                      color: theme === 'dark' ? '#fff' : '#000',
                      padding: '8px 12px',
                      fontSize: 14
                    }}
                  >
                    <option value="all">{t('app.allPairs')}</option>
                    <option value="trending">{t('app.trending')}</option>
                    <option value="hot">{t('app.hotPairs')}</option>
                    <option value="new">{t('app.newPairs')}</option>
                    <option value="volume">{t('app.mostVolume')}</option>
                    <option value="gainers">{t('app.topGainers')}</option>
                    <option value="losers">{t('app.topLosers')}</option>
                  </select>
                </div>
              </div>
            </div>

            {pairsError && <div style={{ color: '#ff6b6b', marginBottom: 8 }}>Error: {pairsError}</div>}
            
            {/* Market Pairs Table Header */}
            <div className="market-pairs-header">
              <div className="market-pairs-header-col pair-col">{t('app.pair') || 'Pair'}</div>
              <div className="market-pairs-header-col price-col">{t('app.price') || 'Price'}</div>
              <div className="market-pairs-header-col change-col">{t('app.change24h') || '24h Change'}</div>
              <div className="market-pairs-header-col volume-col">{t('app.volume24h') || '24h Volume'}</div>
              <div className="market-pairs-header-col actions-col"></div>
            </div>

            {/* Market Pairs List */}
            <div className="market-pairs-list">
              {/* Skeleton Loaders */}
              {pairsLoading && (
                <>
                  {[...Array(10)].map((_, index) => (
                    <div key={`skeleton-${index}`} className="skeleton-pair-row">
                      {/* Pair Column */}
                      <div className="skeleton-pair-col pair-col">
                        <div className="skeleton skeleton-token-icon"></div>
                        <div className="skeleton-pair-info">
                          <div className="skeleton skeleton-pair-name"></div>
                          <div className="skeleton skeleton-pair-watch"></div>
                        </div>
                      </div>
                      {/* Price Column */}
                      <div className="skeleton-pair-col price-col">
                        <div className="skeleton skeleton-price"></div>
                      </div>
                      {/* Change Column */}
                      <div className="skeleton-pair-col change-col">
                        <div className="skeleton skeleton-change"></div>
                      </div>
                      {/* Volume Column */}
                      <div className="skeleton-pair-col volume-col">
                        <div className="skeleton skeleton-volume"></div>
                      </div>
                      {/* Actions Column */}
                      <div className="skeleton-pair-col actions-col skeleton-actions">
                        <div className="skeleton skeleton-action-btn"></div>
                        <div className="skeleton skeleton-action-btn"></div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Real Market Data */}
              {!pairsLoading && paginatedPairs.map((p, i) => (
                <div key={i} className="market-pair-row" onClick={() => onSelectPair(p)}>
                  {/* Pair Column */}
                  <div className="market-pair-col pair-col">
                    <div className="market-pair-symbols">
                      <TokenLogo token={p.base} size={24} />
                      <div className="market-pair-info">
                        <span className="market-pair-name">{p?.base?.symbol || '-'}/{p?.quote?.symbol || '-'}</span>
                        <span className="market-pair-watch">
                          <span style={{ fontSize: '10px', opacity: 0.7 }}>👁</span> {p.watch_count || 0}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Price Column */}
                  <div className="market-pair-col price-col">
                    ${formatPrice(p.price)}
                  </div>

                  {/* 24h Change Column */}
                  <div className={`market-pair-col change-col ${parseFloat(p.change) >= 0 ? 'positive' : 'negative'}`}>
                    {parseFloat(p.change) >= 0 ? '+' : ''}{p.change}%
                  </div>

                  {/* 24h Volume Column */}
                  <div className="market-pair-col volume-col">
                    ${Number(p.volume).toLocaleString()}
                  </div>

                  {/* Actions Column */}
                  <div className="market-pair-col actions-col">
                    <button
                      className="market-action-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(p.base.address);
                        toast.success('Address copied!');
                      }}
                      title={`Copy: ${p.base.address}`}
                    >
                      📋
                    </button>
                    <button
                      className={`market-action-icon ${userWatchlist.some(w => w.pair === p.pair && w.network === p.network) ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatchlist(p);
                      }}
                      title={userWatchlist.some(w => w.pair === p.pair && w.network === p.network) ? 'Remove from watchlist' : 'Add to watchlist'}
                    >
                      {userWatchlist.some(w => w.pair === p.pair && w.network === p.network) ? '★' : '☆'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {pairsTotal > 50 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
                <button
                  style={{
                    ...styles.btn,
                    background: pairsPage === 1 ? 'transparent' : undefined,
                    color: pairsPage === 1 ? '#8fb3c9' : undefined,
                    border: pairsPage === 1 ? '1px solid rgba(255,255,255,0.12)' : undefined,
                    cursor: pairsPage === 1 ? 'not-allowed' : 'pointer'
                  }}
                  onClick={() => {
                    const newPage = Math.max(1, pairsPage - 1)
                    setPairsPage(newPage)
                    loadMarkets(newPage)
                  }}
                  disabled={pairsPage === 1}
                >
                  Previous
                </button>

                <span style={{ color: '#8fb3c9', fontSize: 14 }}>
                  Page {pairsPage} of {Math.ceil(pairsTotal / 50)} ({pairsTotal} total pairs)
                </span>

                <button
                  style={{
                    ...styles.btn,
                    background: pairsPage >= Math.ceil(pairsTotal / 50) ? 'transparent' : undefined,
                    color: pairsPage >= Math.ceil(pairsTotal / 50) ? '#8fb3c9' : undefined,
                    border: pairsPage >= Math.ceil(pairsTotal / 50) ? '1px solid rgba(255,255,255,0.12)' : undefined,
                    cursor: pairsPage >= Math.ceil(pairsTotal / 50) ? 'not-allowed' : 'pointer'
                  }}
                  onClick={() => {
                    const newPage = Math.min(Math.ceil(pairsTotal / 50), pairsPage + 1)
                    setPairsPage(newPage)
                    loadMarkets(newPage)
                  }}
                  disabled={pairsPage >= Math.ceil(pairsTotal / 50)}
                >
                  Next
                </button>
              </div>
            )}
            
            <div style={{ ...styles.card, color: '#8fb3c9', marginTop: 16 }}>
              Live markets auto-populated from new {selectedNetwork === 'bsc' ? 'WBNB' : (selectedNetwork === 'solana' ? 'SOL' : 'WETH')} pools on {selectedNetwork === 'solana' ? 'Solana' : selectedNetwork.toUpperCase()}.
            </div>
          </div>
        </div>
      )}

      {view === 'trade' && (
        <div className="trade-view-container" style={{ height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
          {selectedNetwork === 'solana' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {getTokenLogo(selected?.base) ? (
                      <img src={getTokenLogo(selected?.base)} alt={selected?.base?.symbol || 'base'} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'contain' }} referrerPolicy="no-referrer" />
                    ) : null}
                    <span style={{ fontSize: 18, fontWeight: 800 }}>{(selected?.pair) || `${baseToken.symbol}/${quoteToken.symbol}`}</span>
                    {getTokenLogo(selected?.quote) ? (
                      <img src={getTokenLogo(selected?.quote)} alt={selected?.quote?.symbol || 'quote'} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'contain' }} referrerPolicy="no-referrer" />
                    ) : null}
                    <span style={{ fontSize: 12, color: '#4da3ff', background: 'rgba(77, 163, 255, 0.1)', padding: '2px 6px', borderRadius: 4 }}>
                      Solana
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                    <span style={{ fontSize: 16, fontWeight: 600, color: '#4da3ff' }}>
                      ${currentPrice}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 500, ...(parseFloat(priceChange) >= 0 ? styles.green : styles.red) }}>
                      {priceChange}%
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    style={{ ...styles.btn, fontWeight: 'normal', ...(tradeView === 'chart' ? {} : { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }) }}
                    onClick={() => setTradeView('chart')}
                  >
                    {t('app.chart')}
                  </button>
                  <button
                    style={{ ...styles.btn, fontWeight: 'normal', ...(tradeView === 'trade' ? {} : { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }) }}
                    onClick={() => setTradeView('trade')}
                  >
                    {t('app.trade')}
                  </button>
                  <button
                    style={{ ...styles.btn, fontWeight: 'normal', ...(tradeView === 'history' ? {} : { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }) }}
                    onClick={() => setTradeView('history')}
                  >
                    {t('app.history')}
                  </button>
                  <button style={{ ...styles.btn, background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }} onClick={() => setView('markets')}>{t('app.backToMarkets')}</button>
                </div>
              </div>

          {/* Conditional rendering based on tradeView */}
          {tradeView === 'chart' && (
            <>
              {/* Full Chart */}
              <div style={{ height: '100%', overflow: 'hidden' }} className="card chart-card">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="Paste GeckoTerminal pool path, e.g. solana/pools/..."
                    value={geckoPoolId}
                    onChange={(e) => setGeckoPoolId(e.target.value.trim())}
                  />
                </div>
                <div className="chart-embed-wrapper" style={{ height: 'calc(100% - 40px)' }}>
                  {geckoPoolId ? (
                    <iframe
                      className="chart-embed"
                      title="GeckoTerminal Chart"
                      src={`https://www.geckoterminal.com/${geckoPoolId}?embed=1&info=0&swaps=0`}
                      width="100%"
                      height="100%"
                      style={{ border: 0, borderRadius: 8 }}
                      allow="clipboard-write; web-share; fullscreen"
                    />
                  ) : (
                    <div style={{ height: '100%', borderRadius: 8, border: '1px dashed rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8fb3c9' }}>
                      Enter a GeckoTerminal pool path like "solana/pools/..." to load the chart.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Conditional rendering based on tradeView - ONLY show selected view */}
          {tradeView === 'trade' && (
            <div className="trade-bottom-row">
              {/* Orderbook panel */}
              <div style={styles.card} className="card orderbook-card">
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('app.orderBook')}</div>
                <div className="ob-header" style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', fontSize: 12, color: '#8fb3c9', marginBottom: 6 }}>
                  <div>{t('app.side')}</div><div>{t('app.price')} ({quoteToken.symbol})</div><div>{t('app.amount')} ({baseToken.symbol})</div><div>{t('app.total')} ({quoteToken.symbol})</div>
                </div>
                {/* Order book body */}
                {obLoading && <div style={{ fontSize: 12, color: '#8fb3c9' }}>Loading order book...</div>}
                {obError && <div style={{ fontSize: 12, color: '#ff6b6b' }}>Error: {obError}</div>}
                {!obLoading && !obError && (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {(obBids.length === 0 && obAsks.length === 0) ? (
                      <div style={{ fontSize: 12, color: '#8fb3c9' }}>{t('app.noOrders')}</div>
                    ) : (
                      <>
                        {/* Bids (Buy orders) */}
                        <div style={{ fontSize: 12, color: '#2ecc71', fontWeight: 600, marginBottom: 4 }}>{t('app.bids')}</div>
                        {obBids.slice(0, 15).map((o, idx) => {
                          const row = computeObRow(o)
                          return (
                            <div key={`bid-${idx}`} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', fontSize: 12, color: '#2ecc71' }}>
                              <div>{t('app.buy')}</div>
                              <div>{row.priceStr}</div>
                              <div>{row.amountBaseStr}</div>
                              <div>{row.totalQuoteStr}</div>
                            </div>
                          )
                        })}
                        <div style={{ height: 8 }} />
                        {/* Asks (Sell orders) */}
                        <div style={{ fontSize: 12, color: '#ff6b6b', fontWeight: 600, marginBottom: 4 }}>{t('app.asks')}</div>
                        {obAsks.slice(0, 15).map((o, idx) => {
                          const row = computeObRow(o)
                          return (
                            <div key={`ask-${idx}`} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', fontSize: 12, color: '#ff6b6b' }}>
                              <div>{t('app.sell')}</div>
                              <div>{row.priceStr}</div>
                              <div>{row.amountBaseStr}</div>
                              <div>{row.totalQuoteStr}</div>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Trade/Place order */}
              <div style={{ ...styles.card, maxHeight: '75vh', overflowY: 'auto', overflowX: 'hidden', paddingBottom: 24 }} className="card trade-card">
               <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('app.placeOrder')}</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button
                    style={{ ...(tradeSide === 'buy' ? styles.btn : {}), ...(tradeSide !== 'buy' ? { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' } : {}) }}
                    onClick={() => setTradeSide('buy')}
                  >
                    {t('app.buy')} {baseToken.symbol}
                  </button>
                  <button
                    style={{ ...(tradeSide === 'sell' ? styles.btn : {}), ...(tradeSide !== 'sell' ? { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' } : {}) }}
                    onClick={() => setTradeSide('sell')}
                  >
                    {t('app.sell')} {baseToken.symbol}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button
                    style={{ ...(!isConditional ? styles.btn : { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }) }}
                    onClick={() => setIsConditional(false)}
                  >
                    {t('app.limitOrder')}
                  </button>
                  {!isCrossChainPair && (
                    <button
                      style={{ ...(isConditional ? styles.btn : { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }) }}
                      onClick={() => setIsConditional(true)}
                    >
                      {t('app.conditionalOrder')}
                    </button>
                  )}
                </div>
                {isConditional && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8, marginBottom: 8 }}>
                    <div>
                      <div>Type</div>
                      <select className="select" value={conditionalType} onChange={(e) => setConditionalType(e.target.value)}>
                        <option value="stop_loss">Stop Loss</option>
                        <option value="take_profit">Take Profit</option>
                      </select>
                    </div>
                    <div>
                      <div>Trigger Price ({quoteToken.symbol})</div>
                      <input className="input" value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} placeholder="e.g. 0.05" />
                    </div>
                    <div>
                      <div>Expiration (days)</div>
                      <input className="input" value={conditionalExpiration} onChange={(e) => setConditionalExpiration(e.target.value)} placeholder="e.g. 30" />
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
                  <div>
                    <div>{tradeSide === 'sell' ? t('app.sellLabel', {symbol: baseToken.symbol}) : t('app.spendLabel', {symbol: quoteToken.symbol})}</div>
                    <input className="input" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} />
                    <div style={{ fontSize: 12, color: '#8fb3c9', marginTop: 4 }}>
                      {t('app.balance')}: {tradeSide === 'sell' ? `${baseBalance} ${baseToken.symbol}` : `${quoteBalance} ${quoteToken.symbol}`}
                      {usdValue && <div>{usdValue}</div>}
                    </div>
                  </div>
                  <div>
                    <div>{t('app.minReceiveLabel', {symbol: tradeSide === 'sell' ? quoteToken.symbol : baseToken.symbol})}</div>
                    <input className="input" value={amountOutMin} onChange={(e) => setAmountOutMin(e.target.value)} />
                    <div style={{ fontSize: 12, color: '#8fb3c9', marginTop: 4 }}>
                      {t('app.balance')}: {tradeSide === 'sell' ? `${quoteBalance} ${quoteToken.symbol}` : `${baseBalance} ${baseToken.symbol}`}
                      {usdValueMinReceive && <div>{usdValueMinReceive}</div>}
                    </div>
                  </div>
                  <div>
                    <div>{t('app.expirationMinsLabel')}</div>
                    <input className="input" value={expirationMins} onChange={(e) => setExpirationMins(e.target.value)} />
                  </div>
                  <div>
                    <div>{t('app.nonceLabel')}</div>
                    <input className="input" value={nonce} onChange={(e) => setNonce(e.target.value)} />
                  </div>
                  <div>
                    <div>{t('app.receiverLabel')}</div>
                    <input className="input" value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="0x... or empty" />
                  </div>
                  <div>
                    <div>{t('app.saltFormLabel')}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className="input" value={salt} onChange={(e) => setSalt(e.target.value)} />
                      <button className="btn-secondary" onClick={randomizeSalt}>{t('app.random')}</button>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={{ ...styles.btn, opacity: smartBusy ? 0.7 : 1, cursor: smartBusy ? 'wait' : 'pointer' }} onClick={onSmartApproveThenSign} disabled={smartBusy}>
                    {smartLabel}
                  </button>
                  {lastSignedOrder && (
                    <button className="btn-secondary" onClick={onCancelOrder} disabled={smartBusy} title="Cancel your last signed order">
                      Cancel Order
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {tradeView === 'orders' && (
            <div style={styles.card} className="card my-orders-card trade-my-orders">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>My Open Orders</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={loadMyOpenOrders} title="Refresh my open orders">Refresh</button>
                </div>
              </div>
              {(!account) && <div style={{ fontSize: 12, color: '#8fb3c9' }}>Connect wallet to view your open orders.</div>}
              {account && myOpenOrdersLoading && <div style={{ fontSize: 12, color: '#8fb3c9' }}>Loading open orders...</div>}
              {account && myOpenOrdersError && <div style={{ fontSize: 12, color: '#ff6b6b' }}>Error: {myOpenOrdersError}</div>}
              {account && !myOpenOrdersLoading && !myOpenOrdersError && (
                myOpenOrders.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#8fb3c9' }}>No open orders.</div>
                ) : (
                  <table style={styles.table} className="responsive-table">
                    <thead>
                      <tr>
                        <th style={styles.th}>Side</th>
                        <th style={styles.th}>Price ({quoteToken.symbol})</th>
                        <th style={styles.th}>Amount In</th>
                        <th style={styles.th}>Min Out</th>
                        <th style={styles.th}>Expires</th>
                        <th style={styles.th}>Nonce</th>
                        <th style={styles.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {myOpenOrders.map((o, idx) => {
                        let tokenIn = o.tokenIn
                        let tokenOut = o.tokenOut
                        let amountIn = o.amountIn
                        let amountOutMin = o.amountOutMin
                        if (o.isConditional && o.order_template) {
                          tokenIn = o.order_template.tokenIn
                          tokenOut = o.order_template.tokenOut
                          amountIn = o.order_template.amountIn
                          amountOutMin = o.order_template.amountOutMin
                        }
                        const isSell = toLowerSafe(tokenIn) === toLowerSafe(baseToken.address)
                        const price = (Number(amountOutMin) / (10 ** (isSell ? quoteDecimals : baseDecimals))) / (Number(amountIn) / (10 ** (isSell ? baseDecimals : quoteDecimals)))
                        const priceStr = o.isConditional ? o.price : formatPrice(price)
                        const amountInStr = isSell ? formatUnitsStr(amountIn, baseDecimals, 6) : formatUnitsStr(amountIn, quoteDecimals, 6)
                        const minOutStr = isSell ? formatUnitsStr(amountOutMin, quoteDecimals, 6) : formatUnitsStr(amountOutMin, baseDecimals, 6)
                        const exp = new Date(o.expiration)
                        const expStr = isNaN(exp.getTime()) ? '-' : exp.toLocaleString()
                        return (
                          <tr key={`myorder-${idx}`}>
                            <td style={styles.td}>{o.isConditional ? 'Conditional' : (isSell ? 'Sell' : 'Buy')}</td>
                            <td style={styles.td}>{priceStr}</td>
                            <td style={styles.td}>{amountInStr} {isSell ? baseToken.symbol : quoteToken.symbol}</td>
                            <td style={styles.td}>{minOutStr} {isSell ? quoteToken.symbol : baseToken.symbol}</td>
                            <td style={styles.td}>{expStr}</td>
                            <td style={styles.td}>{String(o.nonce || '')}</td>
                            <td style={styles.td}>
                              {o.status === 'filled' ? (
                                <span style={{ color: '#00e39f', fontWeight: 600 }}>Filled</span>
                              ) : o.status === 'cancelled' ? (
                                <span style={{ color: '#ff6b6b', fontWeight: 600 }}>Cancelled</span>
                              ) : (
                                <button className="btn-secondary" onClick={() => onCancelSpecificOrder(o)}>Cancel</button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              )}
            </div>
          )}

          {tradeView === 'history' && (
            <div style={styles.card} className="card fills-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>Recent Transactions</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-secondary"
                    onClick={() => { loadRecentFills(); }}
                    title="Refresh recent transactions"
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {fillsLoading && <div style={{ fontSize: 12, color: '#8fb3c9' }}>Loading transactions...</div>}
              {fillsError && <div style={{ fontSize: 12, color: '#ff6b6b' }}>Error: {fillsError}</div>}
              {!fillsLoading && !fillsError && (
                <div style={{ display: 'grid', gap: 4 }}>
                  {recentFills.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>No recent transactions.</div>
                  ) : (
                    <table style={styles.table} className="responsive-table">
                      <thead>
                        <tr>
                          <th style={styles.th}>Time</th>
                          <th style={styles.th}>Price ({quoteToken.symbol})</th>
                          <th style={styles.th}>Amount ({baseToken.symbol})</th>
                          <th style={styles.th}>Total ({quoteToken.symbol})</th>
                          <th style={styles.th}>Tx</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedFills.map((fill, idx) => {
                          const price = (Number(fill.amountQuote) / (10 ** quoteDecimals)) / (Number(fill.amountBase) / (10 ** baseDecimals))
                          const priceStr = formatPrice(price)
                          const amountBaseStr = fill.amountBaseReadable || formatUnitsStr(fill.amountBase, baseDecimals, 6)
                          const totalQuoteStr = fill.amountQuoteReadable || formatUnitsStr(fill.amountQuote, quoteDecimals, 6)
                          const timeStr = new Date(fill.createdAt).toLocaleTimeString()

                          // Handle crosschain transactions with multiple tx hashes
                          const renderTxLinks = (fill) => {
                            if (fill.crosschainDetails) {
                              // Crosschain transaction - show all relevant tx hashes
                              // For WBNB/USDC crosschain: buySettlement on BSC, sellSettlement on Base
                              const links = []
                              const details = fill.crosschainDetails
                            
                              if (details.txHashes.buyCustodial) {
                                links.push(
                                  <a key="buy-custodial"
                                    href={`https://basescan.org/tx/${details.txHashes.buyCustodial}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#4da3ff', textDecoration: 'underline', fontSize: 10, marginRight: 4 }}
                                    title="Buy Custodial (Base)"
                                  >
                                    B↗
                                  </a>
                                )
                              }
                            
                              if (details.txHashes.sellCustodial) {
                                links.push(
                                  <a key="sell-custodial"
                                    href={`https://bscscan.com/tx/${details.txHashes.sellCustodial}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#4da3ff', textDecoration: 'underline', fontSize: 10, marginRight: 4 }}
                                    title="Sell Custodial (BSC)"
                                  >
                                    S↗
                                  </a>
                                )
                              }
                            
                              if (details.txHashes.buySettlement) {
                                links.push(
                                  <a key="buy-settlement"
                                    href={`https://bscscan.com/tx/${details.txHashes.buySettlement}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#2ecc71', textDecoration: 'underline', fontSize: 10, marginRight: 4 }}
                                    title="Buy Settlement (BSC)"
                                  >
                                    B✓
                                  </a>
                                )
                              }
                            
                              if (details.txHashes.sellSettlement) {
                                links.push(
                                  <a key="sell-settlement"
                                    href={`https://basescan.org/tx/${details.txHashes.sellSettlement}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#2ecc71', textDecoration: 'underline', fontSize: 10 }}
                                    title="Sell Settlement (Base)"
                                  >
                                    S✓
                                  </a>
                                )
                              }
                            
                              return links.length > 0 ? links : <span style={{ fontSize: 12, color: '#8fb3c9' }}>Processing</span>
                            } else {
                              // Regular transaction
                              return fill.txHash ? (
                                <a
                                  href={`${selectedNetwork === 'base' ? 'https://basescan.org' : 'https://bscscan.com'}/tx/${fill.txHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: '#4da3ff', textDecoration: 'underline', fontSize: 12 }}
                                >
                                  ↗
                                </a>
                              ) : (
                                <span style={{ fontSize: 12, color: '#8fb3c9' }}>Processing</span>
                              )
                            }
                          }

                          return (
                            <tr key={`fill-${idx}`}>
                              <td style={styles.td}>{timeStr}</td>
                              <td style={styles.td}>{priceStr}</td>
                              <td style={styles.td}>{amountBaseStr}</td>
                              <td style={styles.td}>{totalQuoteStr}</td>
                              <td style={styles.td}>
                                {renderTxLinks(fill)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}

                  {/* Pagination Controls for Fills */}
                  {fillsTotalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
                      <button
                        style={{
                          ...styles.btn,
                          background: fillsCurrentPage === 1 ? 'transparent' : undefined,
                          color: fillsCurrentPage === 1 ? '#8fb3c9' : undefined,
                          border: fillsCurrentPage === 1 ? '1px solid rgba(255,255,255,0.12)' : undefined,
                          cursor: fillsCurrentPage === 1 ? 'not-allowed' : 'pointer'
                        }}
                        onClick={() => setFillsCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={fillsCurrentPage === 1}
                      >
                        Previous
                      </button>

                      <span style={{ color: '#8fb3c9', fontSize: 14 }}>
                        Page {fillsCurrentPage} of {fillsTotalPages} ({recentFills.length} total transactions)
                      </span>

                      <button
                        style={{
                          ...styles.btn,
                          background: fillsCurrentPage === fillsTotalPages ? 'transparent' : undefined,
                          color: fillsCurrentPage === fillsTotalPages ? '#8fb3c9' : undefined,
                          border: fillsCurrentPage === fillsTotalPages ? '1px solid rgba(255,255,255,0.12)' : undefined,
                          cursor: fillsCurrentPage === fillsTotalPages ? 'not-allowed' : 'pointer'
                        }}
                        onClick={() => setFillsCurrentPage(prev => Math.min(fillsTotalPages, prev + 1))}
                        disabled={fillsCurrentPage === fillsTotalPages}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 14, color: '#8fb3c9' }}>{status}</div>
          <div style={{ marginTop: 16, ...styles.card, color: '#8fb3c9' }}>
            Professional UX notes:
            <ul>
              <li>Hook real market data from your indexer for prices, changes, volumes.</li>
              <li>Replace the chart placeholder with TradingView widget or a candlestick chart lib.</li>
              <li>Aggregate signed orders from your backend and render live depth in Order Book.</li>
            </ul>
          </div>
        </>
      )}


      {selectedNetwork !== 'solana' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {getTokenLogo(selected?.base) ? (
                      <img src={getTokenLogo(selected?.base)} alt={selected?.base?.symbol || 'base'} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'contain' }} referrerPolicy="no-referrer" />
                    ) : null}
                    <span style={{ fontSize: 18 }}>{(selected?.pair) || `${baseToken.symbol}/${quoteToken.symbol}`}</span>
                    {getTokenLogo(selected?.quote) ? (
                      <img src={getTokenLogo(selected?.quote)} alt={selected?.quote?.symbol || 'quote'} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'contain' }} referrerPolicy="no-referrer" />
                    ) : null}
                    {selectedNetwork === 'crosschain' && (
                      <span style={{ fontSize: 12, color: '#4da3ff', background: 'rgba(77, 163, 255, 0.1)', padding: '2px 6px', borderRadius: 4 }}>
                        Cross-Chain
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                    <span style={{ fontSize: 16, color: '#4da3ff' }}>
                      ${currentPrice}
                    </span>
                    <span style={{ fontSize: 14, ...(parseFloat(priceChange) >= 0 ? styles.green : styles.red) }}>
                      {priceChange}%
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    style={{ ...styles.btn, fontWeight: 'normal', ...(tradeView === 'chart' ? {} : { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }) }}
                    onClick={() => setTradeView('chart')}
                  >
                    {t('app.chart')}
                  </button>
                  <button
                    style={{ ...styles.btn, fontWeight: 'normal', ...(tradeView === 'trade' ? {} : { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }) }}
                    onClick={() => setTradeView('trade')}
                  >
                    {t('app.trade')}
                  </button>
                  <button
                    style={{ ...styles.btn, fontWeight: 'normal', ...(tradeView === 'history' ? {} : { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }) }}
                    onClick={() => setTradeView('history')}
                  >
                    {t('app.history')}
                  </button>
                                    <button style={{ ...styles.btn, background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }} onClick={() => setView('markets')}>{t('app.backToMarkets')}</button>
                </div>
              </div>

          {/* Conditional rendering based on tradeView */}
          {tradeView === 'chart' && (
            <>
              {/* Full Chart */}
              <div style={{ height: '100%', overflow: 'hidden' }} className="card chart-card">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="Paste GeckoTerminal pool path, e.g. bsc/pools/0x..."
                    value={geckoPoolId}
                    onChange={(e) => setGeckoPoolId(e.target.value.trim())}
                  />
                </div>
                <div className="chart-embed-wrapper" style={{ height: 'calc(100% - 40px)' }}>
                  {isCrossChainPair ? (
                    <iframe
                      key={`tradingview-${theme}`}
                      title="TradingView Chart"
                      width="100%"
                      height="100%"
                      src={`https://www.tradingview.com/widgetembed/?frameElementId=tradingview_chart&symbol=BINANCE:BNBUSDT&interval=30&hidesidetoolbar=1&symboledit=1&saveimage=1&toolbarbg=f1f3f6&studies=[]&theme=${theme}&style=1&timezone=Etc%2FUTC&withdateranges=1&showpopupbutton=1&studies_overrides={}&overrides={}&enabled_features=[]&disabled_features=[]&showpopupbutton=1&locale=en`}
                      style={{ width: '100%', height: '100%', border: 'none', borderRadius: 0 }}
                      allow="clipboard-write; web-share; fullscreen"
                    />
                  ) : geckoPoolId ? (
                    <iframe
                      key={`geckoterminal-${theme}`}
                      className="chart-embed"
                      title="GeckoTerminal Chart"
                      src={`https://www.geckoterminal.com/${geckoPoolId}?embed=1&info=0&swaps=0&light_chart=${theme === 'light' ? 1 : 0}`}
                      width="100%"
                      height="100%"
                      style={{ border: 0, borderRadius: 8 }}
                      allow="clipboard-write; web-share; fullscreen"
                    />
                  ) : (
                    <div style={{ height: '100%', borderRadius: 8, border: '1px dashed rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8fb3c9' }}>
                      Enter a GeckoTerminal pool path like "bsc/pools/0x..." to load the chart.
                    </div>
                  )}
                </div>
              </div>

            </>
          )}

          {/* Conditional rendering based on tradeView - ONLY show selected view */}
          {tradeView === 'trade' && (
            <div className="trade-bottom-row">
              {/* Orderbook panel */}
              <div style={styles.card} className="card orderbook-card">
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Order Book</div>
                <div className="ob-header" style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', fontSize: 12, color: '#8fb3c9', marginBottom: 6 }}>
                  <div>Side</div><div>Price ({quoteToken.symbol})</div><div>Amount ({baseToken.symbol})</div><div>Total ({quoteToken.symbol})</div>
                </div>
                {/* Order book body */}
                {obLoading && <div style={{ fontSize: 12, color: '#8fb3c9' }}>Loading order book...</div>}
                {obError && <div style={{ fontSize: 12, color: '#ff6b6b' }}>Error: {obError}</div>}
                {!obLoading && !obError && (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {(obBids.length === 0 && obAsks.length === 0) ? (
                      <div style={{ fontSize: 12, color: '#8fb3c9' }}>{t('app.noOrders')}</div>
                    ) : (
                      <>
                        {/* Bids (Buy orders) */}
                        <div style={{ fontSize: 12, color: '#2ecc71', fontWeight: 600, marginBottom: 4 }}>Bids (Buy)</div>
                        {obBids.slice(0, 15).map((o, idx) => {
                          const row = computeObRow(o)
                          return (
                            <div key={`bid-${idx}`} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', fontSize: 12, color: '#2ecc71' }}>
                              <div>Buy</div>
                              <div>{row.priceStr}</div>
                              <div>{row.amountBaseStr}</div>
                              <div>{row.totalQuoteStr}</div>
                            </div>
                          )
                        })}
                        <div style={{ height: 8 }} />
                        {/* Asks (Sell orders) */}
                        <div style={{ fontSize: 12, color: '#ff6b6b', fontWeight: 600, marginBottom: 4 }}>Asks (Sell)</div>
                        {obAsks.slice(0, 15).map((o, idx) => {
                          const row = computeObRow(o)
                          return (
                            <div key={`ask-${idx}`} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', fontSize: 12, color: '#ff6b6b' }}>
                              <div>Sell</div>
                              <div>{row.priceStr}</div>
                              <div>{row.amountBaseStr}</div>
                              <div>{row.totalQuoteStr}</div>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                )}
                {/* Depth Chart */}
                {false && !obLoading && !obError && (obBids.length > 0 || obAsks.length > 0) && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Depth Chart</div>
                    {(() => {
                      const depth = computeDepthData()
                      const allPrices = [...depth.bidData.map(d=>d.price), ...depth.askData.map(d=>d.price)]
                      const minPrice = Math.min(...allPrices)
                      const maxPrice = Math.max(...allPrices)
                      const maxVol = Math.max(...depth.bidData.map(d=>d.volume), ...depth.askData.map(d=>d.volume))
                      const priceRange = maxPrice - minPrice || 1
                      return (
                        <svg width="400" height="200" style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, background: theme === 'dark' ? '#1e2936' : '#f8fafc' }}>
                          {depth.bidData.map((d, i) => {
                            const x = ((d.price - minPrice) / priceRange) * 400
                            const height = (d.volume / maxVol) * 200
                            return <rect key={`bid-${i}`} x={x} y={200 - height} width="2" height={height} fill="#2ecc71" />
                          })}
                          {depth.askData.map((d, i) => {
                            const x = ((d.price - minPrice) / priceRange) * 400
                            const height = (d.volume / maxVol) * 200
                            return <rect key={`ask-${i}`} x={x} y={0} width="2" height={height} fill="#ff6b6b" />
                          })}
                        </svg>
                      )
                    })()}
                  </div>
                )}
              </div>

              {/* Trade/Place order */}
              <div style={{ ...styles.card, maxHeight: '75vh', overflowY: 'auto', overflowX: 'hidden', paddingBottom: 24 }} className="card trade-card">
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('app.placeOrder')}</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button
                    style={{ ...(tradeSide === 'buy' ? styles.btn : {}), ...(tradeSide !== 'buy' ? { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' } : {}) }}
                    onClick={() => setTradeSide('buy')}
                  >
                    {t('app.buy')} {baseToken.symbol}
                  </button>
                  <button
                    style={{ ...(tradeSide === 'sell' ? styles.btn : {}), ...(tradeSide !== 'sell' ? { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' } : {}) }}
                    onClick={() => setTradeSide('sell')}
                  >
                    {t('app.sell')} {baseToken.symbol}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button
                    style={{ ...(!isConditional ? styles.btn : { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }) }}
                    onClick={() => setIsConditional(false)}
                  >
                    {t('app.limitOrder')}
                  </button>
                  {!isCrossChainPair && (
                    <button
                      style={{ ...(isConditional ? styles.btn : { background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)' }) }}
                      onClick={() => setIsConditional(true)}
                    >
                      {t('app.conditionalOrder')}
                    </button>
                  )}
                </div>
                {isConditional && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8, marginBottom: 8 }}>
                    <div>
                      <div>Type</div>
                      <select className="select" value={conditionalType} onChange={(e) => setConditionalType(e.target.value)}>
                        <option value="stop_loss">Stop Loss</option>
                        <option value="take_profit">Take Profit</option>
                      </select>
                    </div>
                    <div>
                      <div>Trigger Price ({quoteToken.symbol})</div>
                      <input className="input" value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} placeholder="e.g. 0.05" />
                    </div>
                    <div>
                      <div>Expiration (days)</div>
                      <input className="input" value={conditionalExpiration} onChange={(e) => setConditionalExpiration(e.target.value)} placeholder="e.g. 30" />
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
                  <div>
                    <div>{tradeSide === 'sell' ? t('app.sellLabel', {symbol: baseToken.symbol}) : t('app.spendLabel', {symbol: quoteToken.symbol})}</div>
                    <input className="input" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} />
                    <div style={{ fontSize: 12, color: '#8fb3c9', marginTop: 4 }}>
                      {t('app.balance')}: {tradeSide === 'sell' ? `${baseBalance} ${baseToken.symbol}` : `${quoteBalance} ${quoteToken.symbol}`}
                      {usdValue && <div>{usdValue}</div>}
                    </div>
                  </div>
                  <div>
                    <div>{t('app.minReceiveLabel', {symbol: tradeSide === 'sell' ? quoteToken.symbol : baseToken.symbol})}</div>
                    <input className="input" value={amountOutMin} onChange={(e) => setAmountOutMin(e.target.value)} />
                    <div style={{ fontSize: 12, color: '#8fb3c9', marginTop: 4 }}>
                      {t('app.balance')}: {tradeSide === 'sell' ? `${quoteBalance} ${quoteToken.symbol}` : `${baseBalance} ${baseToken.symbol}`}
                      {usdValueMinReceive && <div>{usdValueMinReceive}</div>}
                    </div>
                  </div>
                  <div>
                    <div>{t('app.expirationMinsLabel')}</div>
                    <input className="input" value={expirationMins} onChange={(e) => setExpirationMins(e.target.value)} />
                  </div>
                  <div>
                    <div>{t('app.nonceLabel')}</div>
                    <input className="input" value={nonce} onChange={(e) => setNonce(e.target.value)} />
                  </div>
                  <div>
                    <div>{t('app.receiverLabel')}</div>
                    <input className="input" value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="0x... or empty" />
                  </div>
                  <div>
                    <div>{t('app.saltFormLabel')}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className="input" value={salt} onChange={(e) => setSalt(e.target.value)} />
                      <button className="btn-secondary" onClick={randomizeSalt}>{t('app.random')}</button>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={{ ...styles.btn, opacity: smartBusy ? 0.7 : 1, cursor: smartBusy ? 'wait' : 'pointer' }} onClick={onSmartApproveThenSign} disabled={smartBusy}>
                    {smartLabel}
                  </button>
                  {lastSignedOrder && (
                    <button className="btn-secondary" onClick={onCancelOrder} disabled={smartBusy} title="Cancel your last signed order">
                      Cancel Order
                    </button>
                  )}
                  {/* Verify Sig depends on removed fields; hide button as it's not needed */}
                  {/* <button className="btn-secondary" onClick={verifyOrderSig} disabled={!orderJson || !signature || smartBusy}>Verify Sig</button> */}
                </div>
              </div>
            </div>
          )}

          {tradeView === 'orders' && (
            <div style={styles.card} className="card my-orders-card trade-my-orders">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>My Open Orders</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={loadMyOpenOrders} title="Refresh my open orders">Refresh</button>
                </div>
              </div>
              {(!account) && <div style={{ fontSize: 12, color: '#8fb3c9' }}>Connect wallet to view your open orders.</div>}
              {account && myOpenOrdersLoading && <div style={{ fontSize: 12, color: '#8fb3c9' }}>Loading open orders...</div>}
              {account && myOpenOrdersError && <div style={{ fontSize: 12, color: '#ff6b6b' }}>Error: {myOpenOrdersError}</div>}
              {account && !myOpenOrdersLoading && !myOpenOrdersError && (
                myOpenOrders.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#8fb3c9' }}>No open orders.</div>
                ) : (
                  <table style={styles.table} className="responsive-table">
                    <thead>
                      <tr>
                        <th style={styles.th}>Side</th>
                        <th style={styles.th}>Price ({quoteToken.symbol})</th>
                        <th style={styles.th}>Amount In</th>
                        <th style={styles.th}>Min Out</th>
                        <th style={styles.th}>Expires</th>
                        <th style={styles.th}>Nonce</th>
                        <th style={styles.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {myOpenOrders.map((o, idx) => {
                        const isSell = toLowerSafe(o.tokenIn) === toLowerSafe(baseToken.address)
                        const price = (Number(o.amountOutMin) / (10 ** (isSell ? quoteDecimals : baseDecimals))) / (Number(o.amountIn) / (10 ** (isSell ? baseDecimals : quoteDecimals)))
                        const priceStr = formatPrice(price)
                        const amountInStr = isSell ? formatUnitsStr(o.amountIn, baseDecimals, 6) : formatUnitsStr(o.amountIn, quoteDecimals, 6)
                        const minOutStr = isSell ? formatUnitsStr(o.amountOutMin, quoteDecimals, 6) : formatUnitsStr(o.amountOutMin, baseDecimals, 6)
                        const exp = new Date(o.expiration)
                        const expStr = isNaN(exp.getTime()) ? '-' : exp.toLocaleString()
                        return (
                          <tr key={`myorder-${idx}`}>
                            <td style={styles.td}>{isSell ? 'Sell' : 'Buy'}</td>
                            <td style={styles.td}>{priceStr}</td>
                            <td style={styles.td}>{amountInStr} {isSell ? baseToken.symbol : quoteToken.symbol}</td>
                            <td style={styles.td}>{minOutStr} {isSell ? quoteToken.symbol : baseToken.symbol}</td>
                            <td style={styles.td}>{expStr}</td>
                            <td style={styles.td}>{String(o.nonce)}</td>
                            <td style={styles.td}>
                              <button className="btn-secondary" onClick={() => onCancelSpecificOrder(o)}>Cancel</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              )}
            </div>
          )}

          {tradeView === 'history' && (
            <div style={styles.card} className="card fills-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>Recent Transactions</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-secondary"
                    onClick={() => { loadRecentFills(); }}
                    title="Refresh recent transactions"
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {fillsLoading && <div style={{ fontSize: 12, color: '#8fb3c9' }}>Loading transactions...</div>}
              {fillsError && <div style={{ fontSize: 12, color: '#ff6b6b' }}>Error: {fillsError}</div>}
              {!fillsLoading && !fillsError && (
                <div style={{ display: 'grid', gap: 4 }}>
                  {recentFills.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#8fb3c9' }}>No recent transactions.</div>
                  ) : (
                    <table style={styles.table} className="responsive-table">
                      <thead>
                        <tr>
                          <th style={styles.th}>Time</th>
                          <th style={styles.th}>Price ({quoteToken.symbol})</th>
                          <th style={styles.th}>Amount ({baseToken.symbol})</th>
                          <th style={styles.th}>Total ({quoteToken.symbol})</th>
                          <th style={styles.th}>Tx</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedFills.map((fill, idx) => {
                          const price = (Number(fill.amountQuote) / (10 ** quoteDecimals)) / (Number(fill.amountBase) / (10 ** baseDecimals))
                          const priceStr = formatPrice(price)
                          const amountBaseStr = fill.amountBaseReadable || formatUnitsStr(fill.amountBase, baseDecimals, 6)
                          const totalQuoteStr = fill.amountQuoteReadable || formatUnitsStr(fill.amountQuote, quoteDecimals, 6)
                          const timeStr = new Date(fill.createdAt).toLocaleTimeString()

                          // Handle crosschain transactions with multiple tx hashes
                          const renderTxLinks = (fill) => {
                            if (fill.crosschainDetails) {
                              // Crosschain transaction - show all relevant tx hashes
                              // For WBNB/USDC crosschain: buySettlement on BSC, sellSettlement on Base
                              const links = []
                              const details = fill.crosschainDetails

                              if (details.txHashes.buyCustodial) {
                                links.push(
                                  <a key="buy-custodial"
                                    href={`https://basescan.org/tx/${details.txHashes.buyCustodial}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#4da3ff', textDecoration: 'underline', fontSize: 10, marginRight: 4 }}
                                    title="Buy Custodial (Base)"
                                  >
                                    B↗
                                  </a>
                                )
                              }

                              if (details.txHashes.sellCustodial) {
                                links.push(
                                  <a key="sell-custodial"
                                    href={`https://bscscan.com/tx/${details.txHashes.sellCustodial}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#4da3ff', textDecoration: 'underline', fontSize: 10, marginRight: 4 }}
                                    title="Sell Custodial (BSC)"
                                  >
                                    S↗
                                  </a>
                                )
                              }

                              if (details.txHashes.buySettlement) {
                                links.push(
                                  <a key="buy-settlement"
                                    href={`https://bscscan.com/tx/${details.txHashes.buySettlement}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#2ecc71', textDecoration: 'underline', fontSize: 10, marginRight: 4 }}
                                    title="Buy Settlement (BSC)"
                                  >
                                    B✓
                                  </a>
                                )
                              }

                              if (details.txHashes.sellSettlement) {
                                links.push(
                                  <a key="sell-settlement"
                                    href={`https://basescan.org/tx/${details.txHashes.sellSettlement}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#2ecc71', textDecoration: 'underline', fontSize: 10 }}
                                    title="Sell Settlement (Base)"
                                  >
                                    S✓
                                  </a>
                                )
                              }

                              return links.length > 0 ? links : <span style={{ fontSize: 12, color: '#8fb3c9' }}>Processing</span>
                            } else {
                              // Regular transaction
                              return fill.txHash ? (
                                <a
                                  href={`${selectedNetwork === 'base' ? 'https://basescan.org' : 'https://bscscan.com'}/tx/${fill.txHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: '#4da3ff', textDecoration: 'underline', fontSize: 12 }}
                                >
                                  ↗
                                </a>
                              ) : (
                                <span style={{ fontSize: 12, color: '#8fb3c9' }}>Processing</span>
                              )
                            }
                          }

                          return (
                            <tr key={`fill-${idx}`}>
                              <td style={styles.td}>{timeStr}</td>
                              <td style={styles.td}>{priceStr}</td>
                              <td style={styles.td}>{amountBaseStr}</td>
                              <td style={styles.td}>{totalQuoteStr}</td>
                              <td style={styles.td}>
                                {renderTxLinks(fill)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}

                  {/* Pagination Controls for Fills */}
                  {fillsTotalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
                      <button
                        style={{
                          ...styles.btn,
                          background: fillsCurrentPage === 1 ? 'transparent' : undefined,
                          color: fillsCurrentPage === 1 ? '#8fb3c9' : undefined,
                          border: fillsCurrentPage === 1 ? '1px solid rgba(255,255,255,0.12)' : undefined,
                          cursor: fillsCurrentPage === 1 ? 'not-allowed' : 'pointer'
                        }}
                        onClick={() => setFillsCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={fillsCurrentPage === 1}
                      >
                        Previous
                      </button>

                      <span style={{ color: '#8fb3c9', fontSize: 14 }}>
                        Page {fillsCurrentPage} of {fillsTotalPages} ({recentFills.length} total transactions)
                      </span>

                      <button
                        style={{
                          ...styles.btn,
                          background: fillsCurrentPage === fillsTotalPages ? 'transparent' : undefined,
                          color: fillsCurrentPage === fillsTotalPages ? '#8fb3c9' : undefined,
                          border: fillsCurrentPage === fillsTotalPages ? '1px solid rgba(255,255,255,0.12)' : undefined,
                          cursor: fillsCurrentPage === fillsTotalPages ? 'not-allowed' : 'pointer'
                        }}
                        onClick={() => setFillsCurrentPage(prev => Math.min(fillsTotalPages, prev + 1))}
                        disabled={fillsCurrentPage === fillsTotalPages}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Hide status and UX notes on desktop when in chart view */}
          <div style={{ marginTop: 14, color: '#8fb3c9', display: window.innerWidth >= 1024 && tradeView === 'chart' ? 'none' : 'block' }}>{status}</div>
          <div style={{ marginTop: 16, ...styles.card, color: '#8fb3c9', display: window.innerWidth >= 1024 && tradeView === 'chart' ? 'none' : 'block' }}>
            Professional UX notes:
            <ul>
              <li>Hook real market data from your indexer for prices, changes, volumes.</li>
              <li>Replace the chart placeholder with TradingView widget or a candlestick chart lib.</li>
              <li>Aggregate signed orders from your backend and render live depth in Order Book.</li>
            </ul>
          </div>
        </>
      )}
        </div>
      )}

      {/* Social Media Links */}
      <div style={{
        marginTop: 32,
        paddingTop: 24,
        paddingBottom: 24,
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16
      }}>
        <div style={{ color: '#8fb3c9', fontSize: 14, fontWeight: 500 }}>
          Join Our Community
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <a
            href="https://x.com/cookbook888?s=21"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#8fb3c9',
              transition: 'all 0.2s ease',
              textDecoration: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(29, 155, 240, 0.1)'
              e.currentTarget.style.borderColor = '#1d9bf0'
              e.currentTarget.style.color = '#1d9bf0'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
              e.currentTarget.style.color = '#8fb3c9'
            }}
            title="Follow us on X (Twitter)"
          >
            <Twitter size={20} />
          </a>
          <a
            href="https://t.me/cookbook888"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#8fb3c9',
              transition: 'all 0.2s ease',
              textDecoration: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(36, 161, 222, 0.1)'
              e.currentTarget.style.borderColor = '#24a1de'
              e.currentTarget.style.color = '#24a1de'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
              e.currentTarget.style.color = '#8fb3c9'
            }}
            title="Join our Telegram"
          >
            <SiTelegram size={20} />
          </a>
          <a
            href="https://discord.gg/y4FW3Mp9"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#8fb3c9',
              transition: 'all 0.2s ease',
              textDecoration: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(88, 101, 242, 0.1)'
              e.currentTarget.style.borderColor = '#5865f2'
              e.currentTarget.style.color = '#5865f2'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
              e.currentTarget.style.color = '#8fb3c9'
            }}
            title="Join our Discord"
          >
            <SiDiscord size={20} />
          </a>
        </div>

        {/* SAL Order Creation Modal */}
        {showSALOrderModal && (
          <SALOrderModal
            key={modalKey}
            theme={theme}
            selectedNetwork={selectedNetwork}
            account={account}
            onClose={() => setShowSALOrderModal(false)}
            onSuccess={() => {
              setShowSALOrderModal(false)
              toast.success('SAL Order created successfully!')
            }}
          />
        )}
      </div>
    </div>
  )
}

export default App

