-- Patch: ensure public.markets has a 'network' column before creating indexes
-- Run this in the Supabase SQL Editor

-- 1) Add missing columns on markets
alter table if exists public.markets
  add column if not exists network text,
  add column if not exists pool_address text,
  add column if not exists base_name text,
  add column if not exists base_logo_url text,
  add column if not exists quote_name text,
  add column if not exists quote_logo_url text;

-- 2) Create unique index used by server upserts (safe if it exists)
create unique index if not exists markets_network_pool_address_uidx
  on public.markets (network, pool_address);

-- Note: we do not backfill 'network' values to avoid guessing. New writes from the indexer set it explicitly (e.g., 'bsc').