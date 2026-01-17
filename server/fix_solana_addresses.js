import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { PublicKey } from '@solana/web3.js'
import path from 'path'
import { fileURLToPath } from 'url'

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

// Function to normalize Solana address to correct case
function normalizeSolanaAddress(address) {
  try {
    const pubkey = new PublicKey(address)
    return pubkey.toBase58()
  } catch (e) {
    console.warn(`Invalid Solana address: ${address}`)
    return address // return as is if invalid
  }
}

async function fixSolanaAddresses() {
  console.log('Starting to fix Solana addresses...')

  // Fix tokens table
  console.log('Fixing tokens table...')
  const { data: tokens, error: tokensError } = await supabase
    .from('tokens')
    .select('network, address')
    .eq('network', 'solana')

  if (tokensError) {
    console.error('Error fetching tokens:', tokensError.message)
    return
  }

  for (const token of tokens || []) {
    const normalized = normalizeSolanaAddress(token.address)
    if (normalized !== token.address) {
      console.log(`Updating token address: ${token.address} -> ${normalized}`)
      const { error } = await supabase
        .from('tokens')
        .update({ address: normalized })
        .eq('network', 'solana')
        .eq('address', token.address)
      if (error) {
        console.error('Error updating token:', error.message)
      }
    }
  }

  // Fix markets table
  console.log('Fixing markets table...')
  const { data: markets, error: marketsError } = await supabase
    .from('markets')
    .select('network, pool_address, base_address, quote_address')
    .eq('network', 'solana')

  if (marketsError) {
    console.error('Error fetching markets:', marketsError.message)
    return
  }

  for (const market of markets || []) {
    const updates = {}
    if (market.pool_address) {
      const normalizedPool = normalizeSolanaAddress(market.pool_address)
      if (normalizedPool !== market.pool_address) {
        updates.pool_address = normalizedPool
        console.log(`Updating market pool_address: ${market.pool_address} -> ${normalizedPool}`)
      }
    }
    if (market.base_address) {
      const normalizedBase = normalizeSolanaAddress(market.base_address)
      if (normalizedBase !== market.base_address) {
        updates.base_address = normalizedBase
        console.log(`Updating market base_address: ${market.base_address} -> ${normalizedBase}`)
      }
    }
    if (market.quote_address) {
      const normalizedQuote = normalizeSolanaAddress(market.quote_address)
      if (normalizedQuote !== market.quote_address) {
        updates.quote_address = normalizedQuote
        console.log(`Updating market quote_address: ${market.quote_address} -> ${normalizedQuote}`)
      }
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('markets')
        .update(updates)
        .eq('network', 'solana')
        .eq('pool_address', market.pool_address)
      if (error) {
        console.error('Error updating market:', error.message)
      }
    }
  }

  // Fix orders table
  console.log('Fixing orders table...')
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('order_id, network, base_address, quote_address, token_in, token_out')
    .eq('network', 'solana')

  if (ordersError) {
    console.error('Error fetching orders:', ordersError.message)
  } else {
    for (const order of orders || []) {
      const updates = {}
      if (order.base_address) {
        const normalizedBase = normalizeSolanaAddress(order.base_address)
        if (normalizedBase !== order.base_address) {
          updates.base_address = normalizedBase
          console.log(`Updating order base_address: ${order.base_address} -> ${normalizedBase}`)
        }
      }
      if (order.quote_address) {
        const normalizedQuote = normalizeSolanaAddress(order.quote_address)
        if (normalizedQuote !== order.quote_address) {
          updates.quote_address = normalizedQuote
          console.log(`Updating order quote_address: ${order.quote_address} -> ${normalizedQuote}`)
        }
      }
      if (order.token_in) {
        const normalizedTokenIn = normalizeSolanaAddress(order.token_in)
        if (normalizedTokenIn !== order.token_in) {
          updates.token_in = normalizedTokenIn
          console.log(`Updating order token_in: ${order.token_in} -> ${normalizedTokenIn}`)
        }
      }
      if (order.token_out) {
        const normalizedTokenOut = normalizeSolanaAddress(order.token_out)
        if (normalizedTokenOut !== order.token_out) {
          updates.token_out = normalizedTokenOut
          console.log(`Updating order token_out: ${order.token_out} -> ${normalizedTokenOut}`)
        }
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('orders')
          .update(updates)
          .eq('network', 'solana')
          .eq('order_id', order.order_id)
        if (error) {
          console.error('Error updating order:', error.message)
        }
      }
    }
  }

  console.log('Finished fixing Solana addresses.')
}

fixSolanaAddresses().catch(console.error)