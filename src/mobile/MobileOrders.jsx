import React, { useState, useEffect } from 'react';
import { useThemeStyles } from '../theme';
import { fetchTokenDecimals } from '../helpers_decimals';
import { ethers, Contract } from 'ethers';
import TradingModal from './TradingModal';
import { useTranslation } from 'react-i18next';
import { Twitter } from 'lucide-react';
import { SiTelegram, SiDiscord } from 'react-icons/si';

// Indexer base URL (override with VITE_INDEXER_BASE for prod)
const INDEXER_BASE = (import.meta?.env?.VITE_INDEXER_BASE) || 'https://cookbook-hjnhgq.fly.dev';

// Helper to get provider for a network
const getProvider = async (network = 'bsc') => {
  if (network === 'solana') return null; // Solana doesn't use ethers provider
  // For mobile, we might not have direct provider access, so return null
  return null;
};

// ==========================
// Config
// ==========================
const SETTLEMENT_ADDRESS = '0x7DBA6a1488356428C33cC9fB8Ef3c8462c8679d0';

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

// Real markets integration: WBNB canonical address (lowercase)
const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'.toLowerCase();

// Prefer a local, known-good WBNB logo regardless of DB data
const getTokenLogo = (token) => {
  try {
    const addr = (token?.address || '').toLowerCase();
    if (addr === WBNB_ADDRESS) {
      return 'https://coin-images.coingecko.com/coins/images/12591/large/binance-coin-logo.png?1696512401';
    }
    return token?.logoUrl || null;
  } catch {
    return token?.logoUrl || null;
  }
};

// Generate a placeholder logo with first letter of token symbol
const TokenLogo = ({ token, size = 18 }) => {
  const logoUrl = getTokenLogo(token);
  const [imageError, setImageError] = React.useState(false);

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

// Helper function for formatting units with decimals
const formatUnitsStr = (value, decimals, maxFrac = 6) => {
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

const MobileOrders = ({ selectedPair, account, provider, getSigner, selectedNetwork, primaryWallet }) => {
   const { theme, styles } = useThemeStyles();
   const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('open');
  const [orders, setOrders] = useState({ open: [], history: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tokenSymbols, setTokenSymbols] = useState({});

  // Get provider for fetching decimals (only for EVM networks)
  const getProvider = (network) => {
    if (network === 'solana') {
      return null; // No ethers provider for Solana
    }
    if (network === 'base') {
      return new ethers.JsonRpcProvider('https://mainnet.base.org')
    } else {
      return new ethers.JsonRpcProvider('https://bsc-dataseed.defibit.io/')
    }
  };

  // Default pair if none selected
  const currentPair = selectedPair || {
    base: { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
    quote: { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' },
    price: '245.67',
    change: '+2.34',
    network: selectedNetwork || 'bsc'
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

  // Fetch orders from API
  const fetchOrders = async (status) => {
    if (!account) return [];
    try {
      const network = selectedNetwork || 'bsc';
      const INDEXER_BASE = import.meta?.env?.VITE_INDEXER_BASE || 'https://cookbook-hjnhgq.fly.dev';
      const makerParam = network === 'solana' ? account : account.toLowerCase();
      const url = `${INDEXER_BASE}/api/orders?network=${network}&maker=${makerParam}&status=${status}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.data || [];
    } catch (e) {
      console.error('Failed to fetch orders:', e);
      return [];
    }
  };

  // Fetch conditional orders from API
  const fetchConditionalOrders = async () => {
    if (!account) return [];
    try {
      const network = selectedNetwork || 'bsc';
      const INDEXER_BASE = import.meta?.env?.VITE_INDEXER_BASE || 'https://cookbook-hjnhgq.fly.dev';
      const makerParam = network === 'solana' ? account : account.toLowerCase();
      const url = `${INDEXER_BASE}/api/conditional-orders?network=${network}&maker=${makerParam}&status=pending`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.data || [];
    } catch (e) {
      console.error('Failed to fetch conditional orders:', e);
      return [];
    }
  };
  
  // Fetch triggered conditional orders from API
  const fetchConditionalOrdersTriggered = async () => {
    if (!account) return [];
    try {
      const network = selectedNetwork || 'bsc';
      const INDEXER_BASE = import.meta?.env?.VITE_INDEXER_BASE || 'https://cookbook-hjnhgq.fly.dev';
      const makerParam = network === 'solana' ? account : account.toLowerCase();
      const url = `${INDEXER_BASE}/api/conditional-orders?network=${network}&maker=${makerParam}&status=triggered`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.data || [];
    } catch (e) {
      console.error('Failed to fetch triggered conditional orders:', e);
      return [];
    }
  };

  // Format order for display
  const formatOrder = async (order) => {
    try {
      if (order.isConditional) {
        // Format conditional order
        let baseAddr = order.base_token;
        let quoteAddr = order.quote_token;
        const triggerPrice = order.trigger_price;
        const conditionalType = order.type;

        // For Solana, prefer canonical addresses from order_template
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

        // For conditional, format amounts from order_template if available
        let amountInFormatted = 'N/A';
        let amountOutMinFormatted = 'N/A';
        let isSell = false; // default
        if (order.order_template) {
          const template = order.order_template;
          const network = selectedNetwork || 'bsc';
          let baseDecs, quoteDecs;

          [baseDecs, quoteDecs] = await Promise.all([
            fetchTokenDecimals(baseAddr, await getProvider(network), network),
            fetchTokenDecimals(quoteAddr, await getProvider(network), network)
          ]);

          isSell = (template.tokenIn || '').toLowerCase() === baseAddr.toLowerCase();
          amountInFormatted = isSell ? formatUnitsStr(template.amountIn, baseDecs, 6) : formatUnitsStr(template.amountIn, quoteDecs, 6);
          amountOutMinFormatted = isSell ? formatUnitsStr(template.amountOutMin, quoteDecs, 6) : formatUnitsStr(template.amountOutMin, baseDecs, 6);
        }

        return {
          id: order.conditional_order_id,
          type: 'conditional',
          pair: `${baseInfo.symbol}/${quoteInfo.symbol}`,
          baseToken,
          quoteToken,
          price: `$${String(triggerPrice || '0')}`,
          amountIn: amountInFormatted,
          amountOutMin: amountOutMinFormatted,
          status: order.status || 'pending',
          expires: order.expiration ? new Date(order.expiration).toLocaleString() : 'No expiry',
          isConditional: true,
          conditionalType: conditionalType,
          tokenInSymbol: isSell ? baseInfo.symbol : quoteInfo.symbol,
          tokenOutSymbol: isSell ? quoteInfo.symbol : baseInfo.symbol
        };
      }

      const isSell = selectedNetwork === 'solana'
        ? ((order.tokenIn || '').toString().toLowerCase() === (order.base_address || '').toString().toLowerCase())
        : ((order.tokenIn || '').toString().toLowerCase() === (order.base_address || '').toString().toLowerCase());

      const baseAddr = selectedNetwork === 'solana'
        ? (isSell ? (order.tokenIn || '') : (order.tokenOut || ''))
        : (order.base_address || '').toLowerCase();
      const quoteAddr = selectedNetwork === 'solana'
        ? (isSell ? (order.tokenOut || '') : (order.tokenIn || ''))
        : (order.quote_address || '').toLowerCase();

      // Get network and provider for fetching decimals
      const network = selectedNetwork || 'bsc';

      const provider = await getProvider(network);
      const [baseDecimals, quoteDecimals] = await Promise.all([
        fetchTokenDecimals(baseAddr, network === 'solana' ? null : provider, network),
        fetchTokenDecimals(quoteAddr, network === 'solana' ? null : provider, network)
      ]);

      // Get token info for base and quote
      const [baseInfo, quoteInfo] = await Promise.all([
        getTokenInfo(baseAddr),
        getTokenInfo(quoteAddr)
      ]);

      // Create token objects for logos
      const baseToken = { symbol: baseInfo.symbol, address: baseAddr, logoUrl: baseInfo.logoUrl };
      const quoteToken = { symbol: quoteInfo.symbol, address: quoteAddr, logoUrl: quoteInfo.logoUrl };

      const amountInNum = Number(order.amountIn);
      const amountOutMinNum = Number(order.amountOutMin);

      // Calculate price: for sell orders, price = amountOutMin / amountIn (quote per base)
      // For buy orders, price = amountIn / amountOutMin (quote per base)
      let price = 0;
      if (isSell) {
        price = (amountOutMinNum / (10 ** quoteDecimals)) / (amountInNum / (10 ** baseDecimals));
      } else {
        price = (amountInNum / (10 ** quoteDecimals)) / (amountOutMinNum / (10 ** baseDecimals));
      }

      // Format amounts with decimals
      const amountInFormatted = isSell ? formatUnitsStr(order.amountIn, baseDecimals) : formatUnitsStr(order.amountIn, quoteDecimals);
      const amountOutMinFormatted = isSell ? formatUnitsStr(order.amountOutMin, quoteDecimals) : formatUnitsStr(order.amountOutMin, baseDecimals);

      // Format expiration time
      const expires = order.expiration ? new Date(order.expiration).toLocaleString() : 'No expiry';

      return {
        id: order.order_id,
        type: isSell ? 'sell' : 'buy',
        pair: `${baseInfo.symbol}/${quoteInfo.symbol}`,
        baseToken,
        quoteToken,
        price: `$${price.toFixed(6)}`,
        amountIn: amountInFormatted,
        amountOutMin: amountOutMinFormatted,
        status: order.status,
        expires: expires,
        tokenInSymbol: isSell ? baseInfo.symbol : quoteInfo.symbol,
        tokenOutSymbol: isSell ? quoteInfo.symbol : baseInfo.symbol
      };
    } catch (e) {
      console.error('Failed to format order:', e);
      return null;
    }
  };

  useEffect(() => {
    const loadOrders = async () => {
      if (!account) return;
      setLoading(true);
      setError('');
      try {
        let fetchedOrders = [];
        if (activeTab === 'open') {
          const regularOrders = await fetchOrders('open');
          const conditionalOrders = await fetchConditionalOrders();
          fetchedOrders = [
            ...regularOrders,
            ...conditionalOrders.map(c => ({ ...c, isConditional: true }))
          ];
        } else {
          const regularOrders = await fetchOrders('filled,cancelled');
          const triggeredConditionalOrders = await fetchConditionalOrdersTriggered();
          fetchedOrders = [
            ...regularOrders,
            ...triggeredConditionalOrders.map(c => ({ ...c, isConditional: true }))
          ];
        }

        const formattedOrders = [];
        for (const order of fetchedOrders) {
          const formatted = await formatOrder(order);
          if (formatted) formattedOrders.push(formatted);
        }

        setOrders(prev => ({
          ...prev,
          [activeTab]: formattedOrders
        }));
      } catch (e) {
        setError(e.message || 'Failed to load orders');
      } finally {
        setLoading(false);
      }
    };

    loadOrders();
  }, [account, activeTab, selectedNetwork]);

  const handleCancelOrder = async (orderId) => {
    try {
      // First, find the order details from the current orders
      const order = orders[activeTab].find(o => o.id === orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      const network = selectedNetwork || 'bsc';
      const INDEXER_BASE = import.meta?.env?.VITE_INDEXER_BASE || 'https://cookbook-hjnhgq.fly.dev';

      if (order.isConditional) {
        // Cancel conditional order
        const url = `${INDEXER_BASE}/api/conditional-orders/cancel`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: orderId, network })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        // Cancel regular order
        if (network !== 'solana') {
          // Get the full order data from API
          const makerParam = network === 'solana' ? account : account.toLowerCase();
          const fetchUrl = `${INDEXER_BASE}/api/orders?network=${network}&maker=${makerParam}&status=open`;
          const fetchRes = await fetch(fetchUrl);
          if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`);
          const fetchJson = await fetchRes.json();
          const fullOrder = fetchJson.data.find(o => o.order_id === orderId);
          if (!fullOrder) {
            throw new Error('Full order data not found');
          }

          // Call contract cancelOrder
          const c = new Contract(SETTLEMENT_ADDRESS, SETTLEMENT_ABI, await getSigner());
          // Convert fields back to BigInt for contract call
          const ord = { ...fullOrder };
          ord.amountIn = BigInt(ord.amountIn);
          ord.amountOutMin = BigInt(ord.amountOutMin);
          ord.expiration = BigInt(Math.floor(new Date(ord.expiration).getTime() / 1000));
          ord.nonce = BigInt(ord.nonce);
          ord.salt = BigInt(ord.salt);
          const tx = await c.cancelOrder(ord);
          await tx.wait();
        }
        // For Solana, no contract call needed - just update database

        // Update database for all networks
        const url = `${INDEXER_BASE}/api/orders/cancel`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, network })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }

      // Refresh orders after cancel
      const updatedOrders = orders[activeTab].filter(o => o.id !== orderId);
      setOrders(prev => ({ ...prev, [activeTab]: updatedOrders }));
    } catch (e) {
      console.error('Failed to cancel order:', e);
      setError('Failed to cancel order');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'open': return '#4da3ff';
      case 'filled': return '#00e39f';
      case 'cancelled': return '#ff5c8a';
      default: return '#8fb3c9';
    }
  };

  const getTypeColor = (type) => {
    return type === 'buy' ? '#00e39f' : '#ff5c8a';
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', background: theme === 'dark' ? '#0b0f14' : '#f6f8fb', minHeight: '100vh', paddingTop: '16px', overflowX: 'hidden' }}>
      {!account && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: '#8fb3c9',
          fontSize: '16px'
        }}>
          {t('app.connectWalletOrders')}
        </div>
      )}

      {/* Tab Navigation */}
      <div style={{
        ...styles.card,
        padding: '16px',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('open')}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              background: activeTab === 'open' ? '#4da3ff' : 'rgba(255,255,255,0.05)',
              color: activeTab === 'open' ? '#fff' : '#8fb3c9',
              border: 'none',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            {t('app.openOrders')}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              background: activeTab === 'history' ? '#4da3ff' : 'rgba(255,255,255,0.05)',
              color: activeTab === 'history' ? '#fff' : '#8fb3c9',
              border: 'none',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            {t('app.orderHistory')}
          </button>
        </div>
      </div>

      {/* Orders List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {loading && (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: '#8fb3c9',
            fontSize: '16px'
          }}>
            {t('app.loadingOrders')}
          </div>
        )}
        {error && (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: '#ff6b6b',
            fontSize: '16px'
          }}>
            Error: {error}
          </div>
        )}
        {!loading && !error && orders[activeTab].map((order) => (
          <div
            key={order.id}
            style={{
              ...styles.card,
              padding: '16px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <TokenLogo token={order.baseToken} size={18} />
                  {order.baseToken.symbol} /
                  <TokenLogo token={order.quoteToken} size={18} />
                  {order.quoteToken.symbol}
                </div>
                <div style={{ fontSize: '12px', color: '#8fb3c9' }}>
                  {t('app.expires')}: {order.expires}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: getTypeColor(order.type),
                  textTransform: 'uppercase'
                }}>
                  {order.isConditional ? order.conditionalType.replace('_', ' ') : order.type}
                </div>
                <div style={{
                  fontSize: '12px',
                  color: getStatusColor(order.status),
                  fontWeight: '500'
                }}>
                  {order.status}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#8fb3c9', marginBottom: '4px' }}>
                  {order.isConditional ? t('app.triggerPrice') : t('app.price')}
                </div>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>
                  {order.price}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#8fb3c9', marginBottom: '4px' }}>
                  {t('app.amountIn')}
                </div>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>
                  {order.amountIn} {order.tokenInSymbol}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#8fb3c9', marginBottom: '4px' }}>
                  {t('app.minOut')}
                </div>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>
                  {order.amountOutMin} {order.tokenOutSymbol}
                </div>
              </div>
            </div>

            {activeTab === 'open' && order.status === 'open' && (
              <button
                onClick={() => handleCancelOrder(order.id)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'rgba(255, 92, 138, 0.1)',
                  color: '#ff5c8a',
                  border: '1px solid rgba(255, 92, 138, 0.3)',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                {t('app.cancelOrder')}
              </button>
            )}
          </div>
        ))}
      </div>

      {!loading && !error && orders[activeTab].length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: '#8fb3c9',
          fontSize: '16px'
        }}>
          {t('app.noOrdersFound', { status: activeTab === 'open' ? 'open' : 'historical' })}
        </div>
      )}

      {/* Social Media Links */}
      <div style={{
        marginTop: 24,
        marginBottom: 16,
        paddingTop: 20,
        paddingBottom: 20,
        paddingLeft: 16,
        paddingRight: 16,
        borderTop: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16
      }}>
        <div style={{
          color: theme === 'dark' ? '#8fb3c9' : '#666',
          fontSize: 13,
          fontWeight: 500
        }}>
          Join Our Community
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <a
            href="https://x.com/cookbook888?s=21"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 42,
              height: 42,
              borderRadius: 8,
              background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
              color: theme === 'dark' ? '#8fb3c9' : '#666',
              textDecoration: 'none'
            }}
            title="Follow us on X (Twitter)"
          >
            <Twitter size={18} />
          </a>
          <a
            href="https://t.me/cookbook888"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 42,
              height: 42,
              borderRadius: 8,
              background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
              color: theme === 'dark' ? '#8fb3c9' : '#666',
              textDecoration: 'none'
            }}
            title="Join our Telegram"
          >
            <SiTelegram size={18} />
          </a>
          <a
            href="https://discord.gg/y4FW3Mp9"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 42,
              height: 42,
              borderRadius: 8,
              background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
              color: theme === 'dark' ? '#8fb3c9' : '#666',
              textDecoration: 'none'
            }}
            title="Join our Discord"
          >
            <SiDiscord size={18} />
          </a>
        </div>
      </div>
    </div>
  );
};

export default MobileOrders;