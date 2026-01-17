-- Create watchlists table for user-specific watchlists
CREATE TABLE IF NOT EXISTS public.watchlists (
  user_id text NOT NULL,
  pair text NOT NULL,
  pool_address text,
  network text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT watchlists_pkey PRIMARY KEY (user_id, pair, network)
) TABLESPACE pg_default;

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_watchlists_pair_network ON public.watchlists USING btree (pair, network) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON public.watchlists USING btree (user_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_watchlists_pool_address ON public.watchlists USING btree (pool_address) TABLESPACE pg_default;

-- Function to get watch count for a pair
CREATE OR REPLACE FUNCTION get_watch_count(p_pair text, p_network text)
RETURNS integer AS $$
BEGIN
  RETURN (SELECT COUNT(*) FROM public.watchlists WHERE pair = p_pair AND network = p_network);
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT ALL ON public.watchlists TO postgres;
GRANT EXECUTE ON FUNCTION get_watch_count(text, text) TO postgres;