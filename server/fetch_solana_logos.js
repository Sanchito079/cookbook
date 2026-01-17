import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import { fileURLToPath } from 'url'
import fetch from 'node-fetch'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, '..', '.env') })

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.log('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

// Fetch token info from GeckoTerminal
async function fetchTokenInfo(address) {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${address}/info`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Token info HTTP ${res.status}`)
  const json = await res.json()
  const attrs = json?.data?.attributes || {}
  return {
    symbol: attrs.symbol || null,
    name: attrs.name || null,
    decimals: (typeof attrs.decimals === 'number' ? attrs.decimals : null),
    logoUrl: (attrs.image && (attrs.image.large || attrs.image.small || attrs.image.thumb)) || attrs.image_url || null
  }
}

async function fetchSolanaLogos() {
  console.log('Starting to fetch logos for Solana tokens...')

  // Get Solana tokens without logo_url
  const { data: tokens, error } = await supabase
    .from('tokens')
    .select('address, symbol, name')
    .eq('network', 'solana')
    .is('logo_url', null)

  if (error) {
    console.error('Error fetching tokens:', error.message)
    return
  }

  console.log(`Found ${tokens.length} Solana tokens without logos`)

  for (const token of tokens || []) {
    try {
      console.log(`Fetching logo for ${token.address} (${token.symbol || 'unknown'})`)
      const info = await fetchTokenInfo(token.address)
      if (info.logoUrl) {
        console.log(`Found logo: ${info.logoUrl}`)
        const { error: updateError } = await supabase
          .from('tokens')
          .update({
            logo_url: info.logoUrl,
            symbol: info.symbol || token.symbol,
            name: info.name || token.name,
            decimals: info.decimals,
            updated_at: new Date().toISOString()
          })
          .eq('network', 'solana')
          .eq('address', token.address)
        if (updateError) {
          console.error('Error updating token:', updateError.message)
        } else {
          console.log(`Updated ${token.address}`)
        }
      } else {
        console.log(`No logo found for ${token.address}`)
      }
    } catch (e) {
      console.warn(`Failed to fetch info for ${token.address}:`, e?.message || e)
    }

    // Rate limit - increased to avoid 429
    await new Promise(resolve => setTimeout(resolve, 8000))
  }

  console.log('Finished fetching Solana logos.')
}

fetchSolanaLogos().catch(console.error)