-- FULL SCHEMA MIGRATION (idempotent)
-- Creates or patches public.tokens, public.markets, and public.orders to match the backend expectations.
-- Run this in the Supabase SQL editor. All statements are safe to run multiple times.

SET search_path TO public;

-- =============================
-- 1) TOKENS
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

-- Unique + helper indexes (PK already enforces uniqueness, index is safe as a no-op if exists)
CREATE UNIQUE INDEX IF NOT EXISTS tokens_network_address_uidx ON public.tokens (network, address);
CREATE INDEX IF NOT EXISTS tokens_address_idx ON public.tokens (address);
CREATE INDEX IF NOT EXISTS tokens_network_idx ON public.tokens (network);


-- =============================
-- 2) MARKETS
-- =============================
CREATE TABLE IF NOT EXISTS public.markets (
  network        text,
  pool_address   text,
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

-- Unique index used by backend upserts
CREATE UNIQUE INDEX IF NOT EXISTS markets_network_pool_address_uidx ON public.markets (network, pool_address);

-- Helper indexes
CREATE INDEX IF NOT EXISTS markets_network_idx     ON public.markets (network);
CREATE INDEX IF NOT EXISTS markets_updated_at_idx  ON public.markets (updated_at);


-- =============================
-- 3) ORDERS
-- =============================
-- Schema is a superset to accommodate slight project-to-project variations (e.g., presence of base/quote, order_hash).
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
  -- "side" type may differ across deployments (text or smallint). We declare as text for new installs.
  side           text,
  -- Some deployments store explicit base/quote alongside token_in/out.
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

-- Add any missing columns (no type changes attempted; existing columns keep their type)
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

-- Backfill and enforce NOT NULL on order_hash when possible
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_hash'
  ) THEN
    -- backfill missing order_hash using order_id
    UPDATE public.orders SET order_hash = order_id WHERE order_hash IS NULL;
    -- attempt to enforce NOT NULL; if rows still violate, skip
    BEGIN
      ALTER TABLE public.orders ALTER COLUMN order_hash SET NOT NULL;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
END $$;

-- Unique index used by backend upserts (redundant with PK but harmless)
CREATE UNIQUE INDEX IF NOT EXISTS orders_network_order_id_uidx ON public.orders (network, order_id);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS orders_network_pair_idx           ON public.orders (network, pair);
CREATE INDEX IF NOT EXISTS orders_network_side_status_idx    ON public.orders (network, side, status);
CREATE INDEX IF NOT EXISTS orders_network_token_in_out_idx   ON public.orders (network, token_in, token_out);
CREATE INDEX IF NOT EXISTS orders_network_maker_idx          ON public.orders (network, maker);
CREATE INDEX IF NOT EXISTS orders_expiration_idx             ON public.orders (expiration);
CREATE INDEX IF NOT EXISTS orders_updated_at_idx             ON public.orders (updated_at);

-- Optional: enable RLS (service role bypasses RLS, so this is not required for the backend to function)
-- ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.orders  ENABLE ROW LEVEL SECURITY;
