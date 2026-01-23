# Order Calculation and Storage Issues - Analysis & Fixes

## Executive Summary
Found **multiple critical issues** with decimal handling, race conditions, and incorrect price calculations that cause orders to be stored with wrong values in the database.

---

## 🔴 CRITICAL ISSUES FOUND

### 1. **Inconsistent Decimal Handling**

#### Problem Location: `src/App.jsx` lines 1535-1548 (buildOrder function)
```javascript
// ISSUE: Hardcoded decimals override the actual token decimals
const tokenInLower = tokenInAddr.toLowerCase()
const tokenOutLower = tokenOutAddr.toLowerCase()
if (tokenInLower === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') inDecimals = 18
if (tokenOutLower === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') outDecimals = 18
if (tokenInLower === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') inDecimals = 6
if (tokenOutLower === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') outDecimals = 6
if (tokenInLower === '0x55d398326f99059ff775485246999027b3197955') inDecimals = 18
if (tokenOutLower === '0x55d398326f99059ff775485246999027b3197955') outDecimals = 18
```

**Issues:**
- Uses `baseDecimals` and `quoteDecimals` state which may be stale or incorrect
- Then overrides with hardcoded values for specific tokens
- **USDT BSC (0x55d398326f99059ff775485246999027b3197955) is hardcoded as 18 decimals but should be 18** ✓ (This is correct)
- **USDC BSC (0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d) is listed in TOKENS array as 6 decimals but is actually 18 decimals!** ❌

#### Problem Location: `src/helpers_decimals.js` lines 10-13
```javascript
// WRONG DECIMALS!
if (addr === '0x55d398326f99059ff775485246999027b3197955') return 18 // USDT BSC - CORRECT
if (addr === '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d') return 18 // USDC BSC - CORRECT
```

#### Problem Location: `src/App.jsx` lines 346-353 (TOKENS array)
```javascript
const TOKENS = [
  { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18, network: 'bsc' },
  { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 6, network: 'bsc' }, // ❌ WRONG! Should be 18
  { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 6, network: 'bsc' }, // ❌ WRONG! Should be 18
```

**Impact:** Orders are created with amounts scaled by wrong decimals (10^6 vs 10^18 = 1 trillion times difference!)

---

### 2. **Race Condition in Decimal Fetching**

#### Problem Location: `src/App.jsx` lines 971-993 (refreshTokenMeta)
```javascript
const refreshTokenMeta = async (baseAddr, quoteAddr) => {
  const fetchDecimals = async (addr) => {
    const cached = getCachedDecimals(addr)
    if (cached !== null) return cached
    try {
      const contract = await getErc20(addr)
      const dec = Number(await contract.decimals())
      setCachedDecimals(addr, dec)
      return dec
    } catch {
      // Fallback to TOKENS or 18
      const token = TOKENS.find(t => t.address.toLowerCase() === addr.toLowerCase())
      const fallback = token ? token.decimals : 18
      setCachedDecimals(addr, fallback)
      return fallback
    }
  }
  const d0 = await fetchDecimals(baseAddr)
  const d1 = await fetchDecimals(quoteAddr)
  setBaseDecimals(d0)
  setQuoteDecimals(d1)
}
```

**Issues:**
1. `setBaseDecimals` and `setQuoteDecimals` are async state updates
2. When user quickly signs an order after switching pairs, the state might not be updated yet
3. `buildOrder()` uses stale `baseDecimals`/`quoteDecimals` state values
4. **No waiting mechanism** to ensure decimals are loaded before signing

---

### 3. **Server-Side Decimal Inconsistency**

#### Problem Location: `server/index.js` lines 2129-2158
```javascript
// Get decimals for tokens
let tokenInDec = 18, tokenOutDec = 18
try {
  // Fetches from database...
} catch {}
// Hardcode known decimals
const tokenInLower = order.tokenIn.toLowerCase()
const tokenOutLower = order.tokenOut.toLowerCase()
if (tokenInLower === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') tokenInDec = 18
if (tokenOutLower === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') tokenOutDec = 18
if (tokenInLower === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') tokenInDec = 6
if (tokenOutLower === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') tokenOutDec = 6
// Additional known tokens
if (tokenInLower === '0x55d398326f99059ff775485246999027b3197955') tokenInDec = 18 // USDT BSC
if (tokenOutLower === '0x55d398326f99059ff775485246999027b3197955') tokenOutDec = 18
if (tokenInLower === '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d') tokenInDec = 18 // USDC BSC
if (tokenOutLower === '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d') tokenOutDec = 18
```

**Issues:**
- Server uses different decimal values than what might be in the database
- Price calculation uses these decimals: `const price = quoteAmount / baseAmount`
- If frontend sends wrong amounts (due to wrong decimals), server calculates wrong price

---

### 4. **Price Calculation Issues**

#### Problem Location: `server/index.js` lines 2083-2105 (classifyOrder)
```javascript
function classifyOrder(base, quote, order, tokenInDec, tokenOutDec) {
  const baseL = toLower(base), quoteL = toLower(quote)
  const tokenIn = toLower(order?.tokenIn), tokenOut = toLower(order?.tokenOut)
  if (!baseL || !quoteL || !tokenIn || !tokenOut) return { side: null, price: null }
  const amountIn = BigInt(order.amountIn || 0n)
  const amountOutMin = BigInt(order.amountOutMin || 0n)
  if (amountIn === 0n) return { side: null, price: null }
  // ask: selling base for quote
  if (tokenIn === baseL && tokenOut === quoteL) {
    const baseAmount = Number(amountIn) / 10**tokenInDec
    const quoteAmount = Number(amountOutMin) / 10**tokenOutDec
    const price = quoteAmount / baseAmount
    return { side: 'ask', price }
  }
  // bid: selling quote for base
  if (tokenIn === quoteL && tokenOut === baseL) {
    const quoteAmount = Number(amountIn) / 10**tokenInDec
    const baseAmount = Number(amountOutMin) / 10**tokenOutDec
    const price = quoteAmount / baseAmount
    return { side: 'bid', price }
  }
  return { side: null, price: null }
}
```

**Issues:**
- Converts BigInt to Number before division - **precision loss for large amounts**
- Should divide BigInts first, then convert to Number
- Wrong decimals from frontend propagate to wrong price calculation

---

### 5. **No Validation of Parsed Amounts**

#### Problem Location: `src/App.jsx` lines 1547-1548
```javascript
const amountInParsed = parseUnits(amountIn || '0', inDecimals)
const amountOutMinParsed = parseUnits(amountOutMin || '0', outDecimals)
```

**Issues:**
- No validation that `parseUnits` succeeded
- No check if amounts are reasonable
- No logging of what amounts were actually parsed
- User could enter "1" and it becomes "1000000000000000000" (18 decimals) or "1000000" (6 decimals) depending on token

---

### 6. **Timing Issue with Balance Fetching**

#### Problem Location: `src/App.jsx` lines 995-1000
```javascript
const fetchBalances = async () => {
  if (!account || !provider) return
  try {
    // Small delay to ensure network switch is complete
    await new Promise(resolve => setTimeout(resolve, 2000))
```

**Issues:**
- 2 second delay is arbitrary and may not be enough
- During this delay, user might sign an order with wrong network state
- No guarantee that decimals are fetched before balances

---

## 🔧 RECOMMENDED FIXES

### Fix 1: Correct Token Decimals in TOKENS Array

```javascript
const TOKENS = [
  { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18, network: 'bsc' },
  { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, network: 'bsc' }, // ✅ FIXED
  { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18, network: 'bsc' }, // ✅ FIXED
  { symbol: 'CAKE', address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', decimals: 18, network: 'bsc' },
  // Base tokens
  { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18, network: 'base' },
  { symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, network: 'base' }
]
```

### Fix 2: Wait for Decimals Before Building Order

```javascript
const buildOrder = async () => {
  let makerAddr = account
  if (!makerAddr) {
    try {
      const s = await getSigner()
      makerAddr = await s.getAddress()
    } catch {}
  }
  if (!makerAddr) throw new Error('Connect first')

  // ✅ ENSURE DECIMALS ARE LOADED
  const isSell = tradeSide === 'sell'
  const tokenInAddr = isSell ? baseToken.address : quoteToken.address
  const tokenOutAddr = isSell ? quoteToken.address : baseToken.address
  
  // Fetch fresh decimals from contract
  let inDecimals = isSell ? baseDecimals : quoteDecimals
  let outDecimals = isSell ? quoteDecimals : baseDecimals
  
  // ✅ VERIFY DECIMALS ARE CORRECT
  try {
    const tokenInContract = await getErc20(tokenInAddr)
    const tokenOutContract = await getErc20(tokenOutAddr)
    inDecimals = Number(await tokenInContract.decimals())
    outDecimals = Number(await tokenOutContract.decimals())
    console.log(`[buildOrder] Verified decimals: tokenIn=${tokenInAddr} decimals=${inDecimals}, tokenOut=${tokenOutAddr} decimals=${outDecimals}`)
  } catch (e) {
    console.error('[buildOrder] Failed to fetch decimals, using fallback:', e)
    // Use helpers_decimals.js as fallback
    inDecimals = getTokenDecimals(tokenInAddr)
    outDecimals = getTokenDecimals(tokenOutAddr)
  }

  const now = Math.floor(Date.now() / 1000)
  const exp = now + Number(expirationMins || '0') * 60
  
  const amountInParsed = parseUnits(amountIn || '0', inDecimals)
  const amountOutMinParsed = parseUnits(amountOutMin || '0', outDecimals)
  
  // ✅ LOG PARSED AMOUNTS FOR DEBUGGING
  console.log(`[buildOrder] Input: amountIn="${amountIn}" amountOutMin="${amountOutMin}"`)
  console.log(`[buildOrder] Parsed: amountInParsed=${amountInParsed.toString()} (${inDecimals} decimals), amountOutMinParsed=${amountOutMinParsed.toString()} (${outDecimals} decimals)`)
  console.log(`[buildOrder] Price: ${Number(amountOutMinParsed) / Number(amountInParsed)} ${quoteToken.symbol}/${baseToken.symbol}`)
  
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
```

### Fix 3: Add Validation Before Signing

```javascript
const signOrder = async () => {
  try {
    if (selectedNetwork !== 'crosschain') {
      await switchToNetwork(selectedNetwork)
    }
    
    // ✅ VALIDATE INPUTS
    if (!amountIn || Number(amountIn) <= 0) {
      throw new Error('Amount In must be greater than 0')
    }
    if (!amountOutMin || Number(amountOutMin) <= 0) {
      throw new Error('Amount Out Min must be greater than 0')
    }
    
    const s = await getSigner()
    const ord = await buildOrder()
    
    // ✅ VALIDATE PARSED AMOUNTS
    if (ord.amountIn === 0n) {
      throw new Error('Parsed Amount In is 0 - check decimals')
    }
    if (ord.amountOutMin === 0n) {
      throw new Error('Parsed Amount Out Min is 0 - check decimals')
    }
    
    const currentNet = await provider.getNetwork()
    // ... rest of signing logic
  } catch (e) {
    console.error(e)
    setStatus(`Sign failed: ${e.shortMessage ?? e.message ?? e}`)
  }
}
```

### Fix 4: Fix Price Calculation to Avoid Precision Loss

```javascript
// server/index.js
function classifyOrder(base, quote, order, tokenInDec, tokenOutDec) {
  const baseL = toLower(base), quoteL = toLower(quote)
  const tokenIn = toLower(order?.tokenIn), tokenOut = toLower(order?.tokenOut)
  if (!baseL || !quoteL || !tokenIn || !tokenOut) return { side: null, price: null }
  const amountIn = BigInt(order.amountIn || 0n)
  const amountOutMin = BigInt(order.amountOutMin || 0n)
  if (amountIn === 0n) return { side: null, price: null }
  
  // ✅ FIXED: Calculate with proper precision
  // ask: selling base for quote
  if (tokenIn === baseL && tokenOut === quoteL) {
    // Scale to avoid precision loss: (amountOutMin * 10^18) / (amountIn * 10^(18 - tokenInDec + tokenOutDec))
    const scaleFactor = 18 - tokenInDec + tokenOutDec
    const scaledAmountIn = scaleFactor >= 0 
      ? amountIn * BigInt(10 ** scaleFactor)
      : amountIn / BigInt(10 ** (-scaleFactor))
    const priceScaled = (amountOutMin * BigInt(10 ** 18)) / scaledAmountIn
    const price = Number(priceScaled) / (10 ** 18)
    return { side: 'ask', price }
  }
  
  // bid: selling quote for base
  if (tokenIn === quoteL && tokenOut === baseL) {
    const scaleFactor = 18 - tokenInDec + tokenOutDec
    const scaledAmountIn = scaleFactor >= 0 
      ? amountIn * BigInt(10 ** scaleFactor)
      : amountIn / BigInt(10 ** (-scaleFactor))
    const priceScaled = (amountOutMin * BigInt(10 ** 18)) / scaledAmountIn
    const price = Number(priceScaled) / (10 ** 18)
    return { side: 'bid', price }
  }
  
  return { side: null, price: null }
}
```

### Fix 5: Add Decimal Verification Endpoint

```javascript
// server/index.js - Add new endpoint
app.get('/api/token/decimals', async (req, res) => {
  try {
    const network = (req.query.network || 'bsc').toString()
    const address = (req.query.address || '').toString().toLowerCase()
    if (!address) return res.status(400).json({ error: 'address required' })
    
    // Try database first
    if (SUPABASE_ENABLED) {
      const { data } = await supabase
        .from('tokens')
        .select('decimals')
        .eq('network', network)
        .eq('address', address)
        .limit(1)
      if (data && data[0] && data[0].decimals != null) {
        return res.json({ address, decimals: data[0].decimals, source: 'database' })
      }
    }
    
    // Hardcoded fallback
    const knownDecimals = {
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 18, // WBNB
      '0x55d398326f99059ff775485246999027b3197955': 18, // USDT BSC
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 18, // USDC BSC
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,  // USDC Base
      '0x4200000000000000000000000000000000000006': 18  // WETH Base
    }
    
    if (knownDecimals[address]) {
      return res.json({ address, decimals: knownDecimals[address], source: 'hardcoded' })
    }
    
    return res.json({ address, decimals: 18, source: 'default' })
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) })
  }
})
```

---

## 🧪 TESTING CHECKLIST

After applying fixes, test these scenarios:

1. **USDT/WBNB pair on BSC**
   - [ ] Create sell order for 1 WBNB → verify amountIn = 1000000000000000000 (18 decimals)
   - [ ] Create buy order for 100 USDT → verify amountIn = 100000000000000000000 (18 decimals)
   - [ ] Check database: verify amounts match what was signed
   - [ ] Check price calculation: should be ~300 USDT/WBNB

2. **USDC/WETH pair on Base**
   - [ ] Create sell order for 0.1 WETH → verify amountIn = 100000000000000000 (18 decimals)
   - [ ] Create buy order for 300 USDC → verify amountIn = 300000000 (6 decimals)
   - [ ] Check database: verify amounts match
   - [ ] Check price: should be ~3000 USDC/WETH

3. **Race condition test**
   - [ ] Switch between pairs quickly
   - [ ] Sign order immediately after switch
   - [ ] Verify decimals are correct in signed order

4. **Cross-chain orders**
   - [ ] Test WBNB/USDC cross-chain pair
   - [ ] Verify decimals: WBNB=18, USDC=6

---

## 📊 IMPACT ASSESSMENT

**Severity: CRITICAL** 🔴

- Orders with wrong amounts can lead to:
  - Loss of funds (selling 1 trillion times more than intended)
  - Orders that never fill (price too high/low)
  - Broken orderbook matching
  - User confusion and loss of trust

**Affected Users:** Anyone trading tokens with incorrect decimal configuration

**Priority:** Fix immediately before any production deployment

---

## 💡 ADDITIONAL RECOMMENDATIONS

1. **Add decimal verification in UI**
   - Show "Parsed Amount: X tokens (Y wei)" before signing
   - Let user confirm the parsed values

2. **Add server-side validation**
   - Reject orders with suspicious amounts (too large/small)
   - Log all order submissions with full details

3. **Create decimal audit script**
   - Check all tokens in database for correct decimals
   - Compare with on-chain values

4. **Add monitoring**
   - Alert when orders are created with unusual amounts
   - Track decimal fetch failures

5. **Update database**
   - Run migration to fix existing token decimals
   - Add constraints to prevent invalid decimals

---

## 📝 MIGRATION SCRIPT

```sql
-- Fix incorrect decimals in tokens table
UPDATE tokens 
SET decimals = 18, updated_at = NOW()
WHERE address = '0x55d398326f99059ff775485246999027b3197955' 
  AND network = 'bsc'
  AND decimals != 18;

UPDATE tokens 
SET decimals = 18, updated_at = NOW()
WHERE address = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' 
  AND network = 'bsc'
  AND decimals != 18;

-- Verify
SELECT address, symbol, decimals, network 
FROM tokens 
WHERE network = 'bsc' 
  AND address IN (
    '0x55d398326f99059ff775485246999027b3197955',
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
  );
```