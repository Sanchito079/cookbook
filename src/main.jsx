import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Dynamic Wallet integration
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core'
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum'
import { SolanaWalletConnectors } from '@dynamic-labs/solana'
import { clusterApiUrl } from '@solana/web3.js'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { I18nextProvider } from 'react-i18next'
import i18n from './i18n'

const environmentId = '5a747f7c-8bf3-4046-be98-a0700ae32c9c'

// Solana network configuration
const network = WalletAdapterNetwork.Mainnet
const endpoint = clusterApiUrl(network)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <DynamicContextProvider
        settings={{
          environmentId,
          walletConnectors: [EthereumWalletConnectors, SolanaWalletConnectors],
          solanaNetworks: [{ name: 'mainnet-beta', rpcUrl: endpoint }],
          enabledChains: ['ETH', 'SOL']
        }}
      >
        <App />
      </DynamicContextProvider>
    </I18nextProvider>
  </StrictMode>,
)
