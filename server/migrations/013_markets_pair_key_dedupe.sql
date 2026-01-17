-- Migration: Add canonical pair_key to markets, backfill, dedupe, and enforce uniqueness
-- Safe to run multiple times (uses IF EXISTS / IF NOT EXISTS and idempotent logic)

-- 0) Ensure we operate on the public schema
set search_path to public;

-- 1) Allow updates if table participates in a publication without primary key
--    FULL replica identity is the simplest choice if you're unsure of an existing PK
alter table if exists public.markets replica identity full;

-- 2) Add pair_key column if missing
alter table if exists public.markets
  add column if not exists pair_key text;

-- 3) Backfill pair_key for all rows (canonical lowercased min/max of addresses)
update public.markets
set pair_key = case
  when coalesce(lower(base_address), '') <= coalesce(lower(quote_address), '')
    then coalesce(lower(base_address), '') || '_' || coalesce(lower(quote_address), '')
  else
    coalesce(lower(quote_address), '') || '_' || coalesce(lower(base_address), '')
end
where pair_key is null;

-- 4) One-time cleanup: keep most recent row per (network, pair_key), delete the rest
with ranked as (
  select
    ctid,
    network,
    pair_key,
    updated_at,
    row_number() over (
      partition by network, pair_key
      order by updated_at desc nulls last, ctid desc
    ) as rn
  from public.markets
  where pair_key is not null
)
delete from public.markets m
using ranked r
where m.ctid = r.ctid
  and r.rn > 1;

-- 5) Create the unique index now that duplicates are removed
create unique index if not exists markets_network_pair_key_uidx
  on public.markets (network, pair_key);

-- Notes:
-- - After this migration, ensure your backend upserts markets on (network, pair_key)
--   and computes pair_key the same way, which has been implemented in server/index.js.
-- - Existing legacy duplicates are removed by step 4; future duplicates are blocked by the unique index.
