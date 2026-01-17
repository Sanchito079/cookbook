-- Migration: add columns used by executor/index for conditional orders and guard against duplicate conditional-origin orders
-- Safe to run multiple times

SET search_path TO public;

-- conditional_orders additions
ALTER TABLE IF EXISTS public.conditional_orders
  ADD COLUMN IF NOT EXISTS triggered_at timestamptz,
  ADD COLUMN IF NOT EXISTS triggered_price text,
  ADD COLUMN IF NOT EXISTS resulting_order_id text;

-- orders additions to link back to conditional order that created it
ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_conditional_order_id text;

-- Optional uniqueness to prevent duplicates produced from the same conditional order (only when source='conditional')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'orders_unique_conditional_source_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX orders_unique_conditional_source_idx ON public.orders (network, source_conditional_order_id) WHERE source = ''conditional''';
  END IF;
END $$;
