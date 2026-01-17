-- Conditional Orders Schema Migration
-- Creates public.conditional_orders table for stop loss and take profit orders
-- Run this in the Supabase SQL editor. All statements are safe to run multiple times.

SET search_path TO public;

-- =============================
-- CONDITIONAL ORDERS
-- =============================
CREATE TABLE IF NOT EXISTS public.conditional_orders (
  network              text        NOT NULL,
  conditional_order_id text        NOT NULL,
  maker                text        NOT NULL,
  base_token           text        NOT NULL,
  quote_token          text        NOT NULL,
  pair                 text,
  type                 text        NOT NULL CHECK (type IN ('stop_loss', 'take_profit')),
  trigger_price        text        NOT NULL,
  order_template       jsonb       NOT NULL,
  signature            text        NOT NULL,
  status               text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'triggered', 'cancelled', 'expired')),
  expiration           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, conditional_order_id)
);

-- Add any missing columns
ALTER TABLE IF EXISTS public.conditional_orders
  ADD COLUMN IF NOT EXISTS network              text,
  ADD COLUMN IF NOT EXISTS conditional_order_id text,
  ADD COLUMN IF NOT EXISTS maker                text,
  ADD COLUMN IF NOT EXISTS base_token           text,
  ADD COLUMN IF NOT EXISTS quote_token          text,
  ADD COLUMN IF NOT EXISTS pair                 text,
  ADD COLUMN IF NOT EXISTS type                 text CHECK (type IN ('stop_loss', 'take_profit')),
  ADD COLUMN IF NOT EXISTS trigger_price        text,
  ADD COLUMN IF NOT EXISTS order_template       jsonb,
  ADD COLUMN IF NOT EXISTS signature            text,
  ADD COLUMN IF NOT EXISTS status               text DEFAULT 'pending' CHECK (status IN ('pending', 'triggered', 'cancelled', 'expired')),
  ADD COLUMN IF NOT EXISTS expiration           timestamptz,
  ADD COLUMN IF NOT EXISTS created_at           timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz DEFAULT now();

-- Unique index (redundant with PK but harmless)
CREATE UNIQUE INDEX IF NOT EXISTS conditional_orders_network_id_uidx ON public.conditional_orders (network, conditional_order_id);

-- Helper indexes
CREATE INDEX IF NOT EXISTS conditional_orders_network_maker_idx     ON public.conditional_orders (network, maker);
CREATE INDEX IF NOT EXISTS conditional_orders_network_status_idx    ON public.conditional_orders (network, status);
CREATE INDEX IF NOT EXISTS conditional_orders_network_pair_idx      ON public.conditional_orders (network, pair);
CREATE INDEX IF NOT EXISTS conditional_orders_expiration_idx        ON public.conditional_orders (expiration);
CREATE INDEX IF NOT EXISTS conditional_orders_updated_at_idx        ON public.conditional_orders (updated_at);