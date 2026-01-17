-- Patch: normalize tokens table for multi-network support and logos
-- Run this in the Supabase SQL Editor for your project

-- 1) Ensure 'network' column exists and is populated (default 'bsc' for existing rows)
alter table if exists public.tokens
  add column if not exists network text;

update public.tokens set network = 'bsc' where network is null;

alter table if exists public.tokens
  alter column network set not null;

-- 2) Ensure expected columns exist
alter table if exists public.tokens
  add column if not exists symbol text,
  add column if not exists name text,
  add column if not exists decimals int,
  add column if not exists logo_url text,
  add column if not exists updated_at timestamptz default now();

-- 3) Rebuild primary key to use (network, address)
-- Drop existing PK if present, then add composite PK
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tokens_pkey'
      AND conrelid = 'public.tokens'::regclass
  ) THEN
    ALTER TABLE public.tokens DROP CONSTRAINT tokens_pkey;
  END IF;
EXCEPTION WHEN others THEN
  -- no-op
END $$;

alter table if exists public.tokens
  add constraint tokens_pkey primary key (network, address);

-- 4) Helpful indexes
create index if not exists tokens_address_idx on public.tokens (address);
create index if not exists tokens_network_address_idx on public.tokens (network, address);

-- Note: service role bypasses RLS; no client policies needed for server reads/writes
