/**
 * Single Adaptive Liquidity Order (SAL Order) Utilities
 * Handles price calculations and adjustments for SAL orders
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.join(__dirname, '..', '.env')
dotenv.config({ path: envPath })

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

/**
 * Calculate current price for a SAL order based on inventory sold
 * @param {Object} salOrder - SAL order data from database
 * @returns {string} Current price as string
 */
export function calculateSALOrderPrice(salOrder) {
  const {
    sal_initial_price: initialPrice,
    sal_current_price: currentPrice,
    sal_price_curve: curve,
    sal_max_price: maxPrice,
    sal_min_price: minPrice,
    sal_sold_amount: soldAmount,
    sal_total_inventory: totalInventory,
    sal_price_adjustment_params: params
  } = salOrder

  if (!totalInventory || totalInventory === '0') {
    return initialPrice || '0'
  }

  const soldRatio = parseFloat(soldAmount || '0') / parseFloat(totalInventory)
  const initial = parseFloat(initialPrice || '0')
  const max = parseFloat(maxPrice || '0')
  const min = parseFloat(minPrice || '0')

  let newPrice

  switch (curve) {
    case 'linear':
      newPrice = calculateLinearPrice(initial, max, soldRatio)
      break
    case 'exponential':
      newPrice = calculateExponentialPrice(initial, max, soldRatio, params)
      break
    case 'stepwise':
      newPrice = calculateStepwisePrice(initial, max, soldRatio, params)
      break
    default:
      newPrice = calculateLinearPrice(initial, max, soldRatio)
  }

  // Ensure price stays within bounds
  newPrice = Math.max(min || 0, Math.min(max || newPrice, newPrice))

  return newPrice.toFixed(18)
}

/**
 * Linear price adjustment
 * Price increases steadily as inventory decreases
 */
function calculateLinearPrice(initialPrice, maxPrice, soldRatio) {
  const priceRange = maxPrice - initialPrice
  return initialPrice + (priceRange * soldRatio)
}

/**
 * Exponential price adjustment
 * Price increases slowly then accelerates
 */
function calculateExponentialPrice(initialPrice, maxPrice, soldRatio, params = {}) {
  const exponent = params.exponent || 2
  const multiplier = params.multiplier || 1

  // Exponential curve: price = initial * (1 + k * ratio^exp)
  const k = (maxPrice / initialPrice - 1) / Math.pow(1, exponent)
  return initialPrice * (1 + k * Math.pow(soldRatio, exponent) * multiplier)
}

/**
 * Step-wise price adjustment
 * Price jumps at defined thresholds
 */
function calculateStepwisePrice(initialPrice, maxPrice, soldRatio, params = {}) {
  const steps = params.steps || [
    { threshold: 0.25, multiplier: 1.0 },
    { threshold: 0.50, multiplier: 1.2 },
    { threshold: 0.75, multiplier: 1.5 },
    { threshold: 1.0, multiplier: 2.0 }
  ]

  // Find the current step
  for (let i = steps.length - 1; i >= 0; i--) {
    if (soldRatio >= steps[i].threshold) {
      return initialPrice * steps[i].multiplier
    }
  }

  return initialPrice
}

/**
 * Update SAL order price in database
 * @param {string} orderId - Order ID
 * @param {string} network - Network
 * @param {string} newPrice - New calculated price
 * @param {string} soldAmount - Amount just sold
 */
export async function updateSALOrderPrice(orderId, network, newPrice, soldAmount) {
  try {
    // Update the order
    const { error: orderError } = await supabase
      .from('orders')
      .update({
        sal_current_price: newPrice,
        sal_sold_amount: soldAmount,
        sal_last_price_update: new Date().toISOString()
      })
      .eq('order_id', orderId)
      .eq('network', network)

    if (orderError) throw orderError

    // Update analytics
    await updateSALOrderAnalytics(orderId, network, newPrice, soldAmount)

    return { success: true }
  } catch (error) {
    console.error('Error updating SAL order price:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Update SAL order analytics
 */
async function updateSALOrderAnalytics(orderId, network, newPrice, soldAmount) {
  try {
    // Get current analytics
    const { data: analytics, error: fetchError } = await supabase
      .from('sal_order_analytics')
      .select('*')
      .eq('order_id', orderId)
      .single()

    if (fetchError && fetchError.code !== 'PGRST116') { // Not found error
      throw fetchError
    }

    const now = new Date().toISOString()
    const priceEntry = {
      timestamp: now,
      price: newPrice,
      sold_amount: soldAmount
    }

    if (!analytics) {
      // Create new analytics record
      const { error } = await supabase
        .from('sal_order_analytics')
        .insert({
          order_id: orderId,
          network: network,
          total_sold: soldAmount,
          price_history: [priceEntry]
        })

      if (error) throw error
    } else {
      // Update existing analytics
      const priceHistory = [...(analytics.price_history || []), priceEntry]
      const totalSold = (parseFloat(analytics.total_sold || '0') + parseFloat(soldAmount)).toString()

      // Calculate average fill price (simplified)
      const avgPrice = calculateAveragePrice(priceHistory)

      const { error } = await supabase
        .from('sal_order_analytics')
        .update({
          total_sold: totalSold,
          price_history: priceHistory,
          average_fill_price: avgPrice,
          updated_at: now
        })
        .eq('order_id', orderId)

      if (error) throw error
    }
  } catch (error) {
    console.error('Error updating SAL analytics:', error)
  }
}

/**
 * Calculate average fill price from price history
 */
function calculateAveragePrice(priceHistory) {
  if (!priceHistory || priceHistory.length === 0) return '0'

  let totalVolume = 0
  let totalValue = 0

  for (const entry of priceHistory) {
    const amount = parseFloat(entry.sold_amount || '0')
    const price = parseFloat(entry.price || '0')

    totalVolume += amount
    totalValue += amount * price
  }

  return totalVolume > 0 ? (totalValue / totalVolume).toFixed(18) : '0'
}

/**
 * Get SAL order current price
 * @param {string} orderId - Order ID
 * @param {string} network - Network
 * @returns {Object} Price data
 */
export async function getSALOrderPrice(orderId, network) {
  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        order_id,
        is_sal_order,
        sal_initial_price,
        sal_current_price,
        sal_price_curve,
        sal_max_price,
        sal_min_price,
        sal_sold_amount,
        sal_total_inventory,
        sal_price_adjustment_params
      `)
      .eq('order_id', orderId)
      .eq('network', network)
      .eq('is_sal_order', true)
      .single()

    if (error) throw error
    if (!order) {
      return { error: 'SAL order not found' }
    }

    const currentPrice = calculateSALOrderPrice(order)

    return {
      orderId,
      currentPrice,
      initialPrice: order.sal_initial_price,
      soldAmount: order.sal_sold_amount,
      totalInventory: order.sal_total_inventory,
      priceCurve: order.sal_price_curve
    }
  } catch (error) {
    console.error('Error getting SAL order price:', error)
    return { error: error.message }
  }
}

/**
 * Validate SAL order parameters
 */
export function validateSALOrderParams(params) {
  const errors = []

  if (!params.totalAmount || parseFloat(params.totalAmount) <= 0) {
    errors.push('Total amount must be greater than 0')
  }

  if (!params.initialPrice || parseFloat(params.initialPrice) <= 0) {
    errors.push('Initial price must be greater than 0')
  }

  if (params.maxPrice && parseFloat(params.maxPrice) < parseFloat(params.initialPrice)) {
    errors.push('Max price must be greater than initial price')
  }

  if (!['linear', 'exponential', 'stepwise'].includes(params.curveType)) {
    errors.push('Invalid curve type')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}