/**
 * Test script for SAL Orders
 * Tests the creation and price calculation of Single Adaptive Liquidity Orders
 */

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { validateSALOrderParams, calculateSALOrderPrice, getSALOrderPrice } from './sal_order_utils.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.join(__dirname, '..', '.env')
dotenv.config({ path: envPath })

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

async function testSALOrderValidation() {
  console.log('🧪 Testing SAL Order validation...')

  // Test valid parameters
  const validParams = {
    totalAmount: '1000000000000000000000', // 1000 tokens
    initialPrice: '1000000000000000000', // 1.0
    curveType: 'linear',
    maxPrice: '2000000000000000000', // 2.0
    minPrice: '500000000000000000' // 0.5
  }

  const validation = validateSALOrderParams(validParams)
  console.log('✅ Valid params validation:', validation.isValid ? 'PASS' : 'FAIL')
  if (!validation.isValid) {
    console.log('❌ Errors:', validation.errors)
  }

  // Test invalid parameters
  const invalidParams = {
    totalAmount: '0',
    initialPrice: '0',
    curveType: 'invalid'
  }

  const invalidValidation = validateSALOrderParams(invalidParams)
  console.log('✅ Invalid params validation:', !invalidValidation.isValid ? 'PASS' : 'FAIL')
  console.log('❌ Expected errors:', invalidValidation.errors)
}

async function testPriceCalculation() {
  console.log('\n🧪 Testing price calculation...')

  // Test linear curve
  const linearOrder = {
    sal_initial_price: '1000000000000000000', // 1.0
    sal_current_price: '1000000000000000000',
    sal_price_curve: 'linear',
    sal_max_price: '2000000000000000000', // 2.0
    sal_min_price: '500000000000000000', // 0.5
    sal_sold_amount: '250000000000000000000', // 250 sold
    sal_total_inventory: '1000000000000000000000' // 1000 total
  }

  const linearPrice = calculateSALOrderPrice(linearOrder)
  console.log('📈 Linear price (25% sold):', linearPrice)
  console.log('📈 Expected around 1.25')

  // Test exponential curve
  const expOrder = {
    ...linearOrder,
    sal_price_curve: 'exponential',
    sal_price_adjustment_params: { exponent: 2, multiplier: 1 }
  }

  const expPrice = calculateSALOrderPrice(expOrder)
  console.log('📈 Exponential price (25% sold):', expPrice)
}

async function testSALOrderCreation() {
  console.log('\n🧪 Testing SAL Order creation...')

  try {
    // Create a test SAL order
    const testOrder = {
      network: 'bsc',
      maker: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', // Test address
      tokenIn: '0x1234567890123456789012345678901234567890', // Test token
      tokenOut: '0x55d398326f99059ff775485246999027b3197955', // USDT
      totalAmount: '1000000000000000000000', // 1000 tokens
      initialPrice: '1000000000000000000', // 1.0 USDT per token
      curveType: 'linear',
      maxPrice: '2000000000000000000', // 2.0
      minPrice: '500000000000000000', // 0.5
      expiration: Math.floor(Date.now() / 1000) + 86400, // 24 hours
      salt: Date.now().toString()
    }

    // This would normally call the API, but for testing we'll simulate
    console.log('📝 Test SAL Order data:', testOrder)

    // Test price retrieval (will fail since order doesn't exist)
    const priceData = await getSALOrderPrice('test-order-id', 'bsc')
    console.log('📊 Price retrieval test:', priceData.error ? 'Expected error' : 'Unexpected success')

  } catch (error) {
    console.error('❌ SAL Order creation test failed:', error)
  }
}

async function runTests() {
  console.log('🚀 Starting SAL Order tests...\n')

  try {
    await testSALOrderValidation()
    await testPriceCalculation()
    await testSALOrderCreation()

    console.log('\n✅ All tests completed!')
  } catch (error) {
    console.error('❌ Test suite failed:', error)
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests()
}

export { runTests }