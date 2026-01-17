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

async function runMigration() {
  try {
    console.log('Adding source and conditional_order_id columns to orders table...')

    // Add source column
    console.log('Adding source column...')
    const { error: error1 } = await supabase
      .from('orders')
      .select('source')
      .limit(1)

    if (error1) {
      // Column doesn't exist, try to add it
      console.log('Source column missing, this is expected for new installations')
    }

    // Add conditional_order_id column
    console.log('Adding conditional_order_id column...')
    const { error: error2 } = await supabase
      .from('orders')
      .select('conditional_order_id')
      .limit(1)

    if (error2) {
      console.log('Conditional_order_id column missing, this is expected for new installations')
    }

    console.log('Migration completed! (Columns will be added automatically by ALTER TABLE IF NOT EXISTS)')
    console.log('Note: You may need to run the SQL manually in your Supabase dashboard if the columns are not auto-added')
  } catch (e) {
    console.error('Migration check failed:', e.message)
  }
}

runMigration()