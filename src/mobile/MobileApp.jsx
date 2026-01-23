import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useThemeStyles } from '../theme';
import { DynamicWidget, useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { BrowserProvider, Contract } from 'ethers';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

// Mobile-specific components
import MobileMarkets from './MobileMarkets';
import MobileTrade from './MobileTrade';
import MobileOrders from './MobileOrders';
import MobileWatchlist from './MobileWatchlist';

// Network constants
const BSC_CHAIN_ID = 56;
const BSC_HEX = '0x38';
const BSC_PARAMS = {
  chainId: BSC_HEX,
  chainName: 'BNB Smart Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: ['https://bsc-dataseed.defibit.io/'],
  blockExplorerUrls: ['https://bscscan.com']
};

const BASE_CHAIN_ID = 8453;
const BASE_HEX = '0x2105';
const BASE_PARAMS = {
  chainId: BASE_HEX,
  chainName: 'Base',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org'],
  blockExplorerUrls: ['https://basescan.org']
};

const MobileApp = ({ theme: propTheme }) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('markets');
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [selectedPair, setSelectedPair] = useState(null);
    const [geckoPoolId, setGeckoPoolId] = useState('');
    const { theme, styles, toggleTheme } = useThemeStyles();
    const currentTheme = propTheme || theme;
    console.log('MobileApp theme:', currentTheme, 'propTheme:', propTheme, 'hookTheme:', theme);

    // Wallet state
    const [account, setAccount] = useState(null);
    const [chainId, setChainId] = useState(null);
    const [status, setStatus] = useState('');
    const [selectedNetwork, setSelectedNetwork] = useState(() => {
      try {
        return localStorage.getItem('selectedNetwork') || null;
      } catch {
        return null;
      }
    }); // 'bsc' | 'base' | 'crosschain' | null
    const { primaryWallet, setShowDynamicUserProfile, setShowAuthFlow, handleLogOut, logout } = useDynamicContext();
    const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
    const currentNetworkRef = useRef(selectedNetwork);
    const lastChainChangeRef = useRef(0);

    // Apply network selection synchronously to avoid races with chainChanged
    const applySelectedNetwork = (net) => {
      try { localStorage.setItem('selectedNetwork', net); } catch {}
      currentNetworkRef.current = net;
      setSelectedNetwork(net);
    };

   const provider = useMemo(() => {
     try {
       if (selectedNetwork === 'solana') {
         // For Solana, we don't use ethers provider
         return null
       }
       if (primaryWallet?.connector?.getProvider) {
         const w = primaryWallet.connector.getProvider();
         if (w) return new BrowserProvider(w);
       }
       // Fallback to window.ethereum for mobile wallets like Trust Wallet
       if (typeof window !== 'undefined' && window.ethereum) {
         return new BrowserProvider(window.ethereum);
       }
     } catch {}
     return null;
   }, [primaryWallet, selectedNetwork]);

  const handleSearchToggle = () => {
    setIsSearchOpen(!isSearchOpen);
  };

  const closeSearch = () => {
    setIsSearchOpen(false);
    setSearchQuery('');
  };

  const handleSelectPair = async (market) => {
    setSelectedPair(market);
    if (market.geckoPoolId) {
      setGeckoPoolId(market.geckoPoolId);
    }
    // Set network based on pair
    if (market.network === 'crosschain' || (market.base?.network && market.quote?.network && market.base.network !== market.quote.network)) {
      applySelectedNetwork('crosschain');
    } else {
      const newNetwork = market.network || 'bsc';
      applySelectedNetwork(newNetwork);
      // Switch only if current chain differs
      try {
        const eth = (primaryWallet?.connector?.getProvider && primaryWallet.connector.getProvider()) || (typeof window !== 'undefined' && window.ethereum);
        const currentHex = eth && typeof eth.request === 'function' ? await eth.request({ method: 'eth_chainId' }) : null;
        const targetHex = newNetwork === 'base' ? BASE_HEX : BSC_HEX;
        if (currentHex && currentHex !== targetHex) {
          await switchToNetwork(newNetwork);
        }
      } catch (e) {
        console.error('Failed to switch network:', e);
      }
    }
    setActiveTab('trade');
  };

  const handleBackToMarkets = () => {
    setActiveTab('markets');
  };

  // Detect if we're on mobile
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close wallet dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (walletDropdownOpen && !event.target.closest('.wallet-box')) {
        setWalletDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [walletDropdownOpen]);

  // Persist selected network
  useEffect(() => {
    try {
      if (selectedNetwork) {
        localStorage.setItem('selectedNetwork', selectedNetwork);
        currentNetworkRef.current = selectedNetwork;
      }
    } catch {}
  }, [selectedNetwork]);

  // One-time full app refresh after a successful chain change
  useEffect(() => {
    // Listen to chainChanged and trigger a single reload when the chain actually changes
    if (typeof window === 'undefined' || !window.ethereum) return;

    const handleChainChangedReload = (chainIdHex) => {
      // Skip forced reloads while in crosschain mode
      if (currentNetworkRef.current === 'crosschain') return;
      // Map to numeric chainId and compare with lastReloadChain to avoid repeated reloads
      const newChainId = parseInt(chainIdHex, 16);
      const newIdStr = String(newChainId);
      const lastReload = localStorage.getItem('lastReloadChain');
      if (lastReload !== newIdStr) {
        // Mark as reloaded for this chain and perform a single reload
        try { localStorage.setItem('lastReloadChain', newIdStr); } catch {}
        // Small timeout to allow React state updates to flush before reload
        setTimeout(() => { window.location.reload(); }, 50);
      }
    };

    window.ethereum.on('chainChanged', handleChainChangedReload);
    return () => {
      try { window.ethereum.removeListener('chainChanged', handleChainChangedReload); } catch {}
    };
  }, []);

  // Listen for network changes
  useEffect(() => {
    // Listen to window.ethereum chainChanged for direct wallet switches
    if (typeof window !== 'undefined' && window.ethereum) {
      const handleChainChanged = (chainIdHex) => {
        const now = Date.now();
        if (now - lastChainChangeRef.current < 1000) return;
        lastChainChangeRef.current = now;

        const newChainId = parseInt(chainIdHex, 16);
        setChainId(newChainId);
        const newSelected = newChainId === BASE_CHAIN_ID ? 'base' : (newChainId === BSC_CHAIN_ID ? 'bsc' : 'bsc');
        // Don't override if currently in crosschain mode
        if (newSelected !== currentNetworkRef.current && currentNetworkRef.current !== 'crosschain') {
          currentNetworkRef.current = newSelected;
          applySelectedNetwork(newSelected);
          const networkName = newSelected.toUpperCase();
          setStatus(`Connected to ${networkName}`);
          toast.success(`Switched to ${networkName} network`, {
            duration: 3000,
            position: 'top-center'
          });
        }
      };

      window.ethereum.on('chainChanged', handleChainChanged);

      return () => {
        window.ethereum.off('chainChanged', handleChainChanged);
      };
    }
  }, []);

  // Wallet connection effect with restore/infer logic and minimal switching
  useEffect(() => {
    (async () => {
      try {
        if (!primaryWallet) return;

        // Set account from primaryWallet address for all chains
        setAccount(primaryWallet.address || null);

        // Detect Solana wallet
        if (!provider) {
          // For non-EVM chains (like Solana), set network and stop here
          const walletChain = primaryWallet.chain;
          if (walletChain === 'SOL' || walletChain === 'solana') {
            setSelectedNetwork('solana');
            setStatus('Connected to Solana');
          }
          return;
        }

        const eth = (primaryWallet?.connector?.getProvider && primaryWallet.connector.getProvider()) || (typeof window !== 'undefined' && window.ethereum);
        if (!eth || typeof eth.request !== 'function') return;

        const currentHex = await eth.request({ method: 'eth_chainId' });

        if (!selectedNetwork) {
          // Infer network from current wallet chain; no switching on first load
          const inferred = currentHex === BASE_HEX ? 'base' : (currentHex === BSC_HEX ? 'bsc' : 'bsc');
          applySelectedNetwork(inferred);
        } else if (selectedNetwork !== 'crosschain') {
          // Only switch if mismatched
          const targetHex = selectedNetwork === 'base' ? BASE_HEX : BSC_HEX;
          if (currentHex !== targetHex) {
            try { await switchToNetwork(selectedNetwork); } catch {}
          }
        }

        // Get network with error handling
        try {
          const net = await provider.getNetwork();
          setChainId(Number(net.chainId));
        } catch (networkError) {
          if (networkError.code === 'NETWORK_ERROR') {
            // Network changed during call, listener will update state
            console.warn('[NETWORK DEBUG] Network changed during getNetwork, skipping update');
          } else {
            throw networkError;
          }
        }
        const effective = selectedNetwork || (chainId === BASE_CHAIN_ID ? 'base' : 'bsc');
        const networkName = effective === 'crosschain' ? (chainId === BASE_CHAIN_ID ? 'Base' : 'BSC') : (effective === 'solana' ? 'Solana' : effective.toUpperCase());
        setStatus(`Connected to ${networkName}${effective === 'crosschain' ? ' (Cross-Chain Mode)' : ''}`);
      } catch (e) {
        console.error('[NETWORK DEBUG] Error in wallet connection effect:', e);
      }
    })();
  }, [primaryWallet, provider, selectedNetwork, chainId]);

  const getSigner = async () => {
    if (selectedNetwork === 'solana') {
      if (!primaryWallet) throw new Error('No Solana wallet');
      return primaryWallet;
    } else {
      if (!provider) throw new Error('No provider');
      return provider.getSigner();
    }
  };

  const switchToNetwork = async (network = 'bsc') => {
    const eth = (primaryWallet?.connector?.getProvider && primaryWallet.connector.getProvider()) || (typeof window !== 'undefined' && window.ethereum);
    if (!eth || typeof eth.request !== 'function') throw new Error('No wallet provider detected');

    // No network switching for non-EVM or crosschain modes
    if (network === 'solana' || network === 'crosschain') {
      return null;
    }

    // Validate and resolve target chain metadata
    if (network !== 'bsc' && network !== 'base') {
      throw new Error(`Unknown network: ${network}`);
    }
    const targetChainId = network === 'base' ? BASE_CHAIN_ID : BSC_CHAIN_ID;
    const targetHex = network === 'base' ? BASE_HEX : BSC_HEX;
    const targetParams = network === 'base' ? BASE_PARAMS : BSC_PARAMS;

    // Debug: trace switching intent
    try { console.debug('[switchToNetwork]', { network, targetChainId, targetHex }); } catch {}

    const current = await eth.request({ method: 'eth_chainId' });
    if (current === targetHex) return targetChainId;

    // Prefer direct EIP-3326 calls first to avoid connector mapping issues
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetHex }] });
      return targetChainId;
    } catch (e) {
      if (e?.code === 4902 || e?.data?.originalError?.code === 4902) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [targetParams] });
        return targetChainId;
      }
      // Fallback: try connector's switchNetwork once if available
      try {
        if (primaryWallet?.connector?.switchNetwork) {
          await primaryWallet.connector.switchNetwork(targetChainId);
          return targetChainId;
        }
      } catch (_) {}
      throw e;
    }
  };

  const tabs = [
    { id: 'markets', label: t('app.markets'), icon: '📊' },
    { id: 'watchlist', label: t('app.watchlist'), icon: '⭐' },
    { id: 'orders', label: t('app.orders'), icon: '📋' },
    { id: 'docs', label: t('app.docs'), icon: '📖' }
  ];

  const WalletBox = () => {
    const networkName = selectedNetwork === 'bsc' ? 'BSC' : selectedNetwork === 'base' ? 'Base' : 'SOL';
    const shortAddress = account ? `${account.slice(0, 4)}...${account.slice(-3)}` : '';
    return (
      <div className="wallet-box" style={{ position: 'relative', maxWidth: '110px' }}>
        <button
          onClick={() => {
            setShowDynamicUserProfile(true);
            setWalletDropdownOpen(!walletDropdownOpen);
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1px',
            padding: '6px 8px',
            borderRadius: '6px',
            background: theme === 'dark' ? 'rgba(77, 163, 255, 0.12)' : 'rgba(77, 163, 255, 0.08)',
            border: `1.5px solid ${theme === 'dark' ? 'rgba(77, 163, 255, 0.3)' : 'rgba(77, 163, 255, 0.2)'}`,
            color: theme === 'dark' ? '#4da3ff' : '#2563eb',
            fontSize: '11px',
            fontWeight: '600',
            cursor: 'pointer',
            width: '100%',
            minHeight: '36px',
            maxWidth: '110px',
            whiteSpace: 'nowrap',
            outline: 'none',
            overflow: 'hidden'
          }}
        >
          <span style={{ 
            fontSize: '11px', 
            fontWeight: '700',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%'
          }}>{shortAddress}</span>
          <span style={{ 
            fontSize: '9px', 
            fontWeight: '500', 
            opacity: 0.8,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%'
          }}>{networkName} {walletDropdownOpen ? '▲' : '▼'}</span>
        </button>
        {walletDropdownOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: theme === 'dark' ? 'rgba(30, 41, 54, 0.98)' : 'rgba(255, 255, 255, 0.98)',
            border: `1.5px solid ${theme === 'dark' ? 'rgba(77, 163, 255, 0.3)' : 'rgba(77, 163, 255, 0.2)'}`,
            borderRadius: '12px',
            padding: '12px',
            zIndex: 1000,
            minWidth: '180px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            backdropFilter: 'blur(10px)'
          }}>
            <div
              onClick={() => {
                applySelectedNetwork('bsc');
                setWalletDropdownOpen(false);
              }}
              style={{
                padding: '12px 14px',
                cursor: 'pointer',
                borderRadius: '8px',
                background: selectedNetwork === 'bsc' ? 'rgba(77, 163, 255, 0.1)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '14px',
                fontWeight: '600',
                color: theme === 'dark' ? '#e6f1ff' : '#0b0f14',
                marginBottom: '6px',
                transition: 'all 0.2s ease'
              }}
            >
              <img
                src="https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png?1644979850"
                alt="BSC"
                style={{ width: '24px', height: '24px', borderRadius: '50%' }}
              />
              BSC Network
            </div>
            <div
              onClick={() => {
                applySelectedNetwork('base');
                setWalletDropdownOpen(false);
              }}
              style={{
                padding: '12px 14px',
                cursor: 'pointer',
                borderRadius: '8px',
                background: selectedNetwork === 'base' ? 'rgba(77, 163, 255, 0.1)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '14px',
                fontWeight: '600',
                color: theme === 'dark' ? '#e6f1ff' : '#0b0f14',
                marginBottom: '6px',
                transition: 'all 0.2s ease'
              }}
            >
              <img
                src="https://umcpynorlmnedhikkylc.supabase.co/storage/v1/object/public/my%20dex%20logos/images%20(2).png"
                alt="Base"
                style={{ width: '24px', height: '24px', borderRadius: '50%' }}
              />
              Base Network
            </div>
            <div
              onClick={async () => {
                try {
                  if (typeof handleLogOut === 'function') {
                    await handleLogOut();
                  } else if (typeof logout === 'function') {
                    await logout();
                  } else if (primaryWallet?.connector?.endSession) {
                    await primaryWallet.connector.endSession();
                  } else if (primaryWallet?.connector?.disconnect) {
                    await primaryWallet.connector.disconnect();
                  }
                } catch (e) {
                  console.error('Logout failed:', e);
                } finally {
                  setAccount(null);
                  setChainId(null);
                  setStatus('');
                  applySelectedNetwork(null);
                  setShowAuthFlow(false);
                  setShowDynamicUserProfile(false);
                  setWalletDropdownOpen(false);
                  toast.success('Disconnected', { duration: 2000, position: 'top-center' });
                }
              }}
              style={{
                padding: '12px 14px',
                cursor: 'pointer',
                borderRadius: '8px',
                background: 'transparent',
                color: '#ff5c8a',
                fontSize: '14px',
                fontWeight: '600',
                borderTop: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                marginTop: '6px',
                paddingTop: '14px',
                transition: 'all 0.2s ease'
              }}
            >
              🚪 Disconnect Wallet
            </div>
          </div>
        )}
      </div>
    );
  };

  // If not mobile, show a message
  if (!isMobile) {
    return (
      <div style={{
        ...styles.app,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh'
      }}>
        <div style={{
          ...styles.card,
          padding: '40px',
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>📱</div>
          <div style={{ fontSize: '24px', fontWeight: '600', marginBottom: '16px' }}>
            Mobile App
          </div>
          <div style={{ color: '#8fb3c9', marginBottom: '24px' }}>
            This mobile-optimized interface is designed for screens smaller than 768px.
            Please resize your browser window or use a mobile device to see the mobile UI.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              ...styles.btn,
              padding: '12px 24px'
            }}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      ...styles.app,
      padding: '0',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflowX: 'hidden'
    }}>
      <Toaster />

      {/* Mobile Header */}
      <div style={{
        ...styles.header,
        padding: '10px 12px',
        position: 'sticky',
        top: 0,
        zIndex: 200
      }}>
        <div style={{ 
          ...styles.brand, 
          fontSize: '15px', 
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          position: 'relative'
        }}>
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <span style={{ 
              position: 'absolute', 
              top: '-14px', 
              left: '50%', 
              transform: 'translateX(-50%)',
              fontSize: '14px',
              lineHeight: 1
            }}>👨‍🍳</span>
            C
          </span>
          <span>ookbook</span>
         </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            style={{
              padding: '8px',
              borderRadius: '6px',
              background: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
              color: theme === 'dark' ? '#e6f1ff' : '#333',
              cursor: 'pointer',
              fontSize: '16px',
              minWidth: '36px',
              minHeight: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={() => setIsSearchOpen(!isSearchOpen)}
          >
            🔍
          </button>
          <button
            style={{
              padding: '8px',
              borderRadius: '6px',
              background: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
              color: theme === 'dark' ? '#ffa94d' : '#ff8c00',
              cursor: 'pointer',
              fontSize: '16px',
              minWidth: '36px',
              minHeight: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: '500'
            }}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <select
            value={i18n.language}
            onChange={(e) => {
              const lang = e.target.value;
              i18n.changeLanguage(lang);
              localStorage.setItem('selectedLanguage', lang);
            }}
            style={{
              background: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
              borderRadius: '6px',
              color: theme === 'dark' ? '#e6f1ff' : '#333',
              padding: '8px 10px',
              fontSize: '12px',
              fontWeight: '600',
              minHeight: '36px',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="en">EN</option>
            <option value="zh">中文</option>
            <option value="es">ES</option>
            <option value="ru">RU</option>
            <option value="ko">KO</option>
            <option value="pt">PT</option>
            <option value="tr">TR</option>
            <option value="ar">AR</option>
          </select>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {primaryWallet ? <WalletBox /> : <DynamicWidget buttonClassName="btn-secondary" variant="modal" />}
          </div>
        </div>
      </div>

      {/* Search Bar */}
      {isSearchOpen && (
        <div style={{
          padding: '12px 16px',
          background: theme === 'dark' ? '#0b0f14' : '#ffffff',
          borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <input
            type="text"
            placeholder={t('app.searchTokenPairs')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: '8px',
              background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: theme === 'dark' ? '#fff' : '#000',
              fontSize: '16px',
              outline: 'none'
            }}
            autoFocus
          />
          <button
            onClick={closeSearch}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#8fb3c9',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            {t('app.cancel')}
          </button>
        </div>
      )}

      {/* Main Content */}
      <div style={{
        flex: 1,
        paddingTop: '0',
        paddingLeft: '0',
        paddingRight: '0',
        paddingBottom: (activeTab === 'trade') ? '0' : '80px', // Space for bottom nav
        overflowY: activeTab === 'trade' ? 'hidden' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}>
        {activeTab === 'markets' && <MobileMarkets searchQuery={searchQuery} onSelectPair={handleSelectPair} account={account} selectedNetwork={selectedNetwork} onNetworkChange={applySelectedNetwork} />}
        {activeTab === 'watchlist' && <MobileWatchlist onSelectPair={handleSelectPair} account={account} selectedNetwork={selectedNetwork} />}
        {activeTab === 'trade' && <MobileTrade selectedPair={selectedPair} geckoPoolId={geckoPoolId} onGeckoPoolIdChange={setGeckoPoolId} onBackToMarkets={handleBackToMarkets} account={account} provider={provider} getSigner={getSigner} status={status} setStatus={setStatus} selectedNetwork={selectedNetwork} switchToNetwork={switchToNetwork} primaryWallet={primaryWallet} />}
        {activeTab === 'orders' && <MobileOrders selectedPair={selectedPair} account={account} provider={provider} getSigner={getSigner} selectedNetwork={selectedNetwork} primaryWallet={primaryWallet} />}
      </div>

      {/* Bottom Navigation - Hide when in trade view */}
      {activeTab !== 'trade' && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: theme === 'dark' ? 'rgba(8,12,17,0.95)' : 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(10px)',
          borderTop: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          padding: '8px 16px',
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          zIndex: 100
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => tab.id === 'docs' ? window.open('https://docs.cookbook.finance/', '_blank') : setActiveTab(tab.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                padding: '8px',
                borderRadius: '8px',
                background: activeTab === tab.id ? 'rgba(77, 163, 255, 0.1)' : 'transparent',
                color: activeTab === tab.id ? '#4da3ff' : (theme === 'dark' ? '#8fb3c9' : '#666'),
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                minWidth: '60px'
              }}
            >
              <span style={{ fontSize: '16px' }}>{tab.icon}</span>
              <span style={{ fontWeight: activeTab === tab.id ? '600' : '400' }}>
                {tab.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MobileApp;