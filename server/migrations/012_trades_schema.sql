-- TRADES TABLE SCHEMA (idempotent)
-- Stores enriched trade data for market statistics
-- Run this in Supabase SQL editor. Safe to run multiple times.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS public.trades (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network         text        NOT NULL,
  pair            text        NOT NULL,
  base_address    text        NOT NULL,
  quote_address   text        NOT NULL,
  amount_base     text        NOT NULL,
  amount_quote    text        NOT NULL,
  price           numeric     NOT NULL,
  tx_hash         text        NOT NULL,
  block_number    bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Add columns defensively
ALTER TABLE IF EXISTS public.trades
  ADD COLUMN IF NOT EXISTS id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS network         text,
  ADD COLUMN IF NOT EXISTS pair            text,
  ADD COLUMN IF NOT EXISTS base_address    text,
  ADD COLUMN IF NOT EXISTS quote_address   text,
  ADD COLUMN IF NOT EXISTS amount_base     text,
  ADD COLUMN IF NOT EXISTS amount_quote    text,
  ADD COLUMN IF NOT EXISTS price           numeric,
  ADD COLUMN IF NOT EXISTS tx_hash         text,
  ADD COLUMN IF NOT EXISTS block_number    bigint,
  ADD COLUMN IF NOT EXISTS created_at      timestamptz DEFAULT now();

-- Helpful indexes
CREATE INDEX IF NOT EXISTS trades_network_idx         ON public.trades (network);
CREATE INDEX IF NOT EXISTS trades_pair_idx           ON public.trades (pair);
CREATE INDEX IF NOT EXISTS trades_base_address_idx   ON public.trades (base_address);
CREATE INDEX IF NOT EXISTS trades_quote_address_idx  ON public.trades (quote_address);
CREATE INDEX IF NOT EXISTS trades_created_at_idx     ON public.trades (created_at DESC);
CREATE INDEX IF NOT EXISTS trades_tx_hash_idx        ON public.trades (tx_hash);