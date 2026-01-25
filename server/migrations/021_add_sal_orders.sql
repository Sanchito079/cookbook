-- SAL Order Migration
-- Adds Single Adaptive Liquidity Order functionality to the orderbook

-- Extend orders table with SAL Order fields
ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS is_sal_order boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sal_initial_price decimal(36,18),
  ADD COLUMN IF NOT EXISTS sal_current_price decimal(36,18),
  ADD COLUMN IF NOT EXISTS sal_price_curve text DEFAULT 'linear',
  ADD COLUMN IF NOT EXISTS sal_max_price decimal(36,18),
  ADD COLUMN IF NOT EXISTS sal_min_price decimal(36,18),
  ADD COLUMN IF NOT EXISTS sal_sold_amount decimal(36,18) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sal_total_inventory decimal(36,18),
  ADD COLUMN IF NOT EXISTS sal_price_adjustment_params jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sal_last_price_update timestamptz DEFAULT now();

-- Create SAL Order analytics table
CREATE TABLE IF NOT EXISTS public.sal_order_analytics (
  order_id text PRIMARY KEY,
  network text NOT NULL,
  total_sold decimal(36,18) DEFAULT 0,
  total_volume_usd decimal(36,18) DEFAULT 0,
  price_history jsonb DEFAULT '[]', -- array of {timestamp, price, sold_amount}
  average_fill_price decimal(36,18),
  price_volatility decimal(36,18),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add indexes for SAL Order queries
CREATE INDEX IF NOT EXISTS orders_is_sal_order_idx ON public.orders (is_sal_order) WHERE is_sal_order = true;
CREATE INDEX IF NOT EXISTS orders_sal_current_price_idx ON public.orders (sal_current_price) WHERE is_sal_order = true;
CREATE INDEX IF NOT EXISTS sal_order_analytics_network_idx ON public.sal_order_analytics (network);
CREATE INDEX IF NOT EXISTS sal_order_analytics_updated_at_idx ON public.sal_order_analytics (updated_at DESC);

-- Add comments for documentation
COMMENT ON COLUMN public.orders.is_sal_order IS 'Indicates if this is a Single Adaptive Liquidity Order';
COMMENT ON COLUMN public.orders.sal_initial_price IS 'Starting price for SAL order';
COMMENT ON COLUMN public.orders.sal_current_price IS 'Current adaptive price based on inventory sold';
COMMENT ON COLUMN public.orders.sal_price_curve IS 'Price adjustment curve: linear, exponential, stepwise';
COMMENT ON COLUMN public.orders.sal_sold_amount IS 'Total amount sold from this SAL order';
COMMENT ON COLUMN public.orders.sal_total_inventory IS 'Total inventory available in SAL order';
COMMENT ON COLUMN public.orders.sal_price_adjustment_params IS 'JSON parameters for price curve calculation';

COMMENT ON TABLE public.sal_order_analytics IS 'Analytics and performance data for SAL orders';
COMMENT ON COLUMN public.sal_order_analytics.price_history IS 'Historical price changes with timestamps';