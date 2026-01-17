-- Safe migration: add network scoping without modifying existing rows
-- Run this in the Supabase SQL Editor

-- 1) Ensure 'network' column exists (nullable to avoid corrupting existing multi-chain data)
alter table if exists public.tokens
  add column if not exists network text;

-- 2) Ensure expected columns exist
alter table if exists public.tokens
  add column if not exists symbol text,
  add column if not exists name text,
  add column if not exists decimals int,
  add column if not exists logo_url text,
  add column if not exists updated_at timestamptz default now();

-- 3) Create a unique index for upserts on (network, address)
-- Note: this requires network to be non-null for rows written by the indexer
create unique index if not exists tokens_network_address_uidx on public.tokens (network, address);

-- 4) Optional helper indexes
create index if not exists tokens_address_idx on public.tokens (address);
create index if not exists tokens_network_idx on public.tokens (network);

-- No backfill is performed here to avoid guessing networks for pre-existing data.
-- Your indexer writes with 'network' set (e.g., 'bsc'), so new rows will be correctly scoped.
