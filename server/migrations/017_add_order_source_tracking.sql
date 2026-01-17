-- Add source tracking column to orders table
-- Run this after 016_cross_chain_orders.sql

SET search_path TO public;

-- Add source column to track order origin (regular vs conditional)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'regular';

-- Add index for source queries
CREATE INDEX IF NOT EXISTS orders_source_idx
  ON public.orders (source);