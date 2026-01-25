import { useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'

const INDEXER_BASE = (import.meta?.env?.VITE_INDEXER_BASE) || 'https://cookbook-hjnhgq.fly.dev'

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
        {curveType === 'linear' && 'Price increases steadily as tokens are sold.'}
        {curveType === 'exponential' && 'Price increases faster as more tokens are sold.'}
        {curveType === 'stepwise' && 'Price stays constant then jumps at certain thresholds.'}
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

export default SALOrderModal