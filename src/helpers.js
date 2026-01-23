import { ethers } from "ethers"

// 🔹 Your deployed contract address (replace with your real one)
const CONTRACT_ADDRESS = "0xYourSettlementContractHere"

// 🔹 ABI — minimal example, replace with your full ABI
const CONTRACT_ABI = [
  "function matchOrders(uint256 buyId, uint256 sellId, uint256 amount) external",
]

// 🟢 Check if MetaMask is available
export const hasMetaMask = () => typeof window !== "undefined" && !!window.ethereum

// 🟡 Switch to Binance Smart Chain (BSC mainnet)
export const switchToBsc = async () => {
  if (!hasMetaMask()) throw new Error("MetaMask not found")

  const chainId = "0x38" // 56 in hex
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    })
  } catch (error) {
    // If not added, add BSC network to MetaMask
    if (error.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: "Binance Smart Chain",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: ["https://bsc-dataseed.defibit.io/"],
            blockExplorerUrls: ["https://bscscan.com"],
          },
        ],
      })
    } else {
      throw error
    }
  }
}

// 🔹 Get Contract instance (read or write mode)
export const getContract = async (write = false) => {
  if (!hasMetaMask()) throw new Error("MetaMask not found")

  const provider = new ethers.BrowserProvider(window.ethereum)
  if (!write) return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider)

  const signer = await provider.getSigner()
  return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer)
}

// 🔗 Explorer URL builder
export function explorerTxUrl(txHash, networkOrChainId = 'bsc') {
  if (!txHash) return null
  const n = (networkOrChainId || '').toString().toLowerCase()
  let base = 'https://bscscan.com/tx/'
  if (n === '56' || n === '0x38' || n === 'bsc' || n === 'bsc-mainnet' || n === 'bnb' || n === 'binance') base = 'https://bscscan.com/tx/'
  if (n === '97' || n === '0x61' || n === 'bsc-testnet') base = 'https://testnet.bscscan.com/tx/'
  // Extend with other networks if needed
  return `${base}${txHash}`
}

// Price formatting helper for displaying prices with appropriate decimal precision
export const formatPrice = (p) => {
  const num = parseFloat(String(p).replace(/,/g, ''));
  if (!Number.isFinite(num)) return '0.00';
  if (num >= 1) return num.toFixed(2);
  if (num >= 0.01) return num.toFixed(4);
  if (num >= 0.0001) return num.toFixed(6);
  return num.toFixed(8);
};

// Cache for USD prices to avoid rate limits (TTL 10 seconds)
const priceCache = new Map();

// Fetch USD price for a token using GeckoTerminal API
export const fetchTokenUsdPrice = async (network, tokenAddr) => {
  const addr = tokenAddr.toLowerCase();
  const cacheKey = `${network}:${addr}`;
  const now = Date.now();

  // Check cache
  if (priceCache.has(cacheKey)) {
    const cached = priceCache.get(cacheKey);
    if (now - cached.timestamp < 60000) { // 60 seconds TTL
      return cached.price;
    }
  }

  // Supported networks
  const supportedNetworks = ['bsc', 'base', 'solana'];
  if (!supportedNetworks.includes(network)) return null;

  try {
    const url = `https://api.geckoterminal.com/api/v2/simple/networks/${network}/token_price/${addr}?include_market_cap=false&mcap_fdv_fallback=false&include_24hr_vol=false&include_24hr_price_change=false&include_total_reserve_in_usd=false&include_inactive_source=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const price = json?.data?.attributes?.token_prices?.[addr];
    if (price) {
      const numPrice = parseFloat(price);
      // Cache the result
      priceCache.set(cacheKey, { price: numPrice, timestamp: now });
      return numPrice;
    }
    return null;
  } catch (e) {
    console.error('Failed to fetch USD price from GeckoTerminal:', e);
    return null;
  }
};
