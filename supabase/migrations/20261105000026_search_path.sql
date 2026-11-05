-- Supabase security check after the live push: pin the search path on the four helpers it flagged,
-- so nobody can swap in a look alike function through their own schema.
alter function public.rude_text(text) set search_path = public, pg_temp;
alter function public.bid_step(int) set search_path = public, pg_temp;
alter function public.auction_internal() set search_path = public, pg_temp;
alter function public.force_created_now() set search_path = public, pg_temp;
