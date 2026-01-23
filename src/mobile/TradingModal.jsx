import React, { useState, useEffect } from 'react';
import { useThemeStyles } from '../theme';
import { Contract, parseUnits, formatUnits, MaxUint256 } from 'ethers';
import { fetchTokenDecimals } from '../helpers_decimals';
import { formatPrice, fetchTokenUsdPrice } from '../helpers';
import bs58 from 'bs58';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

const INDEXER_BASE = (import.meta?.env?.VITE_INDEXER_BASE) || 'https://cookbook-hjnhgq.fly.dev';

const SETTLEMENT_ADDRESS = '0x7DBA6a1488356428C33cC9fB8Ef3c8462c8679d0';
const BASE_SETTLEMENT_ADDRESS = '0xBBf7A39F053BA2B8F4991282425ca61F2D871f45';
const ERC20_ABI = [
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' }
];

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


const TradingModal = ({ isOpen, onClose, initialSide = 'buy', currentPair, account, provider, getSigner, status, setStatus, selectedNetwork, switchToNetwork, primaryWallet }) => {
  const { theme, styles } = useThemeStyles();
  const { t } = useTranslation();
  const [tradeSide, setTradeSide] = useState(initialSide);
  const [isConditional, setIsConditional] = useState(false);
  const [conditionalType, setConditionalType] = useState('stop_loss');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [conditionalExpiration, setConditionalExpiration] = useState('');
  const [amountIn, setAmountIn] = useState('');
  const [amountOutMin, setAmountOutMin] = useState('');
  const [expirationMins, setExpirationMins] = useState('60');
  const [nonce, setNonce] = useState('0');
  const [receiver, setReceiver] = useState('');
  const [salt, setSalt] = useState('0');

  // Allowance and approval state
  const [needsApproval, setNeedsApproval] = useState(false);
  const [smartLabel, setSmartLabel] = useState('Sign Order');
  const [smartBusy, setSmartBusy] = useState(false);

  // Check if crosschain pair
  const isCrossChainPair = React.useMemo(() => {
    if (!currentPair?.base?.network || !currentPair?.quote?.network) return false;
    return currentPair.base.network !== currentPair.quote.network;
  }, [currentPair]);

  // Reset conditional when switching to crosschain
  React.useEffect(() => {
    if (isCrossChainPair && isConditional) {
      setIsConditional(false);
    }
  }, [isCrossChainPair, isConditional]);
  const [tokenInBalance, setTokenInBalance] = useState('');

  // USD values
  const [usdValue, setUsdValue] = useState('');
  const [usdValueMinReceive, setUsdValueMinReceive] = useState('');

  // Track last placed order and resulting tx hash (for mobile toast)
  const [lastPlacedOrderId, setLastPlacedOrderId] = useState(null);
  const [lastOrderSignedAt, setLastOrderSignedAt] = useState(null);
  const [lastTxHash, setLastTxHash] = useState(null);

  useEffect(() => {
    setTradeSide(initialSide);
  }, [initialSide]);

  const randomizeSalt = () => {
    try {
      const buf = new Uint32Array(2);
      crypto.getRandomValues(buf);
      const s = (BigInt(buf[0]) << 32n) + BigInt(buf[1]);
      setSalt(s.toString());
    } catch {
      setSalt(Date.now().toString());
    }
  };

  // Allowance checking
  const checkAndUpdateAllowance = async () => {
    try {
      if (!account || !currentPair) return;

      if (selectedNetwork === 'solana') {
        setNeedsApproval(false);
        setSmartLabel(isConditional ? t('app.createConditionalBtn') : t('app.signBtn'));
        setTokenInBalance('N/A');
        return;
      }

      if (!provider) return;

      const isSell = tradeSide === 'sell';
      const tokenAddr = isSell ? currentPair.base.address : currentPair.quote.address;
      const pairNetwork = currentPair.network || 'bsc'; // overall pair label
      const tokenNetworkRaw = (isSell ? currentPair.base?.network : currentPair.quote?.network);
      const isCrossChainPair = selectedNetwork === 'crosschain' || (currentPair.base?.network && currentPair.quote?.network && currentPair.base.network !== currentPair.quote.network);

      // Decide the network we must be on to read token state
      let intendedNetwork = selectedNetwork === 'crosschain' ? tokenNetworkRaw : selectedNetwork;
      if (!intendedNetwork) {
        // Fallback to current provider network if unknown
        try {
          const netNow = await provider.getNetwork();
          intendedNetwork = Number(netNow.chainId) === 8453 ? 'base' : 'bsc';
        } catch {
          intendedNetwork = pairNetwork === 'base' ? 'base' : 'bsc';
        }
      }
      const expectedChainId = intendedNetwork === 'base' ? 8453 : 56;

      // Ensure provider is on the intended network. If not, request a switch and abort this run.
      try {
        const net = await provider.getNetwork();
        if (Number(net.chainId) !== expectedChainId) {
          // In crosschain mode, do NOT auto-switch networks during passive allowance checks.
          // Auto-switching here caused wallet to jump chains when selecting pairs.
          if (isCrossChainPair) {
            // Skip on-chain allowance read since provider is on a different chain.
            // Default to requiring approval to be safe, but avoid switching networks here.
            setNeedsApproval(true);
            setAllowance('0');
            setCheckingAllowance(false);
            return;
          } else {
            try { await switchToNetwork(intendedNetwork); } catch {}
            return; // wait for provider to update, effect will re-run
          }
        }
      } catch (e) {
        // If provider complains about network change, try switching then exit
        if (e?.code === 'NETWORK_ERROR') {
          try { await switchToNetwork(intendedNetwork); } catch {}
          return;
        }
      }

      const spender = isCrossChainPair ? '0x70c992e6a19c565430fa0c21933395ebf1e907c3' : (intendedNetwork === 'base' ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS);

      // Preflight: verify token contract exists on this chain
      try {
        const code = await provider.getCode(tokenAddr);
        if (!code || code === '0x') {
          console.warn('[BALANCE CHECK] No contract code at token address on current chain:', tokenAddr, 'intendedNetwork:', intendedNetwork);
          setTokenInBalance('0');
          setNeedsApproval(false);
          setSmartLabel(isConditional ? t('app.createConditionalBtn') : t('app.signBtn'));
          return;
        }
      } catch {}

      const erc = new Contract(tokenAddr, ERC20_ABI, provider);
      const requiredStr = amountIn && Number(amountIn) > 0 ? amountIn : '0';
      let decimals = 18;
      try { decimals = await fetchTokenDecimals(tokenAddr, provider, selectedNetwork); } catch { decimals = 18; }
      const required = parseUnits(requiredStr, decimals);

      // Fetch balance
      try {
        const balanceRaw = await erc.balanceOf(account);
        const balanceFormatted = formatUnits(balanceRaw, decimals);
        setTokenInBalance(balanceFormatted);
      } catch (e) {
        console.warn('Balance check error:', e.message);
        // Treat unknown call exceptions as zero balance rather than breaking
        setTokenInBalance('0');
        return;
      }

      // If required is 0, no approval needed (except for crosschain, but since required 0, no)
      if (required === 0n && !isCrossChainPair) {
        setNeedsApproval(false);
        setSmartLabel(isConditional ? t('app.createConditionalBtn') : t('app.signBtn'));
        return;
      }

      try {
        const current = await erc.allowance(account, spender);
        const need = BigInt(current) < required;
        setNeedsApproval(need);
        setSmartLabel(need ? (isConditional ? t('app.approveCreateConditionalBtn') : t('app.approveSignBtn')) : (isConditional ? t('app.createConditionalBtn') : t('app.signBtn')));
      } catch (e) {
        if (e.code === 'NETWORK_ERROR') {
          console.warn('[NETWORK DEBUG] Network changed during allowance check, assuming approval needed');
          setNeedsApproval(true);
          setSmartLabel(isConditional ? t('app.approveCreateConditionalBtn') : t('app.approveSignBtn'));
        } else {
          throw e;
        }
      }
    } catch (e) {
      console.error('Allowance check error:', e);
      setNeedsApproval(true);
      setSmartLabel(isConditional ? t('app.approveCreateConditionalBtn') : t('app.approveSignBtn'));
    }
  };

  // Check allowance when relevant state changes
  useEffect(() => {
    if (account && provider && currentPair) {
      checkAndUpdateAllowance();
    }
  }, [tradeSide, amountIn, account, provider, currentPair, isConditional, selectedNetwork]);

  // Auto-calculate amountOutMin based on amountIn and current price (like desktop)
  useEffect(() => {
    if (!amountIn || !currentPair?.price) return;
    const amtIn = parseFloat(amountIn);
    if (!isFinite(amtIn) || amtIn <= 0) return;
    // currentPair.price may be formatted; strip commas
    const price = typeof currentPair.price === 'number' ? currentPair.price : parseFloat(String(currentPair.price).replace(/,/g, ''));
    if (!isFinite(price) || price <= 0) return;
    let calculated;
    if (tradeSide === 'sell') {
      calculated = amtIn * price; // selling base -> quote
    } else {
      calculated = amtIn / price; // spending quote -> base
    }
    setAmountOutMin(calculated.toFixed(6));
  }, [amountIn, tradeSide, currentPair?.price]);

  // Calculate USD values
  useEffect(() => {
    const calcUsd = async () => {
      // For amountIn
      if (!amountIn || Number(amountIn) <= 0) {
        setUsdValue('');
      } else {
        const tokenToPrice = tradeSide === 'sell' ? currentPair.base : currentPair.quote;
        const tokenNetwork = selectedNetwork === 'crosschain' ? tokenToPrice.network : selectedNetwork;
        const price = await fetchTokenUsdPrice(tokenNetwork, tokenToPrice.address);
        if (price) {
          const usd = Number(amountIn) * price;
          setUsdValue(`$${usd.toFixed(2)}`);
        } else {
          setUsdValue('');
        }
      }

      // For min receive (amountOutMin)
      if (!amountOutMin || Number(amountOutMin) <= 0) {
        setUsdValueMinReceive('');
      } else {
        const tokenToPriceMin = tradeSide === 'sell' ? currentPair.quote : currentPair.base;
        const tokenNetworkMin = selectedNetwork === 'crosschain' ? tokenToPriceMin.network : selectedNetwork;
        const priceMin = await fetchTokenUsdPrice(tokenNetworkMin, tokenToPriceMin.address);
        if (priceMin) {
          const usdMin = Number(amountOutMin) * priceMin;
          setUsdValueMinReceive(`$${usdMin.toFixed(2)}`);
        } else {
          setUsdValueMinReceive('');
        }
      }
    };
    calcUsd();
  }, [amountIn, amountOutMin, tradeSide, currentPair?.base?.address, currentPair?.quote?.address, selectedNetwork]);

  // Poll fills endpoint for the last placed order to surface tx link (mobile)
  useEffect(() => {
    if (!lastPlacedOrderId || !lastOrderSignedAt) return;
    let attempts = 0;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const resp = await fetch(`${INDEXER_BASE}/api/fills?network=${selectedNetwork}&orderId=${lastPlacedOrderId}&since=${lastOrderSignedAt}`);
        if (resp.ok) {
          const json = await resp.json();
          const row = (json?.data || []).find(r => r?.txHash);
          if (row?.txHash) {
            setLastTxHash(row.txHash);
            setStatus(`Trade Executed: ${row.txHash.slice(0, 10)}...`);
            return; // stop polling
          }
        }
      } catch {}
      if (attempts < 30) { // ~60s total at 2s interval
        setTimeout(poll, 2000);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [lastPlacedOrderId, lastOrderSignedAt, selectedNetwork]);

  // Show toast notification when fill completes (mobile)
  useEffect(() => {
    if (!lastTxHash) return;
    const explorerUrl = selectedNetwork === 'base' ? 'https://basescan.org' : 'https://bscscan.com';
    const explorerName = selectedNetwork === 'base' ? 'BaseScan' : 'BscScan';
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
    );
  }, [lastTxHash, selectedNetwork, theme]);

  if (!isOpen || !currentPair) return null;

  // Build order object
  const buildOrder = async () => {
    let makerAddr = account;
    if (!makerAddr) {
      try {
        const s = await getSigner();
        makerAddr = await s.getAddress();
      } catch {}
    }
    if (!makerAddr) throw new Error('Connect wallet first');

    const now = Math.floor(Date.now() / 1000);
    const exp = now + Number(expirationMins || '0') * 60;
    const isSell = tradeSide === 'sell';
    const tokenInAddr = isSell ? currentPair.base.address : currentPair.quote.address;
    const tokenOutAddr = isSell ? currentPair.quote.address : currentPair.base.address;

    let inDecimals, outDecimals;
    if (selectedNetwork === 'solana') {
      // For Solana, fetch decimals via backend-powered helper (no provider needed)
      inDecimals = await fetchTokenDecimals(tokenInAddr, null, 'solana');
      outDecimals = await fetchTokenDecimals(tokenOutAddr, null, 'solana');
    } else {
      inDecimals = await fetchTokenDecimals(tokenInAddr, provider, selectedNetwork);
      outDecimals = await fetchTokenDecimals(tokenOutAddr, provider, selectedNetwork);
    }

    const amountInParsed = parseUnits(amountIn || '0', inDecimals);
    const amountOutMinParsed = parseUnits(amountOutMin || '0', outDecimals);

    return {
      maker: makerAddr,
      tokenIn: tokenInAddr,
      tokenOut: tokenOutAddr,
      amountIn: amountInParsed,
      amountOutMin: amountOutMinParsed,
      expiration: BigInt(exp),
      nonce: BigInt(nonce || '0'),
      receiver: receiver || makerAddr,
      salt: BigInt(salt || '0')
    };
  };

  // Sign order
  const signOrder = async () => {
    try {
      if (selectedNetwork === 'solana') {
        // For Solana, sign the order as message using Dynamic wallet
        if (!primaryWallet?.signMessage) {
          throw new Error('Solana wallet not connected or does not support signing');
        }
        const ord = await buildOrder();
        const message = JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
        const encodedMessage = new TextEncoder().encode(message);
        const signature = await primaryWallet.signMessage(encodedMessage);
        setStatus('Order signed');

        // Post to backend
        const baseAddr = selectedNetwork === 'solana' ? currentPair.base.address : currentPair.base.address.toLowerCase()
        const quoteAddr = selectedNetwork === 'solana' ? currentPair.quote.address : currentPair.quote.address.toLowerCase()
        const payload = {
          network: selectedNetwork,
          base: baseAddr,
          quote: quoteAddr,
          baseSymbol: currentPair.base.symbol,
          quoteSymbol: currentPair.quote.symbol,
          order: JSON.parse(JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
          signature: signature
        };
        const resp = await fetch(`${INDEXER_BASE}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) {
          let errBody = '';
          try { errBody = await resp.text(); } catch {}
          throw new Error(`order post HTTP ${resp.status}${errBody ? `: ${errBody}` : ''}`);
        }
        const rjson = await resp.json();
        setStatus(`Order signed and posted: ${rjson.id || 'ok'}`);
        try {
          const newId = rjson.id || rjson.order_id || rjson.orderId;
          if (newId) {
            setLastPlacedOrderId(newId);
            setLastOrderSignedAt(new Date().toISOString());
          }
        } catch {}
        return;
      }

      if (selectedNetwork !== 'crosschain') {
        await switchToNetwork(selectedNetwork);
      }
      // For crosschain, sign on current network
      const s = await getSigner();
      const ord = await buildOrder();
      const network = currentPair.network || 'bsc';
      const isCrossChainPair = selectedNetwork === 'crosschain' || (currentPair.base?.network && currentPair.quote?.network && currentPair.base.network !== currentPair.quote.network);
      const isSolana = selectedNetwork === 'solana';
      let currentNet;
      if (!isSolana) {
        try {
          currentNet = await provider.getNetwork();
        } catch (e) {
          if (e.code === 'NETWORK_ERROR') {
            console.warn('[NETWORK DEBUG] Network changed during getNetwork in signOrder, using selectedNetwork');
            currentNet = { chainId: selectedNetwork === 'base' ? 8453n : 56n };
          } else {
            throw e;
          }
        }
      } else {
        currentNet = { chainId: 0n };
      }
      // Use correct chainId and settlement address for the selected network
      const targetChainId = isSolana ? 0 : (isCrossChainPair ? Number(currentNet.chainId) : (selectedNetwork === 'base' ? 8453 : 56));
      const settlementAddr = isSolana ? '0x0000000000000000000000000000000000000000' : (isCrossChainPair ? (Number(currentNet.chainId) === 8453 ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS) : (selectedNetwork === 'base' ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS));

      // Ensure we're on the correct network before signing
      let signer = s;
      if (!isSolana && selectedNetwork !== 'crosschain' && Number(currentNet.chainId) !== targetChainId) {
        await switchToNetwork(selectedNetwork);
        // Re-get signer after switch
        signer = await getSigner();
        let currentNetNew;
        try {
          currentNetNew = await provider.getNetwork();
        } catch (e) {
          if (e.code === 'NETWORK_ERROR') {
            console.warn('[NETWORK DEBUG] Network changed during getNetwork after switch in signOrder');
            currentNetNew = { chainId: BigInt(targetChainId) };
          } else {
            throw e;
          }
        }
        if (Number(currentNetNew.chainId) !== targetChainId) {
          throw new Error(`Failed to switch to ${selectedNetwork} network. Please switch manually in your wallet.`);
        }
      }

      let sig;
      if (isSolana) {
        // For Solana, sign the order as message
        const message = JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
        const encodedMessage = new TextEncoder().encode(message);
        const signature = await signer.signMessage(encodedMessage);
        sig = signature;
      } else {
        const domain = {
          name: 'MinimalOrderBook',
          version: '1',
          chainId: targetChainId,
          verifyingContract: settlementAddr
        };
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
        };
        sig = await signer.signTypedData(domain, types, ord);
      }
      setStatus('Order signed');

      // Post to backend
      const baseAddr = selectedNetwork === 'solana' ? currentPair.base.address : currentPair.base.address.toLowerCase()
      const quoteAddr = selectedNetwork === 'solana' ? currentPair.quote.address : currentPair.quote.address.toLowerCase()
      const payload = {
        network: selectedNetwork,
        base: baseAddr,
        quote: quoteAddr,
        baseSymbol: currentPair.base.symbol,
        quoteSymbol: currentPair.quote.symbol,
        order: JSON.parse(JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
        signature: sig
      };
      const resp = await fetch(`${INDEXER_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        let errBody = '';
        try { errBody = await resp.text(); } catch {}
        throw new Error(`order post HTTP ${resp.status}${errBody ? `: ${errBody}` : ''}`);
      }
      const rjson = await resp.json();
      setStatus(`Order signed and posted: ${rjson.id || 'ok'}`);
      try {
        const newId = rjson.id || rjson.order_id || rjson.orderId;
        if (newId) {
          setLastPlacedOrderId(newId);
          setLastOrderSignedAt(new Date().toISOString());
        }
      } catch {}
    } catch (e) {
      console.error(e);
      setStatus(`Sign failed: ${e.shortMessage ?? e.message ?? e}`);
    }
  };

  // Create conditional order
  const createConditionalOrder = async () => {
    try {
      if (selectedNetwork === 'crosschain') {
        throw new Error('Conditional orders are not supported for cross-chain pairs');
      }

      if (selectedNetwork === 'solana') {
        // For Solana, sign the conditional order
        if (!primaryWallet?.signMessage) {
          throw new Error('Solana wallet not connected or does not support signing');
        }
        const ord = await buildOrder()
        const orderTemplate = JSON.parse(JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
        const expirationDate = conditionalExpiration ? new Date(Date.now() + Number(conditionalExpiration) * 24 * 60 * 60 * 1000).toISOString() : null

        // Sign the conditional order data
        const baseAddr = selectedNetwork === 'solana' ? currentPair.base.address : currentPair.base.address.toLowerCase()
        const quoteAddr = selectedNetwork === 'solana' ? currentPair.quote.address : currentPair.quote.address.toLowerCase()
        const conditionalData = {
          network: selectedNetwork,
          maker: account,
          baseToken: baseAddr,
          quoteToken: quoteAddr,
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
        return
      }

      if (selectedNetwork !== 'crosschain') {
        await switchToNetwork(selectedNetwork);
      }
      // For crosschain, sign on current network
      const s = await getSigner();
      const makerAddr = await s.getAddress();
      const ord = await buildOrder();

      let currentNet;
      try {
        currentNet = await provider.getNetwork();
      } catch (e) {
        if (e.code === 'NETWORK_ERROR') {
          console.warn('[NETWORK DEBUG] Network changed during getNetwork in createConditionalOrder, using selectedNetwork');
          currentNet = { chainId: selectedNetwork === 'base' ? 8453n : 56n };
        } else {
          throw e;
        }
      }
      const network = currentPair.network || 'bsc';
      const isCrossChainPair = selectedNetwork === 'crosschain' || (currentPair.base?.network && currentPair.quote?.network && currentPair.base.network !== currentPair.quote.network);
      // Use correct chainId and settlement address for the selected network
      const targetChainId = isCrossChainPair ? Number(currentNet.chainId) : (selectedNetwork === 'base' ? 8453 : 56);
      const settlementAddr = isCrossChainPair ? (Number(currentNet.chainId) === 8453 ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS) : (selectedNetwork === 'base' ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS);

      // Ensure we're on the correct network before signing
      let signer = s;
      if (selectedNetwork !== 'crosschain' && Number(currentNet.chainId) !== targetChainId) {
        await switchToNetwork(selectedNetwork);
        // Re-get signer after switch
        signer = await getSigner();
        let currentNetNew;
        try {
          currentNetNew = await provider.getNetwork();
        } catch (e) {
          if (e.code === 'NETWORK_ERROR') {
            console.warn('[NETWORK DEBUG] Network changed during getNetwork after switch in signOrder');
            currentNetNew = { chainId: BigInt(targetChainId) };
          } else {
            throw e;
          }
        }
        if (Number(currentNetNew.chainId) !== targetChainId) {
          throw new Error(`Failed to switch to ${selectedNetwork} network. Please switch manually in your wallet.`);
        }
      }

      const domain = {
        name: 'MinimalOrderBook',
        version: '1',
        chainId: targetChainId,
        verifyingContract: settlementAddr
      };
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
      };
      const signature = await signer.signTypedData(domain, types, ord);

      const orderTemplate = JSON.parse(JSON.stringify(ord, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
      const expirationDate = conditionalExpiration ? new Date(Date.now() + Number(conditionalExpiration) * 24 * 60 * 60 * 1000).toISOString() : null;

      const baseAddr = selectedNetwork === 'solana' ? currentPair.base.address : currentPair.base.address.toLowerCase()
      const quoteAddr = selectedNetwork === 'solana' ? currentPair.quote.address : currentPair.quote.address.toLowerCase()
      const payload = {
        network: selectedNetwork,
        maker: makerAddr,
        baseToken: baseAddr,
        quoteToken: quoteAddr,
        type: conditionalType,
        triggerPrice: triggerPrice,
        orderTemplate: orderTemplate,
        signature: signature,
        expiration: expirationDate
      };

      const resp = await fetch(`${INDEXER_BASE}/api/conditional-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        let errBody = '';
        try { errBody = await resp.text(); } catch {}
        throw new Error(`conditional order post HTTP ${resp.status}${errBody ? `: ${errBody}` : ''}`);
      }
      const rjson = await resp.json();
      setStatus(`Conditional order created: ${rjson.id || 'ok'}`);
    } catch (e) {
      console.error(e);
      setStatus(`Conditional order failed: ${e?.message || e}`);
    }
  };

  // Smart approve then sign
  const onSmartApproveThenSign = async () => {
    if (smartBusy) return;
    setSmartBusy(true);
    try {
      if (selectedNetwork === 'solana') {
        // For Solana, no approval needed
        if (isConditional) {
          await createConditionalOrder();
        } else {
          await signOrder();
        }
        await checkAndUpdateAllowance();
        return;
      }

      if (selectedNetwork === 'crosschain') {
        // For crosschain, switch to the token's network
        const tokenToApprove = tradeSide === 'sell' ? currentPair.base : currentPair.quote;
        const networkForApproval = tokenToApprove.network || 'bsc';
        await switchToNetwork(networkForApproval);
      } else {
        await switchToNetwork(selectedNetwork);
      }

      if (needsApproval) {
        const isSell = tradeSide === 'sell';
        const tokenAddr = isSell ? currentPair.base.address : currentPair.quote.address;
        const decimals = await fetchTokenDecimals(tokenAddr, provider, selectedNetwork);
        const network = currentPair.network || 'bsc';
        const isCrossChainPair = selectedNetwork === 'crosschain' || (currentPair.base?.network && currentPair.quote?.network && currentPair.base.network !== currentPair.quote.network);
        const spender = isCrossChainPair ? '0x70c992e6a19c565430fa0c21933395ebf1e907c3' : (network === 'base' ? BASE_SETTLEMENT_ADDRESS : SETTLEMENT_ADDRESS);
        const erc = new Contract(tokenAddr, ERC20_ABI, await getSigner());
        const requiredStr = amountIn && Number(amountIn) > 0 ? amountIn : '0';
        const required = parseUnits(requiredStr, decimals);

        // Approve unlimited for crosschain to avoid re-approval
        const approveAmount = isCrossChainPair ? MaxUint256 : required;
        const tx = await erc.approve(spender, approveAmount);
        setStatus(`Approve sent: ${tx.hash}. Waiting...`);
        await tx.wait();
        setStatus('Approve confirmed');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      if (isConditional) {
        await createConditionalOrder();
      } else {
        await signOrder();
      }
      await checkAndUpdateAllowance();
    } catch (e) {
      console.error(e);
      setStatus(`Action failed: ${e.shortMessage ?? e.message ?? e}`);
    } finally {
      setSmartBusy(false);
    }
  };

  const handleTrade = () => {
    onSmartApproveThenSign();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'flex-end',
        zIndex: 2000,
        backdropFilter: 'blur(4px)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: theme === 'dark' ? '#0f1419' : '#ffffff',
          borderRadius: '16px 16px 0 0',
          padding: '20px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          border: theme === 'dark' ? 'none' : '1px solid rgba(0,0,0,0.1)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'dark' ? '#fff' : '#000' }}>
            {t('app.placeOrder')}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '24px',
              color: '#8fb3c9',
              cursor: 'pointer',
              padding: '0',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {/* Pair Info */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '20px',
          padding: '12px',
          background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
          borderRadius: '8px'
        }}>
          <TokenLogo token={currentPair.base} size={18} />
          <span style={{ fontSize: '12px', fontWeight: '600' }}>{currentPair.base.symbol}</span>
          <span style={{ fontSize: '12px', fontWeight: '600' }}>/</span>
          <TokenLogo token={currentPair.quote} size={18} />
          <span style={{ fontSize: '12px', fontWeight: '600' }}>{currentPair.quote.symbol}</span>
          <span style={{ fontSize: '12px', color: '#8fb3c9' }}>
            ${formatPrice(currentPair.price)}
          </span>
        </div>

        {/* Buy/Sell Toggle */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            onClick={() => setTradeSide('buy')}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              background: tradeSide === 'buy' ? '#00e39f' : 'rgba(255,255,255,0.05)',
              color: tradeSide === 'buy' ? '#000' : '#8fb3c9',
              border: 'none',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            {t('app.buy')}
          </button>
          <button
            onClick={() => setTradeSide('sell')}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              background: tradeSide === 'sell' ? '#ff5c8a' : 'rgba(255,255,255,0.05)',
              color: tradeSide === 'sell' ? '#fff' : '#8fb3c9',
              border: 'none',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            {t('app.sell')}
          </button>
        </div>

        {/* Order Type: Limit or Conditional */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            onClick={() => setIsConditional(false)}
            style={{
              flex: isCrossChainPair ? 1 : 1,
              padding: '10px',
              borderRadius: '8px',
              background: !isConditional ? 'rgba(77, 163, 255, 0.2)' : 'rgba(255,255,255,0.05)',
              color: !isConditional ? '#4da3ff' : '#8fb3c9',
              border: !isConditional ? '1px solid #4da3ff' : '1px solid rgba(255,255,255,0.1)',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            {t('app.limitOrder')}
          </button>
          {!isCrossChainPair && (
            <button
              onClick={() => setIsConditional(true)}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '8px',
                background: isConditional ? 'rgba(77, 163, 255, 0.2)' : 'rgba(255,255,255,0.05)',
                color: isConditional ? '#4da3ff' : '#8fb3c9',
                border: isConditional ? '1px solid #4da3ff' : '1px solid rgba(255,255,255,0.1)',
                fontSize: '14px',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              {t('app.conditionalOrder')}
            </button>
          )}
        </div>

        {/* Conditional Order Fields */}
        {isConditional && (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#8fb3c9' }}>
                {t('app.type')}
              </label>
              <select
                value={conditionalType}
                onChange={(e) => setConditionalType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: theme === 'dark' ? '#fff' : '#000',
                  fontSize: '16px',
                  outline: 'none'
                }}
              >
                <option value="stop_loss">{t('app.stopLoss')}</option>
                <option value="take_profit">{t('app.takeProfit')}</option>
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#8fb3c9' }}>
                {t('app.triggerPrice')} ({currentPair.quote.symbol})
              </label>
              <input
                type="number"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
                placeholder="0.00"
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: theme === 'dark' ? '#fff' : '#000',
                  fontSize: '16px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#8fb3c9' }}>
                {t('app.expirationDays')}
              </label>
              <input
                type="number"
                value={conditionalExpiration}
                onChange={(e) => setConditionalExpiration(e.target.value)}
                placeholder="30"
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: theme === 'dark' ? '#fff' : '#000',
                  fontSize: '16px',
                  outline: 'none'
                }}
              />
            </div>
          </>
        )}

        {/* Amount In */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#8fb3c9' }}>
            {tradeSide === 'sell' ? `${t('app.sellSymbol')} (${currentPair.base.symbol})` : `${t('app.spendSymbol')} (${currentPair.quote.symbol})`}
            {tokenInBalance && <span style={{ marginLeft: '8px', fontSize: '12px' }}>Balance: {parseFloat(tokenInBalance).toFixed(4)}</span>}
          </label>
          <input
            type="number"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            placeholder="0.00"
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: theme === 'dark' ? '#fff' : '#000',
              fontSize: '16px',
              outline: 'none'
            }}
          />
          {usdValue && <div style={{ fontSize: '12px', color: '#8fb3c9', marginTop: '4px' }}>{usdValue}</div>}
        </div>

        {/* Amount Out Min */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#8fb3c9' }}>
            {t('app.minReceive')} ({tradeSide === 'sell' ? currentPair.quote.symbol : currentPair.base.symbol})
          </label>
          <input
            type="number"
            value={amountOutMin}
            onChange={(e) => setAmountOutMin(e.target.value)}
            placeholder="0.00"
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: theme === 'dark' ? '#fff' : '#000',
              fontSize: '16px',
              outline: 'none'
            }}
          />
          {usdValueMinReceive && <div style={{ fontSize: '12px', color: '#8fb3c9', marginTop: '4px' }}>{usdValueMinReceive}</div>}
        </div>

        {/* Expiration */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#8fb3c9' }}>
            {t('app.expirationMins')}
          </label>
          <input
            type="number"
            value={expirationMins}
            onChange={(e) => setExpirationMins(e.target.value)}
            placeholder="60"
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: theme === 'dark' ? '#fff' : '#000',
              fontSize: '16px',
              outline: 'none'
            }}
          />
        </div>

        {/* Nonce */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#8fb3c9' }}>
            {t('app.nonce')}
          </label>
          <input
            type="number"
            value={nonce}
            onChange={(e) => setNonce(e.target.value)}
            placeholder="0"
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: theme === 'dark' ? '#fff' : '#000',
              fontSize: '16px',
              outline: 'none'
            }}
          />
        </div>

        {/* Receiver (optional) */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#8fb3c9' }}>
            {t('app.receiverOptional')}
          </label>
          <input
            type="text"
            value={receiver}
            onChange={(e) => setReceiver(e.target.value)}
            placeholder={t('app.receiverPlaceholder')}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: theme === 'dark' ? '#fff' : '#000',
              fontSize: '16px',
              outline: 'none'
            }}
          />
        </div>

        {/* Salt */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#8fb3c9' }}>
            {t('app.salt')}
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={salt}
              onChange={(e) => setSalt(e.target.value)}
              placeholder="0"
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '8px',
                background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: theme === 'dark' ? '#fff' : '#000',
                fontSize: '16px',
                outline: 'none'
              }}
            />
            <button
              onClick={randomizeSalt}
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                background: 'rgba(77, 163, 255, 0.2)',
                color: '#4da3ff',
                border: '1px solid #4da3ff',
                fontSize: '14px',
                cursor: 'pointer',
                fontWeight: '500',
                whiteSpace: 'nowrap'
              }}
            >
              {t('app.random')}
            </button>
          </div>
        </div>

        {/* Sign Order Button */}
        <button
          onClick={handleTrade}
          disabled={!amountIn || !amountOutMin || smartBusy || !account}
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: '8px',
            background: tradeSide === 'buy' ? '#00e39f' : '#ff5c8a',
            color: tradeSide === 'buy' ? '#000' : '#fff',
            border: 'none',
            fontSize: '16px',
            fontWeight: '600',
            cursor: (!amountIn || !amountOutMin || smartBusy || !account) ? 'not-allowed' : 'pointer',
            opacity: (!amountIn || !amountOutMin || smartBusy || !account) ? 0.5 : 1
          }}
        >
          {!account ? t('app.connectWalletBtn') : smartBusy ? t('app.processingBtn') : smartLabel}
        </button>

        {/* Status */}
        {status && (
          <div style={{
            marginTop: '12px',
            padding: '8px 12px',
            borderRadius: '6px',
            background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
            color: '#8fb3c9',
            fontSize: '12px',
            textAlign: 'center'
          }}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
};

export default TradingModal;