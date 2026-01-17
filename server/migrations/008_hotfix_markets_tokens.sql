-- HOTFIX: ensure 'network' exists and indexes can be created without 42703 errors
-- Run this in Supabase SQL Editor. It is idempotent and safe.

SET search_path TO public;

-- ===============
-- markets
-- ===============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'markets'
  ) THEN
    -- Create a minimal markets table if missing (fields commonly used by server)
    CREATE TABLE public.markets (
      network        text,
      pool_address   text,
      base_symbol    text,
      base_address   text,
      base_decimals  int,
      quote_symbol   text,
      quote_address  text,
      quote_decimals int,
      pair           text,
      price          text,
      change         text,
      volume         text,
      gecko_pool_id  text,
      updated_at     timestamptz
    );
  END IF;
END $$;

-- Add missing columns (no-op if present)
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS network        text,
  ADD COLUMN IF NOT EXISTS pool_address   text,
  ADD COLUMN IF NOT EXISTS base_name      text,
  ADD COLUMN IF NOT EXISTS base_logo_url  text,
  ADD COLUMN IF NOT EXISTS quote_name     text,
  ADD COLUMN IF NOT EXISTS quote_logo_url text;

-- Drop and recreate the unique index to avoid stale definitions
DROP INDEX IF EXISTS markets_network_pool_address_uidx;
CREATE UNIQUE INDEX markets_network_pool_address_uidx
  ON public.markets (network, pool_address);

-- ===============
-- tokens
-- ===============
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

ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS network    text,
  ADD COLUMN IF NOT EXISTS address    text,
  ADD COLUMN IF NOT EXISTS chain_id   int,
  ADD COLUMN IF NOT EXISTS symbol     text,
  ADD COLUMN IF NOT EXISTS name       text,
  ADD COLUMN IF NOT EXISTS decimals   int,
  ADD COLUMN IF NOT EXISTS logo_url   text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Drop and recreate unique index to guarantee correct definition
DROP INDEX IF EXISTS tokens_network_address_uidx;
CREATE UNIQUE INDEX tokens_network_address_uidx
  ON public.tokens (network, address);

-- Helper indexes
CREATE INDEX IF NOT EXISTS tokens_address_idx ON public.tokens (address);
CREATE INDEX IF NOT EXISTS tokens_network_idx ON public.tokens (network);
