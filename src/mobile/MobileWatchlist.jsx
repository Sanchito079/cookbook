import React, { useState, useEffect, useCallback } from 'react';
import { useThemeStyles } from '../theme';
import { useTranslation } from 'react-i18next';
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
      return 'https://isfszhhfayylydskdnue.supabase.co/storage/v1/object/public/token-logos/binance-coin-logo%20(2).webp';
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

const MobileWatchlist = ({ onSelectPair, account, selectedNetwork }) => {
   const { theme } = useThemeStyles();
   const { t } = useTranslation();
  const [watchedMarkets, setWatchedMarkets] = useState([]);

  const formatPriceTwoDecimals = (p) => {
    const num = parseFloat(String(p).replace(/,/g, ''));
    if (!Number.isFinite(num)) return '0.00';
    return num.toFixed(2);
  };

  // Load watchlist from database
  const loadWatchlist = useCallback(async () => {
    if (!account) return;
    try {
      // Fetch market data for user's watchlist pairs
      const url = `${INDEXER_BASE}/api/watchlist/markets?user_id=${account}&network=${selectedNetwork}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Watchlist markets request failed:`, res.status);
        setWatchedMarkets([]);
        return;
      }
      const json = await res.json();
      let markets = Array.isArray(json.data) ? json.data : [];
      // Ensure only markets from the connected network are shown (server should scope by network too)
      if (selectedNetwork && selectedNetwork !== 'crosschain') {
        markets = markets.filter(m => (m.network || '').toLowerCase() === String(selectedNetwork).toLowerCase());
      }
      // Deduplicate by stable key: network + poolAddress (if present) else base/quote addresses
      const seen = new Set();
      const deduped = [];
      for (const m of markets) {
        const net = (m.network || selectedNetwork || '').toLowerCase();
        const pool = (m.poolAddress || '').toLowerCase();
        const base = (m.base?.address || '').toLowerCase();
        const quote = (m.quote?.address || '').toLowerCase();
        const key = pool ? `${net}:${pool}` : `${net}:${base}_${quote}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(m);
        }
      }
      setWatchedMarkets(deduped);
    } catch (e) {
      console.error('Watchlist fetch error:', e);
      setWatchedMarkets([]);
    }
  }, [account, selectedNetwork]);


  // Load watchlist when account or selectedNetwork changes
  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  const handleSelectPair = (market) => {
    // Navigate to trade screen with selected pair
    if (onSelectPair) {
      onSelectPair(market);
    } else {
      console.warn('onSelectPair prop is not provided');
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', background: theme === 'dark' ? '#0b0f14' : '#f6f8fb', minHeight: '100vh', paddingTop: '16px', overflowX: 'hidden' }}>
      {/* Watchlist List */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '0 16px' }}>
        {watchedMarkets.map((market, index) => (
          <div key={index}>
            <div
              style={{
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 0'
              }}
              onClick={() => handleSelectPair(market)}
            >
              {/* Left side - Pair */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <TokenLogo token={market.base} size={18} />
                  {market.base.symbol} /
                  <TokenLogo token={market.quote} size={18} />
                  {market.quote.symbol}
                </div>
                <div style={{ fontSize: '11px', color: '#8fb3c9', fontWeight: '500' }}>
                  {market.network.toUpperCase()}
                </div>
              </div>

              {/* Right side - Price, Change, Volume */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                <div style={{ fontSize: '15px', fontWeight: '600' }}>
                  ${formatPriceTwoDecimals(market.price)}
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: (parseFloat(market.change) >= 0 ? '#00e39f' : '#ff5c8a')
                  }}>
                    {market.change || '0.00'}%
                  </div>
                  <div style={{ fontSize: '11px', color: '#8fb3c9' }}>
                    Vol: ${market.volume || '0'}
                  </div>
                </div>
              </div>
            </div>
            {index < watchedMarkets.length - 1 && (
              <div style={{
                height: '1px',
                background: theme === 'dark' 
                  ? 'rgba(255,255,255,0.06)' 
                  : 'rgba(0,0,0,0.08)',
                margin: '0'
              }} />
            )}
          </div>
        ))}
      </div>

      {!account && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: '#8fb3c9',
          fontSize: '16px'
        }}>
          {t('app.connectWalletWatchlist')}
        </div>
      )}

      {account && watchedMarkets.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: '#8fb3c9',
          fontSize: '16px'
        }}>
          {t('app.noPairsWatchlist')}
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

export default MobileWatchlist;