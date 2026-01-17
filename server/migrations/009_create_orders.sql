-- ORDERS TABLE (idempotent)
-- Run this after 008_hotfix_markets_tokens.sql

SET search_path TO public;

-- Create table if missing (with PK). If it exists, add any missing columns below.
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

-- Add any missing columns if the table already existed with a different shape
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS network        text,
  ADD COLUMN IF NOT EXISTS order_id       text,
  ADD COLUMN IF NOT EXISTS maker          text,
  ADD COLUMN IF NOT EXISTS token_in       text,
  ADD COLUMN IF NOT EXISTS token_out      text,
  ADD COLUMN IF NOT EXISTS amount_in      text,
  ADD COLUMN IF NOT EXISTS amount_out_min text,
  ADD COLUMN IF NOT EXISTS remaining      text,
  ADD COLUMN IF NOT EXISTS price          text,
  ADD COLUMN IF NOT EXISTS side           text,
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

-- Ensure a unique constraint/index that supports onConflict: 'network,order_id'
-- If the PK is already composite, this index creation will be a no-op due to IF NOT EXISTS
CREATE UNIQUE INDEX IF NOT EXISTS orders_network_order_id_uidx
  ON public.orders (network, order_id);

-- Helpful indexes for queries
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
