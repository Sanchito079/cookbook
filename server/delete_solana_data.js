import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import fetch from 'node-fetch'
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

async function deleteSolanaData() {
  console.log('Starting to delete all Solana data...')

  // Delete from orders table
  console.log('Deleting Solana orders...')
  const { error: ordersError } = await supabase
    .from('orders')
    .delete()
    .eq('network', 'solana')
  if (ordersError) {
    console.error('Error deleting orders:', ordersError.message)
  } else {
    console.log('Deleted Solana orders')
  }

  // Delete from cross_chain_orders table (if any)
  console.log('Deleting Solana cross-chain orders...')
  const { error: crossOrdersError } = await supabase
    .from('cross_chain_orders')
    .delete()
    .eq('network', 'solana')
  if (crossOrdersError) {
    console.error('Error deleting cross-chain orders:', crossOrdersError.message)
  } else {
    console.log('Deleted Solana cross-chain orders')
  }

  // Delete from conditional_orders table
  console.log('Deleting Solana conditional orders...')
  const { error: conditionalError } = await supabase
    .from('conditional_orders')
    .delete()
    .eq('network', 'solana')
  if (conditionalError) {
    console.error('Error deleting conditional orders:', conditionalError.message)
  } else {
    console.log('Deleted Solana conditional orders')
  }

  // Delete from fills table
  console.log('Deleting Solana fills...')
  const { error: fillsError } = await supabase
    .from('fills')
    .delete()
    .eq('network', 'solana')
  if (fillsError) {
    console.error('Error deleting fills:', fillsError.message)
  } else {
    console.log('Deleted Solana fills')
  }

  // Delete from trades table
  console.log('Deleting Solana trades...')
  const { error: tradesError } = await supabase
    .from('trades')
    .delete()
    .eq('network', 'solana')
  if (tradesError) {
    console.error('Error deleting trades:', tradesError.message)
  } else {
    console.log('Deleted Solana trades')
  }

  // Delete from cross_chain_trades table (delete all since it's cross-chain)
  console.log('Deleting all cross-chain trades...')
  const { error: crossTradesError } = await supabase
    .from('cross_chain_trades')
    .delete()
    .neq('id', 0) // delete all
  if (crossTradesError) {
    console.error('Error deleting cross-chain trades:', crossTradesError.message)
  } else {
    console.log('Deleted all cross-chain trades')
  }

  // Delete from markets table
  console.log('Deleting Solana markets...')
  const { error: marketsError } = await supabase
    .from('markets')
    .delete()
    .eq('network', 'solana')
  if (marketsError) {
    console.error('Error deleting markets:', marketsError.message)
  } else {
    console.log('Deleted Solana markets')
  }

  // Delete from tokens table
  console.log('Deleting Solana tokens...')
  const { error: tokensError } = await supabase
    .from('tokens')
    .delete()
    .eq('network', 'solana')
  if (tokensError) {
    console.error('Error deleting tokens:', tokensError.message)
  } else {
    console.log('Deleted Solana tokens')
  }

  // Delete from watchlists table
  console.log('Deleting Solana watchlists...')
  const { error: watchlistsError } = await supabase
    .from('watchlists')
    .delete()
    .eq('network', 'solana')
  if (watchlistsError) {
    console.error('Error deleting watchlists:', watchlistsError.message)
  } else {
    console.log('Deleted Solana watchlists')
  }

  console.log('Finished deleting all Solana data.')
  console.log('You can now restart the server to refresh Solana data with correct addresses.')
}

deleteSolanaData().catch(console.error)