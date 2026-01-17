-- Cross-Chain Orders Schema Migration
-- Creates a separate table for cross-chain orders
-- Run this in the Supabase SQL editor. All statements are safe to run multiple times.

SET search_path TO public;

-- =============================
-- CROSS-CHAIN ORDERS TABLE
-- =============================
CREATE TABLE IF NOT EXISTS public.cross_chain_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network         text        NOT NULL,
  order_id        text        NOT NULL,
  order_hash      text        NOT NULL,
  maker           text        NOT NULL,
  token_in        text        NOT NULL,
  token_out       text        NOT NULL,
  amount_in       text        NOT NULL,
  amount_out_min  text        NOT NULL,
  expiration      timestamptz,
  nonce           text        NOT NULL,
  receiver        text,
  salt            text        NOT NULL,
  signature       text        NOT NULL,
  order_json      jsonb       NOT NULL,
  base            text        NOT NULL,
  quote           text        NOT NULL,
  base_address    text        NOT NULL,
  quote_address   text        NOT NULL,
  pair            text        NOT NULL,
  side            text,
  price           text,
  remaining       text        NOT NULL,
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled', 'filled', 'expired')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Add any missing columns
ALTER TABLE IF EXISTS public.cross_chain_orders
  ADD COLUMN IF NOT EXISTS id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS network         text,
  ADD COLUMN IF NOT EXISTS order_id        text,
  ADD COLUMN IF NOT EXISTS order_hash      text,
  ADD COLUMN IF NOT EXISTS maker           text,
  ADD COLUMN IF NOT EXISTS token_in        text,
  ADD COLUMN IF NOT EXISTS token_out       text,
  ADD COLUMN IF NOT EXISTS amount_in       text,
  ADD COLUMN IF NOT EXISTS amount_out_min  text,
  ADD COLUMN IF NOT EXISTS expiration      timestamptz,
  ADD COLUMN IF NOT EXISTS nonce           text,
  ADD COLUMN IF NOT EXISTS receiver        text,
  ADD COLUMN IF NOT EXISTS salt            text,
  ADD COLUMN IF NOT EXISTS signature       text,
  ADD COLUMN IF NOT EXISTS order_json      jsonb,
  ADD COLUMN IF NOT EXISTS base            text,
  ADD COLUMN IF NOT EXISTS quote           text,
  ADD COLUMN IF NOT EXISTS base_address    text,
  ADD COLUMN IF NOT EXISTS quote_address   text,
  ADD COLUMN IF NOT EXISTS pair            text,
  ADD COLUMN IF NOT EXISTS side            text,
  ADD COLUMN IF NOT EXISTS price           text,
  ADD COLUMN IF NOT EXISTS remaining       text,
  ADD COLUMN IF NOT EXISTS status          text DEFAULT 'open' CHECK (status IN ('open', 'cancelled', 'filled', 'expired')),
  ADD COLUMN IF NOT EXISTS created_at      timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

-- Unique constraint on (network, order_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cross_chain_orders_network_order_id_unique'
    AND conrelid = 'public.cross_chain_orders'::regclass
  ) THEN
    ALTER TABLE public.cross_chain_orders
      ADD CONSTRAINT cross_chain_orders_network_order_id_unique UNIQUE (network, order_id);
  END IF;
END $$;

-- Helper indexes
CREATE INDEX IF NOT EXISTS cross_chain_orders_network_idx         ON public.cross_chain_orders (network);
CREATE INDEX IF NOT EXISTS cross_chain_orders_order_id_idx        ON public.cross_chain_orders (order_id);
CREATE INDEX IF NOT EXISTS cross_chain_orders_maker_idx           ON public.cross_chain_orders (maker);
CREATE INDEX IF NOT EXISTS cross_chain_orders_base_address_idx    ON public.cross_chain_orders (base_address);
CREATE INDEX IF NOT EXISTS cross_chain_orders_quote_address_idx   ON public.cross_chain_orders (quote_address);
CREATE INDEX IF NOT EXISTS cross_chain_orders_pair_idx            ON public.cross_chain_orders (pair);
CREATE INDEX IF NOT EXISTS cross_chain_orders_status_idx          ON public.cross_chain_orders (status);
CREATE INDEX IF NOT EXISTS cross_chain_orders_created_at_idx      ON public.cross_chain_orders (created_at DESC);