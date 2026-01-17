-- Cross-Chain Orderbook Schema Migration
-- Creates tables for cross-chain fills and trades
-- Run this in the Supabase SQL editor. All statements are safe to run multiple times.

SET search_path TO public;

-- =============================
-- CROSS-CHAIN FILLS TABLE
-- =============================
CREATE TABLE IF NOT EXISTS public.cross_chain_fills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_network     text        NOT NULL,
  sell_network    text        NOT NULL,
  buy_order_id    text        NOT NULL,
  sell_order_id   text        NOT NULL,
  amount_base     text        NOT NULL,
  amount_quote    text        NOT NULL,
  tx_hash_buy     text,
  tx_hash_sell    text,
  block_number_buy bigint,
  block_number_sell bigint,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Add any missing columns
ALTER TABLE IF EXISTS public.cross_chain_fills
  ADD COLUMN IF NOT EXISTS id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS buy_network     text,
  ADD COLUMN IF NOT EXISTS sell_network    text,
  ADD COLUMN IF NOT EXISTS buy_order_id    text,
  ADD COLUMN IF NOT EXISTS sell_order_id   text,
  ADD COLUMN IF NOT EXISTS amount_base     text,
  ADD COLUMN IF NOT EXISTS amount_quote    text,
  ADD COLUMN IF NOT EXISTS tx_hash_buy     text,
  ADD COLUMN IF NOT EXISTS tx_hash_sell    text,
  ADD COLUMN IF NOT EXISTS block_number_buy bigint,
  ADD COLUMN IF NOT EXISTS block_number_sell bigint,
  ADD COLUMN IF NOT EXISTS status          text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  ADD COLUMN IF NOT EXISTS created_at      timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

-- Helper indexes
CREATE INDEX IF NOT EXISTS cross_chain_fills_buy_network_idx     ON public.cross_chain_fills (buy_network);
CREATE INDEX IF NOT EXISTS cross_chain_fills_sell_network_idx    ON public.cross_chain_fills (sell_network);
CREATE INDEX IF NOT EXISTS cross_chain_fills_buy_order_id_idx    ON public.cross_chain_fills (buy_order_id);
CREATE INDEX IF NOT EXISTS cross_chain_fills_sell_order_id_idx   ON public.cross_chain_fills (sell_order_id);
CREATE INDEX IF NOT EXISTS cross_chain_fills_status_idx          ON public.cross_chain_fills (status);
CREATE INDEX IF NOT EXISTS cross_chain_fills_created_at_idx      ON public.cross_chain_fills (created_at DESC);

-- =============================
-- CROSS-CHAIN TRADES TABLE
-- =============================
CREATE TABLE IF NOT EXISTS public.cross_chain_trades (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair            text        NOT NULL,
  base_address    text        NOT NULL,
  quote_address   text        NOT NULL,
  amount_base     text        NOT NULL,
  amount_quote    text        NOT NULL,
  price           numeric     NOT NULL,
  buy_network     text        NOT NULL,
  sell_network    text        NOT NULL,
  tx_hash_buy     text,
  tx_hash_sell    text,
  block_number_buy bigint,
  block_number_sell bigint,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Add any missing columns
ALTER TABLE IF EXISTS public.cross_chain_trades
  ADD COLUMN IF NOT EXISTS id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS pair            text,
  ADD COLUMN IF NOT EXISTS base_address    text,
  ADD COLUMN IF NOT EXISTS quote_address   text,
  ADD COLUMN IF NOT EXISTS amount_base     text,
  ADD COLUMN IF NOT EXISTS amount_quote    text,
  ADD COLUMN IF NOT EXISTS price           numeric,
  ADD COLUMN IF NOT EXISTS buy_network     text,
  ADD COLUMN IF NOT EXISTS sell_network    text,
  ADD COLUMN IF NOT EXISTS tx_hash_buy     text,
  ADD COLUMN IF NOT EXISTS tx_hash_sell    text,
  ADD COLUMN IF NOT EXISTS block_number_buy bigint,
  ADD COLUMN IF NOT EXISTS block_number_sell bigint,
  ADD COLUMN IF NOT EXISTS status          text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  ADD COLUMN IF NOT EXISTS created_at      timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

-- Helper indexes
CREATE INDEX IF NOT EXISTS cross_chain_trades_pair_idx           ON public.cross_chain_trades (pair);
CREATE INDEX IF NOT EXISTS cross_chain_trades_base_address_idx   ON public.cross_chain_trades (base_address);
CREATE INDEX IF NOT EXISTS cross_chain_trades_quote_address_idx  ON public.cross_chain_trades (quote_address);
CREATE INDEX IF NOT EXISTS cross_chain_trades_buy_network_idx    ON public.cross_chain_trades (buy_network);
CREATE INDEX IF NOT EXISTS cross_chain_trades_sell_network_idx   ON public.cross_chain_trades (sell_network);
CREATE INDEX IF NOT EXISTS cross_chain_trades_status_idx         ON public.cross_chain_trades (status);
CREATE INDEX IF NOT EXISTS cross_chain_trades_created_at_idx     ON public.cross_chain_trades (created_at DESC);