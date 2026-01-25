# Single Adaptive Liquidity Order (SAL Order) Implementation Plan

## Overview
SAL Orders are dynamic orders where price adjusts based on inventory sold, providing intelligent liquidity for illiquid tokens.

## Core Concept
- **One Big Order**: Single order representing large token inventory
- **Dynamic Pricing**: Price increases as tokens are sold (prevents dumps)
- **Database-Driven**: Price updates stored and retrieved from database
- **Signature-Based**: Maintains security through cryptographic signatures

## Database Schema Extensions

### Orders Table Extensions
```sql
-- Add SAL Order fields to existing orders table
ALTER TABLE orders ADD COLUMN is_sal_order boolean DEFAULT false;
ALTER TABLE orders ADD COLUMN sal_initial_price decimal(36,18);
ALTER TABLE orders ADD COLUMN sal_current_price decimal(36,18);
ALTER TABLE orders ADD COLUMN sal_price_curve text; -- 'linear', 'exponential', 'stepwise'
ALTER TABLE orders ADD COLUMN sal_max_price decimal(36,18);
ALTER TABLE orders ADD COLUMN sal_min_price decimal(36,18);
ALTER TABLE orders ADD COLUMN sal_sold_amount decimal(36,18) DEFAULT 0;
ALTER TABLE orders ADD COLUMN sal_total_inventory decimal(36,18);
ALTER TABLE orders ADD COLUMN sal_price_adjustment_params jsonb; -- curve parameters
ALTER TABLE orders ADD COLUMN sal_last_price_update timestamptz;
```

### New SAL Analytics Table
```sql
CREATE TABLE sal_order_analytics (
    order_id text PRIMARY KEY,
    network text NOT NULL,
    total_sold decimal(36,18) DEFAULT 0,
    total_volume_usd decimal(36,18) DEFAULT 0,
    price_history jsonb, -- array of {timestamp, price, sold_amount}
    average_fill_price decimal(36,18),
    price_volatility decimal(36,18),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

## Price Adjustment Algorithms

### 1. Linear Curve
```
Price = initial_price + (sold_amount / total_inventory) * (max_price - initial_price)
```
- Steady price increase as inventory decreases
- Predictable for users

### 2. Exponential Curve
```
Price = initial_price * (1 + k * (sold_amount / total_inventory)^2)
```
- Price increases slowly then accelerates
- Prevents large dumps

### 3. Step-wise Curve
```
if sold_amount < 25% of inventory: price = initial_price
if sold_amount < 50% of inventory: price = initial_price * 1.2
if sold_amount < 75% of inventory: price = initial_price * 1.5
if sold_amount >= 75%: price = max_price
```
- Discrete price jumps at thresholds

## API Endpoints

### SAL Order Management
```
POST /api/sal-orders
- Create new SAL order
- Body: {tokenIn, tokenOut, totalAmount, initialPrice, curveType, maxPrice, ...}

GET /api/sal-orders/:orderId
- Get SAL order details including current price

PUT /api/sal-orders/:orderId
- Update SAL order parameters (price curve, etc.)

DELETE /api/sal-orders/:orderId
- Cancel SAL order
```

### SAL Order Analytics
```
GET /api/sal-orders/:orderId/analytics
- Price history, volume, average fill price

GET /api/sal-orders/:orderId/price
- Current adaptive price for the order
```

## Order Matching Logic Changes

### Current Flow
1. User places order
2. Executor finds matching orders
3. Settlement contract executes trade

### SAL Order Flow
1. User places order to buy from SAL order
2. Executor calls `getSALOrderPrice(orderId)` to get current price
3. If prices compatible, execute trade
4. Update `sal_sold_amount` in database
5. Recalculate and store new `sal_current_price`

## Smart Contract Modifications

### Settlement.sol Extensions
```solidity
function fillSALOrder(
    Order memory salOrder,
    bytes calldata salSignature,
    Order memory takerOrder,
    bytes calldata takerSignature,
    uint256 fillAmount
) external {
    // Get current SAL price from off-chain source
    uint256 currentPrice = getSALOrderPrice(salOrder.hash);
    // Validate price compatibility
    // Execute trade at current price
    // Update SAL order state
}
```

### Price Oracle Integration
- Off-chain price service maintains SAL prices
- On-chain verification ensures price validity
- Signature-based price commitments

## User Interface Components

### SAL Order Creation Form
- Token pair selection
- Total inventory amount
- Initial price setting
- Price curve selection with visual preview
- Max/min price bounds
- Auto-refresh settings

### SAL Order Dashboard
- Current price and inventory remaining
- Price history chart
- Volume and fill analytics
- Price curve visualization
- Manual price adjustment controls

### Trading Interface Integration
- Show SAL orders with current adaptive prices
- Price update indicators
- Inventory remaining display

## Implementation Phases

### Phase 1: Core SAL Orders (Linear Curve)
1. Database schema updates
2. Basic SAL order creation API
3. Linear price adjustment algorithm
4. Order matching integration
5. Simple UI for creation/management

### Phase 2: Advanced Curves & Analytics
1. Exponential and step-wise curves
2. SAL analytics dashboard
3. Price history tracking
4. Performance metrics

### Phase 3: Smart Features
1. Auto-refresh functionality
2. Price prediction algorithms
3. Market data integration
4. Bulk SAL order management

## Security Considerations

### Price Manipulation Prevention
- Minimum time between price updates
- Maximum price change per update
- Off-chain price validation
- Emergency pause mechanisms

### Inventory Tracking
- Accurate sold amount tracking
- Prevention of over-selling
- Database transaction consistency
- Rollback mechanisms for failed trades

## Testing Strategy

### Unit Tests
- Price calculation algorithms
- Database operations
- API endpoints

### Integration Tests
- Full order lifecycle
- Price updates during trading
- Cross-chain compatibility

### Simulation Testing
- Market condition simulations
- Stress testing with high volume
- Edge cases (price bounds, inventory depletion)

## Success Metrics

### Liquidity Metrics
- Orders filled per SAL order
- Average time to fill portions
- Price discovery effectiveness
- Trading volume generated

### User Experience
- SAL order creation time
- Price update frequency
- User satisfaction scores
- Error rates

## Migration Strategy

### Backward Compatibility
- Existing orders remain unchanged
- SAL orders are opt-in feature
- Gradual rollout to production

### Data Migration
- Add new columns with defaults
- Migrate existing market maker orders to SAL format (optional)
- Historical data preservation

This SAL Order system will revolutionize liquidity provision by making it intelligent and adaptive, perfectly suited for bringing life to illiquid tokens.