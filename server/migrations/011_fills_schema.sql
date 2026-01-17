-- FILLS TABLE SCHEMA (idempotent)
-- Stores executed fills with transaction hash for UI consumption
-- Run this in Supabase SQL editor. Safe to run multiple times.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS public.fills (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network       text        NOT NULL,
  buy_order_id  text,
  sell_order_id text,
  amount_base   text,
  amount_quote  text,
  tx_hash       text        NOT NULL,
  block_number  bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Add columns defensively
ALTER TABLE IF EXISTS public.fills
  ADD COLUMN IF NOT EXISTS id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS network       text,
  ADD COLUMN IF NOT EXISTS buy_order_id  text,
  ADD COLUMN IF NOT EXISTS sell_order_id text,
  ADD COLUMN IF NOT EXISTS amount_base   text,
  ADD COLUMN IF NOT EXISTS amount_quote  text,
  ADD COLUMN IF NOT EXISTS tx_hash       text,
  ADD COLUMN IF NOT EXISTS block_number  bigint,
  ADD COLUMN IF NOT EXISTS created_at    timestamptz DEFAULT now();

-- Helpful indexes
CREATE INDEX IF NOT EXISTS fills_network_idx       ON public.fills (network);
CREATE INDEX IF NOT EXISTS fills_created_at_idx    ON public.fills (created_at DESC);
CREATE INDEX IF NOT EXISTS fills_buy_order_id_idx  ON public.fills (buy_order_id);
CREATE INDEX IF NOT EXISTS fills_sell_order_id_idx ON public.fills (sell_order_id);
CREATE INDEX IF NOT EXISTS fills_tx_hash_idx       ON public.fills (tx_hash);
