import React, { useState, useEffect, useRef } from 'react';
import { useThemeStyles } from '../theme';
import TradingModal from './TradingModal';
import { fetchTokenDecimals } from '../helpers_decimals';
import { formatPrice } from '../helpers';
import { ethers } from 'ethers';
import { useTranslation } from 'react-i18next';

const INDEXER_BASE = (import.meta?.env?.VITE_INDEXER_BASE) || 'https://cookbook-hjnhgq.fly.dev';

// Real markets integration: WBNB canonical address (lowercase)
const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'.toLowerCase();

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
        alt={token?.symbol || ''}
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

const MobileTrade = ({ selectedPair, geckoPoolId, onGeckoPoolIdChange, onBackToMarkets, account, provider, getSigner, status, setStatus, selectedNetwork, switchToNetwork, primaryWallet }) => {
  const { theme, styles } = useThemeStyles();
  const { t } = useTranslation();
  const [watchlist, setWatchlist] = useState([]);
  const isWatched = selectedPair && watchlist.includes(selectedPair.pair);

  // Load watchlist from database
  const loadWatchlist = async () => {
    if (!account || !selectedNetwork) {
      setWatchlist([]);
      return;
    }
    try {
      const url = `${INDEXER_BASE}/api/watchlist?user_id=${account}&network=${selectedNetwork}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const pairs = (json.data || []).map(item => item.pair);
        setWatchlist(pairs);
      } else {
        setWatchlist([]);
      }
    } catch (e) {
      console.error('Trade watchlist fetch error:', e);
      setWatchlist([]);
    }
  };

  // Load watchlist when account or network changes
  useEffect(() => {
    loadWatchlist();
  }, [account, selectedNetwork]);

  const toggleWatchlist = async () => {
    if (!selectedPair) return;
    const newWatchlist = isWatched ? watchlist.filter(p => p !== selectedPair.pair) : [...watchlist, selectedPair.pair];
    setWatchlist(newWatchlist);

    // Update global watch count
    try {
      const endpoint = isWatched ? '/api/watchlist/remove' : '/api/watchlist/add';
      await fetch(`${INDEXER_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair: selectedPair.pair, pool_address: selectedPair.poolAddress, network: selectedNetwork, user_id: account })
      });
    } catch (e) {
      console.error('Failed to update global watchlist:', e);
      // Revert on error
      setWatchlist(watchlist);
    }
  };
  const [tradeView, setTradeView] = useState('chart'); // 'chart', 'orderbook', 'trades'
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalSide, setModalSide] = useState('buy');
  const [currentPair, setCurrentPair] = useState({
    base: { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
    quote: { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    price: '245.67',
    change: '+2.34',
    network: 'bsc'
  });

  // Decimals fetched from contract
  const [baseDecimals, setBaseDecimals] = useState(18);
  const [quoteDecimals, setQuoteDecimals] = useState(18);

  // Real orderbook state
  const [obAsks, setObAsks] = useState([])
  const [obBids, setObBids] = useState([])
  const [obLoading, setObLoading] = useState(false)
  const [obError, setObError] = useState('')

  // Real recent trades/fills state
  const [recentFills, setRecentFills] = useState([])
  const [fillsLoading, setFillsLoading] = useState(false)
  const [fillsError, setFillsError] = useState('')

  // WebSocket ref
  const wsRef = useRef(null)
  // Reference price for calculating 24h change
  const referencePriceRef = useRef(null)

  // Update currentPair when selectedPair changes
  useEffect(() => {
    if (selectedPair) {
      setCurrentPair(selectedPair);
      // Set decimals from pair data first
      setBaseDecimals(selectedPair.base.decimals);
      setQuoteDecimals(selectedPair.quote.decimals);
      // Calculate reference price for 24h change
      const currentPrice = parseFloat(selectedPair.price)
      const currentChange = parseFloat((selectedPair.change || '0').replace('%', ''))
      const referencePrice = currentPrice / (1 + currentChange / 100)
      referencePriceRef.current = referencePrice;
      // Fetch correct decimals from contract
      refreshTokenMeta(selectedPair.base.address, selectedPair.quote.address, selectedPair.network);
    }
  }, [selectedPair]);

  // Helper functions from desktop App.jsx
  const toLowerSafe = (s) => (s || '').toString().toLowerCase()
  
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

  const formatNumberFixed = (n, maxFrac = 8) => {
    const num = Number(n)
    if (!Number.isFinite(num)) return '0'
    if (num < 0.0001 && num > 0) {
      return num.toFixed(10).replace(/\.?0+$/, '')
    }
    return num.toLocaleString(undefined, { maximumFractionDigits: maxFrac })
  }


  // Get provider for fetching decimals
  const getProvider = (network) => {
    if (network === 'base') {
      return new ethers.JsonRpcProvider('https://mainnet.base.org')
    } else {
      return new ethers.JsonRpcProvider('https://bsc-dataseed.defibit.io/')
    }
  }

  // Fetch decimals from contract
  const refreshTokenMeta = async (baseAddr, quoteAddr, network) => {
    try {
      const [d0, d1] = await Promise.all([
        fetchTokenDecimals(baseAddr, null, network),
        fetchTokenDecimals(quoteAddr, null, network)
      ])
      setBaseDecimals(Number(d0))
      setQuoteDecimals(Number(d1))
    } catch (error) {
      console.warn('Failed to fetch decimals from contracts:', error)
      // Fallback to currentPair decimals
      setBaseDecimals(currentPair?.base?.decimals || 18)
      setQuoteDecimals(currentPair?.quote?.decimals || 18)
    }
  }

  const scalePrice = (serverPrice) => {
    const p = Number(serverPrice || 0)
    if (!Number.isFinite(p)) return 0
    return p
  }

  const computeObRow = (o) => {
    const baseAddr = toLowerSafe(currentPair?.base?.address)
    const quoteAddr = toLowerSafe(currentPair?.quote?.address)
    // Use decimals fetched from contract
    
    const isAsk = toLowerSafe(o.tokenIn) === baseAddr && toLowerSafe(o.tokenOut) === quoteAddr
    const pTrue = scalePrice(o.price)
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

  // Load orderbook from API
  const loadOrderBook = async () => {
    try {
      if (!currentPair?.base?.address || !currentPair?.quote?.address) {
        console.log('[MOBILE ORDERBOOK] Missing addresses:', currentPair)
        return
      }

      const network = currentPair?.network || 'bsc'
      const baseAddr = network === 'solana' ? currentPair.base.address : currentPair.base.address.toLowerCase()
      const quoteAddr = network === 'solana' ? currentPair.quote.address : currentPair.quote.address.toLowerCase()
      const url = `${INDEXER_BASE}/api/orders?network=${network}&base=${baseAddr}&quote=${quoteAddr}`

      console.log('[MOBILE ORDERBOOK] Loading orderbook for network:', network)
      console.log('[MOBILE ORDERBOOK] Base address:', baseAddr)
      console.log('[MOBILE ORDERBOOK] Quote address:', quoteAddr)
      console.log('[MOBILE ORDERBOOK] URL:', url)

      const res = await fetch(url)
      console.log('[MOBILE ORDERBOOK] Response status:', res.status)

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()

      console.log('[MOBILE ORDERBOOK] Response data:', json)

      const allAsks = Array.isArray(json.asks) ? json.asks : []
      const allBids = Array.isArray(json.bids) ? json.bids : []

      console.log('[MOBILE ORDERBOOK] Asks count:', allAsks.length, 'Bids count:', allBids.length)

      setObAsks(allAsks)
      setObBids(allBids)
      if (obError) setObError('')
    } catch (e) {
      console.error('[MOBILE ORDERBOOK] Error:', e)
      if (!obError) setObError(e?.message || String(e))
    }
  }

  // Load recent fills/trades from API
  const loadRecentFills = async () => {
    try {
      if (!currentPair?.base?.address || !currentPair?.quote?.address) return

      const network = currentPair?.network || 'bsc'
      const baseAddr = network === 'solana' ? currentPair.base.address : currentPair.base.address.toLowerCase()
      const quoteAddr = network === 'solana' ? currentPair.quote.address : currentPair.quote.address.toLowerCase()
      const url = `${INDEXER_BASE}/api/fills?network=${network}&base=${baseAddr}&quote=${quoteAddr}&limit=50`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()

      const allFills = Array.isArray(json.data) ? json.data : []
      setRecentFills(allFills)
      if (fillsError) setFillsError('')
    } catch (e) {
      if (!fillsError) setFillsError(e?.message || String(e))
    }
  }

  // WebSocket connection and subscription
  const connectWebSocket = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return

    const wsUrl = INDEXER_BASE.replace('http', 'ws').replace('https', 'wss')
    wsRef.current = new WebSocket(wsUrl)

    wsRef.current.onopen = () => {
      console.log('[WS] Connected')
      // Subscribe to the current pair
      if (currentPair?.base?.address && currentPair?.quote?.address) {
        const network = currentPair.network || 'bsc'
        const baseAddr = network === 'solana' ? currentPair.base.address : currentPair.base.address.toLowerCase()
        const quoteAddr = network === 'solana' ? currentPair.quote.address : currentPair.quote.address.toLowerCase()
        wsRef.current.send(JSON.stringify({
          type: 'subscribe',
          network,
          base: baseAddr,
          quote: quoteAddr,
          pair: `${baseAddr}/${quoteAddr}`
        }))
      }
    }

    wsRef.current.onmessage = (event) => {
      console.log('[WS] Received message:', event.data)
      try {
        const message = JSON.parse(event.data)
        console.log('[WS] Parsed message:', message)
        if (message.type === 'new_fill') {
          const newPrice = parseFloat(message.data.price)
          const reference = referencePriceRef.current
          const changePercent = reference ? ((newPrice - reference) / reference * 100).toFixed(2) : '0.00'

          // Update recent fills
          setRecentFills(prev => [message.data, ...prev.slice(0, 49)])
          // Update price and recalculated 24h change
          setCurrentPair(prev => ({
            ...prev,
            price: message.data.price,
            change: (changePercent > 0 ? '+' : '') + changePercent + '%'
          }))
        }
      } catch (e) {
        console.error('[WS] Error parsing message:', e)
      }
    }

    wsRef.current.onclose = () => {
      console.log('[WS] Disconnected')
    }

    wsRef.current.onerror = (error) => {
      console.error('[WS] Error:', error)
    }
  }

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }

  // Connect WebSocket when pair changes
  useEffect(() => {
    if (currentPair?.base?.address && currentPair?.quote?.address) {
      connectWebSocket()
    }
    return () => {
      disconnectWebSocket()
    }
  }, [currentPair?.base?.address, currentPair?.quote?.address])

  // Load data when pair changes or view switches to orderbook/trades
  useEffect(() => {
    if (tradeView === 'orderbook') {
      loadOrderBook()
      const interval = setInterval(() => {
        loadOrderBook().catch(() => {})
      }, 10000) // Poll every 10 seconds
      return () => clearInterval(interval)
    } else if (tradeView === 'trades') {
      loadRecentFills()
      // No polling for fills, using WebSocket
    }
  }, [tradeView, currentPair?.base?.address, currentPair?.quote?.address])

  if (!currentPair) {
    return (
      <div style={{
        ...styles.card,
        padding: '40px 20px',
        textAlign: 'center',
        color: '#8fb3c9'
      }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
        <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
          No Pair Selected
        </div>
        <div style={{ fontSize: '14px' }}>
          Please select a trading pair from the Markets tab to start trading.
        </div>
      </div>
    );
  }

  const handleOpenModal = (side) => {
    setModalSide(side);
    setIsModalOpen(true);
  };

  return (
    <div style={{ 
      width: '100%', 
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      minHeight: 0
    }}>
      {/* Trading Modal */}
      <TradingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialSide={modalSide}
        currentPair={currentPair}
        account={account}
        provider={provider}
        getSigner={getSigner}
        status={status}
        setStatus={setStatus}
        selectedNetwork={selectedNetwork}
        switchToNetwork={switchToNetwork}
        primaryWallet={primaryWallet}
      />
      {/* Top Header with Pair Info and Navigation */}
      <div style={{ 
        flexShrink: 0,
        background: theme === 'dark' ? '#0b0f14' : 'rgba(255,255,255,0.95)',
        borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`
      }}>
        {/* Pair Info Row */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '10px 16px 8px 16px'
        }}>
          {/* Pair Info on Left */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <TokenLogo token={currentPair.base} size={20} />
            <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'dark' ? '#e6f1ff' : '#0b0f14' }}>
              {currentPair.base.symbol}
            </span>
            <span style={{ fontSize: '13px', fontWeight: '500', color: '#8fb3c9' }}>/</span>
            <TokenLogo token={currentPair.quote} size={20} />
            <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'dark' ? '#e6f1ff' : '#0b0f14' }}>
              {currentPair.quote.symbol}
            </span>
          </div>

          {/* Watchlist and Back Buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {tradeView === 'chart' && (
              <button
                style={{ 
                  background: 'transparent',
                  border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                  padding: '6px 10px',
                  borderRadius: '6px',
                  color: isWatched ? '#ffa94d' : '#8fb3c9',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '16px',
                  minWidth: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                onClick={toggleWatchlist}
                title={isWatched ? 'Remove from Watchlist' : 'Add to Watchlist'}
              >
                {isWatched ? '★' : '☆'}
              </button>
            )}
            <button
              style={{ 
                background: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                padding: '8px 14px',
                borderRadius: '6px',
                color: '#8fb3c9',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '13px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onClick={onBackToMarkets}
            >
              ← {t('app.back')}
            </button>
          </div>
        </div>

        {/* Price Info Row */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '12px',
          padding: '0 16px 10px 16px'
        }}>
          <span style={{ 
            fontSize: '16px',
            fontWeight: '700',
            color: theme === 'dark' ? '#e6f1ff' : '#0b0f14'
          }}>
            ${formatPrice(currentPair.price)}
          </span>
          <span style={{
            fontSize: '13px',
            fontWeight: '600',
            padding: '3px 8px',
            borderRadius: '4px',
            background: (isNaN(parseFloat((currentPair.change || '0').toString()))
              ? 'rgba(143, 179, 201, 0.1)'
              : (parseFloat((currentPair.change || '0').toString()) > 0
                  ? 'rgba(0, 227, 159, 0.1)'
                  : (parseFloat((currentPair.change || '0').toString()) < 0 ? 'rgba(255, 92, 138, 0.1)' : 'rgba(143, 179, 201, 0.1)'))),
            color: (isNaN(parseFloat((currentPair.change || '0').toString()))
              ? '#8fb3c9'
              : (parseFloat((currentPair.change || '0').toString()) > 0
                  ? '#00e39f'
                  : (parseFloat((currentPair.change || '0').toString()) < 0 ? '#ff5c8a' : '#8fb3c9')))
          }}>
            {parseFloat((currentPair.change || '0').toString()) > 0 ? '+' : ''}{currentPair.change}%
          </span>
        </div>

        {/* Navigation Tabs Row */}
        <div style={{ 
          display: 'flex', 
          gap: 8,
          padding: '0 16px 12px 16px',
          overflowX: 'auto'
        }}>
          <button
            style={{ 
              background: tradeView === 'chart' 
                ? (theme === 'dark' ? 'rgba(77, 163, 255, 0.15)' : 'rgba(77, 163, 255, 0.1)')
                : 'transparent',
              border: `1.5px solid ${tradeView === 'chart' ? '#4da3ff' : (theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)')}`,
              padding: '10px 18px',
              borderRadius: '8px',
              color: tradeView === 'chart' ? '#4da3ff' : '#8fb3c9',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '14px',
              flex: 1,
              minWidth: 'fit-content',
              transition: 'all 0.2s ease'
            }}
            onClick={() => setTradeView('chart')}
          >
            📈 {t('app.chart')}
          </button>
          <button
            style={{ 
              background: tradeView === 'orderbook' 
                ? (theme === 'dark' ? 'rgba(77, 163, 255, 0.15)' : 'rgba(77, 163, 255, 0.1)')
                : 'transparent',
              border: `1.5px solid ${tradeView === 'orderbook' ? '#4da3ff' : (theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)')}`,
              padding: '10px 18px',
              borderRadius: '8px',
              color: tradeView === 'orderbook' ? '#4da3ff' : '#8fb3c9',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '14px',
              flex: 1,
              minWidth: 'fit-content',
              transition: 'all 0.2s ease'
            }}
            onClick={() => setTradeView('orderbook')}
          >
            📊 {t('app.orderbook')}
          </button>
          <button
            style={{ 
              background: tradeView === 'trades' 
                ? (theme === 'dark' ? 'rgba(77, 163, 255, 0.15)' : 'rgba(77, 163, 255, 0.1)')
                : 'transparent',
              border: `1.5px solid ${tradeView === 'trades' ? '#4da3ff' : (theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)')}`,
              padding: '10px 18px',
              borderRadius: '8px',
              color: tradeView === 'trades' ? '#4da3ff' : '#8fb3c9',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '14px',
              flex: 1,
              minWidth: 'fit-content',
              transition: 'all 0.2s ease'
            }}
            onClick={() => setTradeView('trades')}
          >
            💱 {t('app.trades')}
          </button>
        </div>
      </div>

      {tradeView === 'chart' && (
        <div style={{ 
          position: 'absolute',
          top: '140px',
          left: 0,
          right: 0,
          bottom: '64px',
          width: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Full Chart */}
          <div style={{ 
            flex: 1,
            width: '100%',
            height: '100%',
            padding: 0, 
            background: 'transparent', 
            border: 'none',
            display: 'flex',
            flexDirection: 'column'
          }} className="card chart-card mobile-chart-container">
            {currentPair.base.symbol === 'WBNB' && currentPair.quote.symbol === 'USDC' ? (
              <iframe
                key={`tradingview-${theme}`}
                title="TradingView Chart"
                width="100%"
                height="100%"
                src={`https://www.tradingview.com/widgetembed/?frameElementId=tradingview_chart&symbol=BINANCE:BNBUSDT&interval=30&hidesidetoolbar=1&symboledit=1&saveimage=1&toolbarbg=f1f3f6&studies=[]&theme=${theme}&style=1&timezone=Etc%2FUTC&withdateranges=1&showpopupbutton=1&studies_overrides={}&overrides={}&enabled_features=[]&disabled_features=[]&showpopupbutton=1&locale=en`}
                style={{ width: '100%', height: '100%', border: 'none', borderRadius: 0, display: 'block' }}
                allow="clipboard-write; web-share; fullscreen"
              />
            ) : geckoPoolId ? (
              <iframe
                key={`geckoterminal-${theme}`}
                className="chart-embed mobile-chart-embed"
                title="GeckoTerminal Chart"
                src={`https://www.geckoterminal.com/${geckoPoolId}?embed=1&info=0&swaps=0&light_chart=${theme === 'light' ? 1 : 0}`}
                width="100%"
                height="100%"
                style={{ border: 0, borderRadius: 0, width: '100%', height: '100%', display: 'block' }}
                allow="clipboard-write; web-share; fullscreen"
              />
            ) : (
              <div style={{
                flex: 1,
                width: '100%',
                borderRadius: 8,
                border: '1px dashed rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#8fb3c9',
                padding: '20px',
                textAlign: 'center'
              }}>
                Enter a GeckoTerminal pool path like "bsc/pools/0x..." to load the chart.
              </div>
            )}
          </div>
        </div>
      )}

      {tradeView === 'trades' && (
        <div style={{
          flex: 1,
          overflowY: 'auto',
          paddingBottom: '80px',
          background: theme === 'dark' ? '#0b0f14' : '#f6f8fb'
        }}>
          <div style={{ background: theme === 'dark' ? '#0b0f14' : '#f6f8fb' }}>
            <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', paddingLeft: '16px', paddingRight: '16px', paddingTop: '16px' }}>
              {t('app.recentTrades')}
            </div>

            {/* Header Row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '50px 1fr 1fr 1fr 55px 60px',
              gap: '6px',
              padding: '8px 8px',
              fontSize: '11px',
              color: '#8fb3c9',
              fontWeight: '600',
              borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
              marginBottom: '8px'
            }}>
              <div>Side</div>
              <div style={{ textAlign: 'right' }}>Price</div>
              <div style={{ textAlign: 'right' }}>Amount</div>
              <div style={{ textAlign: 'right' }}>Total</div>
              <div style={{ textAlign: 'right' }}>Time</div>
              <div style={{ textAlign: 'center' }}>Tx</div>
            </div>

            {/* Loading/Error States */}
            {fillsLoading && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#8fb3c9' }}>
                Loading trades...
              </div>
            )}
            {fillsError && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#ff5c8a' }}>
                Error: {fillsError}
              </div>
            )}

            {/* Trades List */}
            {!fillsLoading && !fillsError && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {recentFills.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#8fb3c9' }}>
                    No recent trades
                  </div>
                ) : (
                  recentFills.slice(0, 20).map((fill, index) => {
                    const price = (Number(fill.amountQuote) / (10 ** quoteDecimals)) / (Number(fill.amountBase) / (10 ** baseDecimals))
                    const priceStr = formatPrice(price)
                    const amountBaseStr = fill.amountBaseReadable || formatUnitsStr(fill.amountBase, baseDecimals, 6)
                    const totalQuoteStr = fill.amountQuoteReadable || formatUnitsStr(fill.amountQuote, quoteDecimals, 6)
                    const timeStr = new Date(fill.createdAt).toLocaleTimeString()
                    const network = currentPair?.network || 'bsc'
                    const explorerUrl = network === 'base' ? 'https://basescan.org' : 'https://bscscan.com'

                    return (
                      <div
                        key={`trade-${index}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '50px 1fr 1fr 1fr 55px 60px',
                          gap: '6px',
                          padding: '10px 8px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          borderRadius: '6px',
                          fontSize: '12px',
                          alignItems: 'center'
                        }}
                      >
                        <div style={{
                          color: '#00e39f',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          fontSize: '10px'
                        }}>
                          TRADE
                        </div>
                        <div style={{ 
                          textAlign: 'right',
                          fontWeight: '600',
                          color: theme === 'dark' ? '#fff' : '#000',
                          fontSize: '12px'
                        }}>
                          ${priceStr}
                        </div>
                        <div style={{
                          textAlign: 'right',
                          fontWeight: '500',
                          fontSize: '12px'
                        }}>
                          {amountBaseStr} {currentPair.base.symbol}
                        </div>
                        <div style={{
                          textAlign: 'right',
                          color: '#8fb3c9',
                          fontSize: '11px'
                        }}>
                          {totalQuoteStr} {currentPair.quote.symbol}
                        </div>
                        <div style={{ 
                          textAlign: 'right',
                          color: '#8fb3c9',
                          fontSize: '10px'
                        }}>
                          {timeStr}
                        </div>
                        <div style={{
                          textAlign: 'center'
                        }}>
                          {(() => {
                            // Handle crosschain transactions with multiple tx hashes
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
                                    style={{ color: '#4da3ff', textDecoration: 'underline', fontSize: 10, marginRight: 2 }}
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
                                    style={{ color: '#4da3ff', textDecoration: 'underline', fontSize: 10, marginRight: 2 }}
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
                                    style={{ color: '#2ecc71', textDecoration: 'underline', fontSize: 10, marginRight: 2 }}
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

                              return links.length > 0 ? links : <span style={{ fontSize: 10, color: '#8fb3c9' }}>Processing</span>
                            } else {
                              // Regular transaction
                              return fill.txHash ? (
                                <a
                                  href={`${explorerUrl}/tx/${fill.txHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    color: '#4da3ff',
                                    textDecoration: 'none',
                                    fontSize: '16px',
                                    display: 'inline-block',
                                    lineHeight: 1
                                  }}
                                  title={`View on ${network === 'base' ? 'BaseScan' : 'BscScan'}`}
                                >
                                  🔗
                                </a>
                              ) : (
                                <span style={{ fontSize: '10px', color: '#8fb3c9' }}>...</span>
                              )
                            }
                          })()}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tradeView === 'orderbook' && (
        <div style={{
          flex: 1,
          overflowY: 'auto',
          paddingBottom: '80px',
          background: theme === 'dark' ? '#0b0f14' : '#f6f8fb'
        }}>
          <div style={{ background: theme === 'dark' ? '#0b0f14' : '#f6f8fb' }}>
            <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', paddingLeft: '16px', paddingRight: '16px', paddingTop: '16px' }}>
              {t('app.orderBook')}
            </div>

            {/* Loading/Error States */}
            {obLoading && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#8fb3c9' }}>
                Loading orderbook...
              </div>
            )}
            {obError && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#ff5c8a' }}>
                Error: {obError}
              </div>
            )}

            {/* Side by Side Layout */}
            {!obLoading && !obError && (
              <div style={{ display: 'flex', gap: '12px' }}>
                {/* Bids (Buy Orders) - LEFT SIDE */}
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    fontSize: '13px', 
                    color: '#00e39f', 
                    fontWeight: '600', 
                    marginBottom: '10px',
                    paddingBottom: '8px',
                    borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                  }}>
                    {t('app.buyBid')}
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    color: '#8fb3c9',
                    fontWeight: '500',
                    marginBottom: '8px',
                    paddingLeft: '6px',
                    paddingRight: '6px'
                  }}>
                    <span>Price</span>
                    <span>Size</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {obBids.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: '#8fb3c9', fontSize: '12px' }}>
                        No buy orders
                      </div>
                    ) : (
                      obBids.slice(0, 8).map((bid, index) => {
                        const row = computeObRow(bid)
                        return (
                          <div
                            key={`bid-${index}`}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              padding: '8px 6px',
                              background: 'rgba(0, 227, 159, 0.08)',
                              borderRadius: '4px',
                              fontSize: '12px'
                            }}
                          >
                            <span style={{ color: '#00e39f', fontWeight: '600' }}>${row.priceStr}</span>
                            <span style={{ fontWeight: '500' }}>{row.amountBaseStr}</span>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Asks (Sell Orders) - RIGHT SIDE */}
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    fontSize: '13px', 
                    color: '#ff5c8a', 
                    fontWeight: '600', 
                    marginBottom: '10px',
                    paddingBottom: '8px',
                    borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                  }}>
                    {t('app.sellAsk')}
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    color: '#8fb3c9',
                    fontWeight: '500',
                    marginBottom: '8px',
                    paddingLeft: '6px',
                    paddingRight: '6px'
                  }}>
                    <span>Price</span>
                    <span>Size</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {obAsks.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: '#8fb3c9', fontSize: '12px' }}>
                        No sell orders
                      </div>
                    ) : (
                      obAsks.slice(0, 8).map((ask, index) => {
                        const row = computeObRow(ask)
                        return (
                          <div
                            key={`ask-${index}`}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              padding: '8px 6px',
                              background: 'rgba(255, 92, 138, 0.08)',
                              borderRadius: '4px',
                              fontSize: '12px'
                            }}
                          >
                            <span style={{ color: '#ff5c8a', fontWeight: '600' }}>${row.priceStr}</span>
                            <span style={{ fontWeight: '500' }}>{row.amountBaseStr}</span>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Buy/Sell Buttons */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        gap: 0,
        zIndex: 1000,
        borderTop: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`
      }}>
        <button
          onClick={() => handleOpenModal('buy')}
          style={{
            flex: 1,
            padding: '18px',
            borderRadius: 0,
            background: '#00e39f',
            color: '#000',
            border: 'none',
            fontSize: '16px',
            fontWeight: '700',
            cursor: 'pointer',
            boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.15)',
            letterSpacing: '0.5px',
            textTransform: 'uppercase'
          }}
        >
          {t('app.buy')} {currentPair.base.symbol}
        </button>
        <button
          onClick={() => handleOpenModal('sell')}
          style={{
            flex: 1,
            padding: '18px',
            borderRadius: 0,
            background: '#ff5c8a',
            color: '#fff',
            border: 'none',
            fontSize: '16px',
            fontWeight: '700',
            cursor: 'pointer',
            boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.15)',
            letterSpacing: '0.5px',
            textTransform: 'uppercase'
          }}
        >
          {t('app.sell')} {currentPair.base.symbol}
        </button>
      </div>
    </div>
  );
};

export default MobileTrade;
