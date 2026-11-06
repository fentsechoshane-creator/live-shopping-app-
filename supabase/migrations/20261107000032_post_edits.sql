-- The video editor (docs/VIDEO_EDITING.md, decided with Ofentse 6 to 7 Nov 2026).
-- A post can be several clips (camera or gallery), each trimmed, with text, item tags ("haul" mode) and flaw marks,
-- and a chosen cover moment. Stored as an edit list on the post; the app plays the clips in order and draws the marks.
-- Nothing is re-rendered. Same limits as packages/core/src/edit.ts.

alter table posts add column edit jsonb check (edit is null or octet_length(edit::text) <= 20000);

-- The seller saves the edit after uploading the clips. Every part is checked here.
create function set_post_edit(p_post uuid, p_edit jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare po posts; c jsonb; m jsonb; total numeric := 0; n int := 0; clips jsonb := '[]'; marks jsonb := '[]'; s numeric; e numeric; t numeric;
begin
  select * into po from posts where id = p_post;
  if po.id is null or shop_owner(po.shop_id) <> auth.uid() then raise exception 'Only the seller can edit this post.'; end if;
  if jsonb_typeof(p_edit->'clips') <> 'array' or jsonb_array_length(p_edit->'clips') not between 1 and 10 then raise exception 'A video has 1 to 10 clips.'; end if;
  for c in select * from jsonb_array_elements(p_edit->'clips') loop
    n := n + 1;
    if not exists (select 1 from media where id = (c->>'media')::uuid and owner_id = auth.uid() and kind in ('video', 'image')) then
      raise exception 'Clip % isn''t one of your uploads.', n; end if;
    s := (c->>'start')::numeric; e := (c->>'end')::numeric;
    if s is null or e is null or s < 0 or e - s < 1 then raise exception 'Clip % must be at least 1 second.', n; end if;
    total := total + (e - s);
    clips := clips || jsonb_build_object('media', c->>'media', 'start', round(s, 2), 'end', round(e, 2),
      'muted', coalesce((c->>'muted')::boolean, false), 'inApp', coalesce((c->>'inApp')::boolean, false));
  end loop;
  if total > 180 then raise exception 'Videos can be up to 3 minutes.'; end if;
  if jsonb_typeof(coalesce(p_edit->'marks', '[]')) <> 'array' or jsonb_array_length(coalesce(p_edit->'marks', '[]')) > 30 then
    raise exception 'Up to 30 texts, tags and flaws.'; end if;
  for m in select * from jsonb_array_elements(coalesce(p_edit->'marks', '[]')) loop
    t := (m->>'at')::numeric;
    if m->>'kind' not in ('text', 'tag', 'flaw') or t is null or t < 0 or t > total then raise exception 'A text, tag or flaw is outside the video.'; end if;
    if length(coalesce(m->>'text', '')) > 80 then raise exception 'Keep texts under 80 characters.'; end if;
    if m->>'kind' = 'text' and length(trim(coalesce(m->>'text', ''))) = 0 then raise exception 'A text is empty.'; end if;
    if m->>'kind' = 'tag' and not exists (select 1 from products where id = (m->>'productId')::uuid and shop_id = po.shop_id) then
      raise exception 'You can only tag your own items.'; end if;
    marks := marks || jsonb_strip_nulls(jsonb_build_object('kind', m->>'kind', 'at', round(t, 2),
      'until', case when m ? 'until' then round(least((m->>'until')::numeric, total), 2) end,
      'text', nullif(trim(coalesce(m->>'text', '')), ''), 'productId', m->>'productId',
      'pos', case when m->>'pos' in ('top', 'middle', 'bottom') then m->>'pos' end));
  end loop;
  t := coalesce((p_edit->>'cover')::numeric, 0);
  if t < 0 or t > total then t := 0; end if;
  update posts set edit = jsonb_build_object('clips', clips, 'marks', marks, 'cover', round(t, 2)) where id = p_post;
end $$;
revoke execute on function set_post_edit(uuid, jsonb) from public, anon;
grant execute on function set_post_edit(uuid, jsonb) to authenticated;

-- What the app plays: each clip with its video, in order. Clips still processing are left out until ready.
-- Also readable as a column (select ..., clips from posts) thanks to PostgREST computed fields.
create function post_clips(p_edit jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('playbackId', m.mux_playback_id, 'path', m.storage_path, 'kind', m.kind,
    'start', (c->>'start')::numeric, 'end', (c->>'end')::numeric, 'muted', (c->>'muted')::boolean, 'inApp', (c->>'inApp')::boolean) order by o), '[]'::jsonb)
  from jsonb_array_elements(p_edit->'clips') with ordinality as x(c, o)
  join media m on m.id = (c->>'media')::uuid and m.status = 'ready';
$$;
create function clips(p posts) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when p.status = 'live' and p.edit is not null then post_clips(p.edit) end;
$$;
grant execute on function post_clips(jsonb), clips(posts) to anon, authenticated;

-- Clip videos are as visible as the post they're in.
create or replace function public.media_in_live_post(p_media uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from posts where status = 'live' and (media_id = p_media
    or (edit is not null and edit->'clips' @> jsonb_build_array(jsonb_build_object('media', p_media::text)))));
$$;

-- The feed carries the edit and the clips.
drop function feed(int, int);
create function feed(p_limit int default 20, p_offset int default 0)
returns table (
  post_id uuid, caption text, posted_at timestamptz,
  product_id uuid, title text, description text, price_cents int, mode sale_mode, label listing_label,
  condition item_condition, sizes text[], stock int, lead_days int, allergens text,
  shop_id uuid, shop_name text, shop_handle text, category shop_category, trust_score int, tier text,
  playback_id text, storage_path text, rank numeric, edit jsonb, clips jsonb
) language sql stable security definer set search_path = public as $$
  select po.id, po.caption, po.created_at,
         p.id, p.title, p.description, p.price_cents, p.mode, p.label, p.condition, p.sizes, p.stock, p.lead_days, p.allergens,
         s.id, s.name, s.handle, s.category, pr.trust_score, tier_for(pr.trust_score),
         m.mux_playback_id, m.storage_path,
         (3 * (select count(*) from orders o where o.shop_id = s.id and o.status not in ('pending_payment', 'cancelled', 'refunded')
                and o.created_at > now() - interval '30 days')
          + case tier_for(pr.trust_score) when 'top' then 10 when 'trusted' then 5 else 0 end
          - extract(epoch from now() - po.created_at) / 3600 / 24)::numeric as rank,
         po.edit, case when po.edit is not null then post_clips(po.edit) end
  from posts po
  join products p on p.id = po.product_id
  join shops s on s.id = po.shop_id
  join profiles pr on pr.id = s.owner_id
  join media m on m.id = po.media_id
  left join account_features f on f.user_id = pr.id and f.feature = 'in_feed'
  where po.status = 'live' and p.status = 'live' and s.status = 'open' and m.status = 'ready'
    and (pr.trust_score >= 40 or f.state = 'on') and f.state is distinct from 'off'
  order by rank desc, po.created_at desc
  limit least(p_limit, 50) offset p_offset;
$$;
grant execute on function feed(int, int) to anon, authenticated;
