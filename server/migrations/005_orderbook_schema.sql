-- Orderbook schema setup (idempotent). Run this in Supabase SQL Editor.
-- This file:
--  1) Ensures public.tokens has required columns and indexes
--  2) Ensures public.markets has logo/name columns and unique index
--  3) Creates public.orders table with all indexes

-- =============================
-- 1) TOKENS: ensure table/columns/indexes
-- =============================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tokens'
  ) THEN
    CREATE TABLE public.tokens (
      network    text,
      address    text,
      chain_id   int,
      symbol     text,
      name       text,
      decimals   int,
      logo_url   text,
      updated_at timestamptz default now()
    );
  END IF;
END $$;

-- Add missing columns (no-op if already exist)
ALTER TABLE IF EXISTS public.tokens
  ADD COLUMN IF NOT EXISTS network    text,
  ADD COLUMN IF NOT EXISTS address    text,
  ADD COLUMN IF NOT EXISTS chain_id   int,
  ADD COLUMN IF NOT EXISTS symbol     text,
  ADD COLUMN IF NOT EXISTS name       text,
  ADD COLUMN IF NOT EXISTS decimals   int,
  ADD COLUMN IF NOT EXISTS logo_url   text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Unique index used by server upserts
CREATE UNIQUE INDEX IF NOT EXISTS tokens_network_address_uidx
  ON public.tokens (network, address);

-- Helper indexes
CREATE INDEX IF NOT EXISTS tokens_address_idx ON public.tokens (address);
CREATE INDEX IF NOT EXISTS tokens_network_idx ON public.tokens (network);

-- =============================
-- 2) MARKETS: ensure logo/name columns and unique index
-- =============================
ALTER TABLE IF EXISTS public.markets
  ADD COLUMN IF NOT EXISTS base_name      text,
  ADD COLUMN IF NOT EXISTS base_logo_url  text,
  ADD COLUMN IF NOT EXISTS quote_name     text,
  ADD COLUMN IF NOT EXISTS quote_logo_url text;

CREATE UNIQUE INDEX IF NOT EXISTS markets_network_pool_address_uidx
  ON public.markets (network, pool_address);

-- =============================
-- 3) ORDERS: create table and indexes
-- =============================
CREATE TABLE IF NOT EXISTS public.orders (
  network        text        NOT NULL,
  order_id       text        NOT NULL,
  maker          text        NOT NULL,
  token_in       text        NOT NULL,
  token_out      text        NOT NULL,
  amount_in      text        NOT NULL,
  amount_out_min text        NOT NULL,
  remaining      text        NOT NULL,
  price          text,
  side           text        CHECK (side in ('ask','bid')),
  base_address   text,
  quote_address  text,
  pair           text,
  nonce          text,
  receiver       text,
  salt           text,
  signature      text,
  order_json     jsonb,
  expiration     timestamptz,
  status         text        NOT NULL DEFAULT 'open',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, order_id)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS orders_network_pair_idx
  ON public.orders (network, pair);
CREATE INDEX IF NOT EXISTS orders_network_side_status_idx
  ON public.orders (network, side, status);
CREATE INDEX IF NOT EXISTS orders_network_token_in_out_idx
  ON public.orders (network, token_in, token_out);
CREATE INDEX IF NOT EXISTS orders_network_maker_idx
  ON public.orders (network, maker);
CREATE INDEX IF NOT EXISTS orders_expiration_idx
  ON public.orders (expiration);
CREATE INDEX IF NOT EXISTS orders_updated_at_idx
  ON public.orders (updated_at);
