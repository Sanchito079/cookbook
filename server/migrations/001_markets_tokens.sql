-- Schema update for markets and tokens to store logos and token metadata
-- Run this in the Supabase SQL Editor for your project

-- Ensure markets has required columns
alter table if exists public.markets
  add column if not exists base_address text,
  add column if not exists quote_address text,
  add column if not exists base_name text,
  add column if not exists base_logo_url text,
  add column if not exists quote_name text,
  add column if not exists quote_logo_url text;

-- Ensure unique constraint/index for (network, pool_address) to support upsert
create unique index if not exists markets_network_pool_address_uidx
  on public.markets (network, pool_address);

-- Create tokens table to store per-token metadata and logos
create table if not exists public.tokens (
  network text not null,
  address text not null,
  symbol text,
  name text,
  decimals int,
  logo_url text,
  updated_at timestamptz default now(),
  primary key (network, address)
);

-- Helpful index to query by address regardless of network when needed
create index if not exists tokens_address_idx on public.tokens (address);

-- Optional: enable RLS (service role bypasses RLS; policies are not required for the server to read/write)
alter table public.tokens enable row level security;
-- Example policies (uncomment only if you need anon read or authenticated access directly from clients)
-- create policy "Allow read to authenticated" on public.tokens for select using (auth.role() = 'authenticated');
-- create policy "Allow read to anon" on public.tokens for select using (true);
