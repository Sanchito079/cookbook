-- Patch migration: ensure 'tokens' table has all expected columns used by the indexer
-- Run this in the Supabase SQL Editor for your project

-- Add missing columns if the table already existed without them
alter table if exists public.tokens
  add column if not exists symbol text,
  add column if not exists name text,
  add column if not exists decimals int,
  add column if not exists logo_url text,
  add column if not exists updated_at timestamptz default now();

-- Optional: ensure markets also has the logo/name columns (idempotent)
alter table if exists public.markets
  add column if not exists base_name text,
  add column if not exists base_logo_url text,
  add column if not exists quote_name text,
  add column if not exists quote_logo_url text;

-- Keep helpful indexes/policies as in initial migration
create unique index if not exists markets_network_pool_address_uidx
  on public.markets (network, pool_address);

create index if not exists tokens_address_idx on public.tokens (address);

-- RLS note: service role bypasses RLS; policies are not required for server reads/writes
-- If you need direct client reads, add a SELECT policy accordingly.