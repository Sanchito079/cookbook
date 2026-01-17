-- FULL SCHEMA MIGRATION FOR COOKBOOK DEX
-- Run this single file in your Supabase SQL Editor to set up all tables, columns, and indexes.
-- This is idempotent and safe to run multiple times.

SET search_path TO public;

-- =============================
-- 1) TOKENS TABLE
-- =============================
CREATE TABLE IF NOT EXISTS public.tokens (
  network    text NOT NULL,
  address    text NOT NULL,
  chain_id   int,
  symbol     text,
  name       text,
  decimals   int,
  logo_url   text,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (network, address)
);

-- Add any missing columns
ALTER TABLE IF EXISTS public.tokens
  ADD COLUMN IF NOT EXISTS network    text,
  ADD COLUMN IF NOT EXISTS address    text,
  ADD COLUMN IF NOT EXISTS chain_id   int,
  ADD COLUMN IF NOT EXISTS symbol     text,
  ADD COLUMN IF NOT EXISTS name       text,
  ADD COLUMN IF NOT EXISTS decimals   int,
  ADD COLUMN IF NOT EXISTS logo_url   text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Unique + helper indexes
CREATE UNIQUE INDEX IF NOT EXISTS tokens_network_address_uidx ON public.tokens (network, address);
CREATE INDEX IF NOT EXISTS tokens_address_idx ON public.tokens (address);
CREATE INDEX IF NOT EXISTS tokens_network_idx ON public.tokens (network);

-- =============================
-- 2) MARKETS TABLE
-- =============================
CREATE TABLE IF NOT EXISTS public.markets (
  network        text,
  pool_address   text,
  pair_key       text,
  base_symbol    text,
  base_address   text,
  base_decimals  int,
  base_name      text,
  base_logo_url  text,
  quote_symbol   text,
  quote_address  text,
  quote_decimals int,
  quote_name     text,
  quote_logo_url text,
  pair           text,
  price          text,
  change         text,
  volume         text,
  gecko_pool_id  text,
  updated_at     timestamptz DEFAULT now()
);

-- Add any missing columns
ALTER TABLE IF EXISTS public.markets
  ADD COLUMN IF NOT EXISTS network        text,
  ADD COLUMN IF NOT EXISTS pool_address   text,
  ADD COLUMN IF NOT EXISTS pair_key       text,
  ADD COLUMN IF NOT EXISTS base_symbol    text,
  ADD COLUMN IF NOT EXISTS base_address   text,
  ADD COLUMN IF NOT EXISTS base_decimals  int,
  ADD COLUMN IF NOT EXISTS base_name      text,
  ADD COLUMN IF NOT EXISTS base_logo_url  text,
  ADD COLUMN IF NOT EXISTS quote_symbol   text,
  ADD COLUMN IF NOT EXISTS quote_address  text,
  ADD COLUMN IF NOT EXISTS quote_decimals int,
  ADD COLUMN IF NOT EXISTS quote_name     text,
  ADD COLUMN IF NOT EXISTS quote_logo_url text,
  ADD COLUMN IF NOT EXISTS pair           text,
  ADD COLUMN IF NOT EXISTS price          text,
  ADD COLUMN IF NOT EXISTS change         text,
  ADD COLUMN IF NOT EXISTS volume         text,
  ADD COLUMN IF NOT EXISTS gecko_pool_id  text,
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT now();

-- Unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS markets_network_pool_address_uidx ON public.markets (network, pool_address);
CREATE UNIQUE INDEX IF NOT EXISTS markets_network_pair_key_uidx ON public.markets (network, pair_key);

-- Helper indexes
CREATE INDEX IF NOT EXISTS markets_network_idx     ON public.markets (network);
CREATE INDEX IF NOT EXISTS markets_updated_at_idx  ON public.markets (updated_at);

-- =============================
-- 3) ORDERS TABLE
-- =============================
CREATE TABLE IF NOT EXISTS public.orders (
  network        text        NOT NULL,
  order_id       text        NOT NULL,
  order_hash     text        NOT NULL,
  maker          text        NOT NULL,
  token_in       text        NOT NULL,
  token_out      text        NOT NULL,
  amount_in      text        NOT NULL,
  amount_out_min text        NOT NULL,
  remaining      text        NOT NULL,
  price          text,
  side           text,
  base           text,
  quote          text,
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

-- Add any missing columns
ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS network        text,
  ADD COLUMN IF NOT EXISTS order_id       text,
  ADD COLUMN IF NOT EXISTS order_hash     text,
  ADD COLUMN IF NOT EXISTS maker          text,
  ADD COLUMN IF NOT EXISTS token_in       text,
  ADD COLUMN IF NOT EXISTS token_out      text,
  ADD COLUMN IF NOT EXISTS amount_in      text,
  ADD COLUMN IF NOT EXISTS amount_out_min text,
  ADD COLUMN IF NOT EXISTS remaining      text,
  ADD COLUMN IF NOT EXISTS price          text,
  ADD COLUMN IF NOT EXISTS side           text,
  ADD COLUMN IF NOT EXISTS base           text,
  ADD COLUMN IF NOT EXISTS quote          text,
  ADD COLUMN IF NOT EXISTS base_address   text,
  ADD COLUMN IF NOT EXISTS quote_address  text,
  ADD COLUMN IF NOT EXISTS pair           text,
  ADD COLUMN IF NOT EXISTS nonce          text,
  ADD COLUMN IF NOT EXISTS receiver       text,
  ADD COLUMN IF NOT EXISTS salt           text,
  ADD COLUMN IF NOT EXISTS signature      text,
  ADD COLUMN IF NOT EXISTS order_json     jsonb,
  ADD COLUMN IF NOT EXISTS expiration     timestamptz,
  ADD COLUMN IF NOT EXISTS status         text DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS created_at     timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT now();

-- Backfill order_hash if needed
UPDATE public.orders SET order_hash = order_id WHERE order_hash IS NULL;

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS orders_network_order_id_uidx ON public.orders (network, order_id);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS orders_network_pair_idx           ON public.orders (network, pair);
CREATE INDEX IF NOT EXISTS orders_network_side_status_idx    ON public.orders (network, side, status);
CREATE INDEX IF NOT EXISTS orders_network_token_in_out_idx   ON public.orders (network, token_in, token_out);
CREATE INDEX IF NOT EXISTS orders_network_maker_idx          ON public.orders (network, maker);
CREATE INDEX IF NOT EXISTS orders_expiration_idx             ON public.orders (expiration);
CREATE INDEX IF NOT EXISTS orders_updated_at_idx             ON public.orders (updated_at);

-- =============================
-- 4) FILLS TABLE
-- =============================
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

-- =============================
-- 5) TRADES TABLE
-- =============================
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

-- =============================
-- OPTIONAL: ENABLE RLS (Row Level Security)
-- =============================
-- Note: Service role bypasses RLS, so this is optional for client access
-- ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.fills ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;