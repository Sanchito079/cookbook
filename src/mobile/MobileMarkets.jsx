import React, { useState, useEffect } from 'react';
import { useThemeStyles } from '../theme';
import { formatPrice } from '../helpers';
import { useTranslation } from 'react-i18next';
import './MobileMarkets.css';
import { Twitter } from 'lucide-react';
import { SiTelegram, SiDiscord } from 'react-icons/si';

// Indexer base URL (override with VITE_INDEXER_BASE for prod)
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
const TokenLogo = ({ token, size = 24 }) => {
  const logoUrl = getTokenLogo(token);
  const [imageError, setImageError] = React.useState(false);
  
  if (logoUrl && !imageError) {
    return (
      <img
        src={logoUrl}
        alt={token.symbol}
        className="token-logo"
        style={{ width: `${size}px`, height: `${size}px` }}
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
    <div className="token-logo-placeholder" style={{
      width: `${size}px`,
      height: `${size}px`,
      background: bgColor,
      fontSize: `${size * 0.5}px`
    }}>
      {firstLetter}
    </div>
  );
};


const MobileMarkets = ({ searchQuery, onSelectPair, account, selectedNetwork: propSelectedNetwork, onNetworkChange }) => {
   const { theme, styles } = useThemeStyles();
   const { t } = useTranslation();
  // Use prop selectedNetwork or load from localStorage
  const [selectedNetwork, setSelectedNetwork] = useState(() => {
    try {
      const saved = propSelectedNetwork || localStorage.getItem('selectedNetwork');
      console.log('[MOBILE NETWORK DEBUG] Loading from props/localStorage:', saved);
      const network = saved || 'bsc';
      console.log('[MOBILE NETWORK DEBUG] Initial network set to:', network);
      return network;
    } catch (e) {
      console.error('[MOBILE NETWORK DEBUG] Error loading from localStorage:', e);
      return 'bsc';
    }
  });
  const [filterType, setFilterType] = useState('all');
  const [showFilterModal, setShowFilterModal] = useState(false);

  // Filter modal state
  const [modalNetwork, setModalNetwork] = useState(() => {
    try {
      const saved = localStorage.getItem('selectedNetwork');
      return saved || 'bsc';
    } catch {
      return 'bsc';
    }
  });
  const [modalCategory, setModalCategory] = useState('all');
  const [minMarketCap, setMinMarketCap] = useState('');
  const [maxMarketCap, setMaxMarketCap] = useState('');
  const [minPriceChange, setMinPriceChange] = useState('');
  const [maxPriceChange, setMaxPriceChange] = useState('');

  // Markets data state
  const [markets, setMarkets] = useState([]);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketsError, setMarketsError] = useState('');
  const [totalMarkets, setTotalMarkets] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100);
  // Global search state
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const isSearching = (searchQuery || '').trim().length > 0


  const modalNetworks = [
    { id: 'bsc', label: 'BSC' },
    { id: 'base', label: 'Base' },
    { id: 'crosschain', label: 'Crosschain' }
  ];

  // Update selectedNetwork when prop changes
  useEffect(() => {
    if (propSelectedNetwork && propSelectedNetwork !== selectedNetwork) {
      console.log('[MOBILE NETWORK DEBUG] Updating selectedNetwork from prop:', propSelectedNetwork);
      setSelectedNetwork(propSelectedNetwork);
    }
  }, [propSelectedNetwork, selectedNetwork]);

  // Update modalNetwork when selectedNetwork changes to keep filter in sync
  useEffect(() => {
    setModalNetwork(selectedNetwork);
  }, [selectedNetwork]);

  // Persist selected network to localStorage
  useEffect(() => {
    try {
      console.log('[MOBILE NETWORK DEBUG] Saving to localStorage:', selectedNetwork);
      localStorage.setItem('selectedNetwork', selectedNetwork);
      console.log('[MOBILE NETWORK DEBUG] Saved successfully. Current localStorage value:', localStorage.getItem('selectedNetwork'));
    } catch (e) {
      console.error('[MOBILE NETWORK DEBUG] Failed to save selected network to localStorage:', e);
    }
  }, [selectedNetwork]);

  const categories = [
    { id: 'all', label: t('app.allLabel') },
    { id: 'trending', label: t('app.trendingLabel') },
    { id: 'new', label: t('app.newLabel') },
    { id: 'volume', label: t('app.volumeLabel') },
    { id: 'market_cap', label: t('app.marketCapLabel') }
  ];

  const applyFilters = () => {
    console.log('[MOBILE NETWORK DEBUG] Applying filters. Modal network:', modalNetwork);
    // Update local state immediately for UI responsiveness
    setSelectedNetwork(modalNetwork);
    setFilterType(modalCategory);
    setShowFilterModal(false);
    // Notify parent to make selectedNetwork a single source of truth
    try {
      if (onNetworkChange && typeof onNetworkChange === 'function') {
        onNetworkChange(modalNetwork);
      } else {
        // Fallback: persist here if parent did not provide a handler
        try { localStorage.setItem('selectedNetwork', modalNetwork); } catch {}
      }
    } catch (e) {
      console.warn('[MOBILE NETWORK DEBUG] onNetworkChange failed:', e);
    }
  };

  const cancelFilters = () => {
    // Reset modal state to current values
    setModalNetwork(selectedNetwork);
    setModalCategory(filterType);
    setMinMarketCap('');
    setMaxMarketCap('');
    setMinPriceChange('');
    setMaxPriceChange('');
    setShowFilterModal(false);
  };

  // Load markets from API
  const loadMarkets = async (page = 1) => {
    setMarketsLoading(true);
    setMarketsError('');
    try {
      // Use higher limit when searching to include more pairs
      const limit = searchQuery.trim() ? 1000 : itemsPerPage;
      const url = `${INDEXER_BASE}/api/markets/wbnb/new?network=${selectedNetwork}&pages=3&duration=1h&page=${page}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const newMarketsRaw = Array.isArray(json.data) ? json.data : [];
      // Normalize network field to avoid UI crashes (especially for crosschain hardcoded entries)
      const newMarkets = newMarketsRaw.map(m => ({ ...m, network: m.network || selectedNetwork }));
      console.log('[FRONTEND DEBUG] Loaded markets with watch counts:', newMarkets.slice(0, 5).map(m => `${m.pair}: ${m.watch_count}`))
      setMarkets(newMarkets);
      setTotalMarkets(json.total || 0);
      setTotalPages(Math.ceil((json.total || 0) / itemsPerPage));
      setCurrentPage(page);
    } catch (e) {
      console.error('Markets fetch error:', e);
      setMarketsError(e?.message || String(e));
    } finally {
      setMarketsLoading(false);
    }
  };

  // Load markets on mount and when network changes
  useEffect(() => {
    loadMarkets(1);
  }, [selectedNetwork]);

  // Reset page and load markets only when not searching
  useEffect(() => {
    setCurrentPage(1);
    if ((searchQuery || '').trim()) {
      return;
    }
    loadMarkets(1);
  }, [searchQuery, selectedNetwork]);

  // Backend search effect (fetch all matches across DB when typing)
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
          const res = await fetch(`${INDEXER_BASE}/api/markets/search?network=${net}&q=${encodeURIComponent(q)}`)
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


  const hasTradingData = (market) => {
    const price = market.price && market.price !== '-' && market.price !== '0.00';
    const volume = market.volume && market.volume !== '0' && parseFloat(market.volume.replace(/,/g, '')) > 0;
    const change = market.change && market.change !== '0.00';
    return price || volume || change;
  };

  const baseList = isSearching ? searchResults : markets
  const filteredMarkets = baseList.filter(market => {
    // When searching, backend already filtered
    const matchesSearch = isSearching ? true : (
      searchQuery === '' ||
      market.pair.toLowerCase().includes(searchQuery.toLowerCase()) ||
      market.base.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      market.quote.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Apply pair filter logic
    let matchesFilter = true;
    switch (filterType) {
      case 'recent':
        // For now, sort by volume as proxy for recent activity
        break;
      case 'trending':
        // Sort by volume (highest first)
        break;
      case 'new':
        // For now, sort by volume as proxy for new pairs
        break;
      case 'volume':
        // Sort by volume (highest first)
        break;
      case 'gainers':
        // Sort by positive change (highest first)
        break;
      case 'losers':
        // Sort by negative change (most negative first)
        break;
      case 'all':
      default:
        matchesFilter = true;
        break;
    }

    return matchesSearch && matchesFilter;
  }).sort((a, b) => {
    // Apply sorting based on filter type
    switch (filterType) {
      case 'trending':
      case 'recent':
      case 'new':
      case 'volume':
        const aVol = parseFloat(a.volume.replace(/,/g, ''));
        const bVol = parseFloat(b.volume.replace(/,/g, ''));
        return bVol - aVol;
      case 'gainers':
        const aChange = parseFloat(a.change);
        const bChange = parseFloat(b.change);
        return bChange - aChange;
      case 'losers':
        const aChangeLosers = parseFloat(a.change);
        const bChangeLosers = parseFloat(b.change);
        return aChangeLosers - bChangeLosers;
      case 'all':
      default:
        // Prioritize pairs with trading data, then sort by volume
        const aHas = hasTradingData(a);
        const bHas = hasTradingData(b);
        if (aHas !== bHas) {
          return bHas - aHas;
        }
        const aVolAll = parseFloat((a.volume || '0').replace(/,/g, ''));
        const bVolAll = parseFloat((b.volume || '0').replace(/,/g, ''));
        return bVolAll - aVolAll;
    }
  });

  const handleSelectPair = (market) => {
    // Navigate to trade screen with selected pair
    if (onSelectPair) {
      onSelectPair(market);
    } else {
      console.warn('onSelectPair prop is not provided');
    }
  };

  return (
    <div className={`mobile-markets-container ${theme}`}>

      {/* Filter Button */}
      <div className="mobile-markets-filter-btn-wrapper">
        <button
          onClick={() => setShowFilterModal(true)}
          className="mobile-markets-filter-btn"
        >
          {t('app.filter')}
        </button>
      </div>

      {/* Markets List Header - Column Labels */}
      <div className="mobile-markets-header">
        <div className="market-col-pair">Pair</div>
        <div className="market-col-price">Price</div>
        <div className="market-col-change">24h %</div>
        <div className="market-col-volume">24h Vol</div>
      </div>

      {/* Markets List */}
      <div className="mobile-markets-list">
        {/* Skeleton Loaders */}
        {marketsLoading && !isSearching && (
          <>
            {[...Array(8)].map((_, index) => (
              <div key={`skeleton-${index}`} className="skeleton-row">
                {/* Pair Column */}
                <div className="skeleton-col-pair">
                  <div className="skeleton-pair-top">
                    <div className="skeleton skeleton-token-icon"></div>
                    <div className="skeleton skeleton-pair-name"></div>
                  </div>
                  <div className="skeleton-pair-bottom">
                    <div className="skeleton skeleton-network"></div>
                    <div className="skeleton skeleton-watch"></div>
                    <div className="skeleton skeleton-copy"></div>
                  </div>
                </div>
                {/* Price Column */}
                <div className="skeleton skeleton-price"></div>
                {/* Change Column */}
                <div className="skeleton skeleton-change"></div>
                {/* Volume Column */}
                <div className="skeleton skeleton-volume"></div>
              </div>
            ))}
          </>
        )}

        {/* Real Market Data */}
        {!marketsLoading && filteredMarkets.map((market, index) => {
          const priceNum = parseFloat(market.price || 0);
          const changeNum = parseFloat(market.change || 0);
          const volumeNum = parseFloat((market.volume || '0').replace(/,/g, ''));
          
          // Format volume to be compact (K, M, B)
          const formatVolume = (vol) => {
            if (vol >= 1000000000) return `${(vol / 1000000000).toFixed(2)}B`;
            if (vol >= 1000000) return `${(vol / 1000000).toFixed(2)}M`;
            if (vol >= 1000) return `${(vol / 1000).toFixed(2)}K`;
            return vol.toFixed(2);
          };

          const changeClass = changeNum > 0 ? 'positive' : changeNum < 0 ? 'negative' : 'neutral';

          return (
            <div
              key={index}
              className="market-row"
              onClick={() => handleSelectPair(market)}
            >
              {/* Pair Column */}
              <div className="market-col-pair">
                <div className="market-pair-symbols">
                  <TokenLogo token={market.base} size={20} />
                  <span className="market-pair-name">{market.base.symbol}/{market.quote.symbol}</span>
                </div>
                <div className="market-pair-bottom">
                  <div className="market-pair-network">
                    {((market.network || (selectedNetwork === 'crosschain' ? 'crosschain' : selectedNetwork || 'bsc'))).toUpperCase()}
                  </div>
                  <span className="market-pair-watchcount">
                    <span style={{ fontSize: '8px' }}>👁</span>
                    {market.watch_count || 0}
                  </span>
                  <button
                    className="market-pair-copy"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(market.base.address);
                    }}
                    title="Copy base address"
                  >
                    📋
                  </button>
                </div>
              </div>

              {/* Price Column */}
              <div className="market-col-price">
                ${formatPrice(market.price)}
              </div>

              {/* 24h Change Column */}
              <div className={`market-col-change ${changeClass}`}>
                {changeNum > 0 ? '+' : ''}{changeNum.toFixed(2)}%
              </div>

              {/* 24h Volume Column */}
              <div className="market-col-volume">
                ${formatVolume(volumeNum)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination Controls */}
      {!isSearching && totalPages > 1 && (
        <div className="mobile-markets-pagination">
          <button
            onClick={() => {
              const newPage = Math.max(1, currentPage - 1);
              loadMarkets(newPage);
            }}
            disabled={currentPage === 1 || marketsLoading}
            className={`pagination-btn ${currentPage === 1 ? 'disabled' : ''}`}
          >
            ‹ Prev
          </button>

          <span className="pagination-info">
            {currentPage} / {totalPages}
          </span>

          <button
            onClick={() => {
              const newPage = Math.min(totalPages, currentPage + 1);
              loadMarkets(newPage);
            }}
            disabled={currentPage >= totalPages || marketsLoading}
            className={`pagination-btn ${currentPage >= totalPages ? 'disabled' : ''}`}
          >
            Next ›
          </button>
        </div>
      )}

      {/* Loading and Error States */}
      {isSearching && searchLoading && (
        <div className="mobile-markets-message">
          Searching markets...
        </div>
      )}

      {isSearching && searchError && (
        <div className="mobile-markets-message error">
          Error searching markets: {searchError}
        </div>
      )}

      {!isSearching && marketsError && (
        <div className="mobile-markets-message error">
          Error loading markets: {marketsError}
        </div>
      )}

      {!marketsLoading && !marketsError && filteredMarkets.length === 0 && (
        <div className="mobile-markets-message">
          No markets found matching your criteria
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

      {/* Filter Modal */}
      {showFilterModal && (
        <div className={`mobile-markets-modal-overlay ${theme}`}>
          <div className={`mobile-markets-modal ${theme}`}>
            <div className="modal-header">
              <div className="modal-title">{t('app.filter')}</div>
            </div>

            {/* Network Selector */}
            <div className="modal-section">
              <div className="modal-section-title">{t('app.network')}</div>
              <div className="modal-radio-group">
                {modalNetworks.map(network => (
                  <label key={network.id} className="modal-radio-label">
                    <input
                      type="radio"
                      name="network"
                      value={network.id}
                      checked={modalNetwork === network.id}
                      onChange={(e) => {
                        const newNetwork = e.target.value;
                        console.log('[MOBILE NETWORK DEBUG] Modal network radio changed to:', newNetwork);
                        setModalNetwork(newNetwork);
                      }}
                      className="modal-radio-input"
                    />
                    <span className="modal-radio-text">{network.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Category Filters */}
            <div className="modal-section">
              <div className="modal-section-title">{t('app.category')}</div>
              <div className="modal-radio-group">
                {categories.map(category => (
                  <label key={category.id} className="modal-radio-label">
                    <input
                      type="radio"
                      name="category"
                      value={category.id}
                      checked={modalCategory === category.id}
                      onChange={(e) => setModalCategory(e.target.value)}
                      className="modal-radio-input"
                    />
                    <span className="modal-radio-text">{category.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Market Cap Range */}
            <div className="modal-section">
              <div className="modal-section-title">{t('app.marketCapRange')}</div>
              <div className="modal-input-group">
                <input
                  type="number"
                  placeholder={t('app.min')}
                  value={minMarketCap}
                  onChange={(e) => setMinMarketCap(e.target.value)}
                  className="modal-input"
                />
                <input
                  type="number"
                  placeholder={t('app.max')}
                  value={maxMarketCap}
                  onChange={(e) => setMaxMarketCap(e.target.value)}
                  className="modal-input"
                />
              </div>
            </div>

            {/* Price Change Filter */}
            <div className="modal-section">
              <div className="modal-section-title">{t('app.priceChange')}</div>
              <div className="modal-input-group">
                <input
                  type="number"
                  placeholder={t('app.minPercent')}
                  value={minPriceChange}
                  onChange={(e) => setMinPriceChange(e.target.value)}
                  className="modal-input"
                />
                <input
                  type="number"
                  placeholder={t('app.maxPercent')}
                  value={maxPriceChange}
                  onChange={(e) => setMaxPriceChange(e.target.value)}
                  className="modal-input"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="modal-actions">
              <button onClick={cancelFilters} className="modal-btn-cancel">
                {t('app.cancel')}
              </button>
              <button onClick={applyFilters} className="modal-btn-apply">
                {t('app.apply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileMarkets;
