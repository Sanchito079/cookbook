import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
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

async function checkTable() {
  try {
    console.log('Checking if cross_chain_trades table exists...')
    const { data, error } = await supabase
      .from('cross_chain_trades')
      .select('*')
      .limit(1)

    if (error) {
      console.log('Table does not exist or error:', error.message)
      console.log('You need to run the migration: server/migrations/015_cross_chain_orderbook.sql')
    } else {
      console.log('Table exists!')
      console.log('Data:', data)
    }
  } catch (e) {
    console.log('Error:', e.message)
  }
}

checkTable()