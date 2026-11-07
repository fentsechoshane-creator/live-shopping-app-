-- CapCut style editing (asked by Ofentse 7 Nov 2026): text can be placed anywhere on the video, sized, turned,
-- styled and coloured. set_post_edit now keeps and checks those fields (it dropped unknown fields before).
create or replace function set_post_edit(p_post uuid, p_edit jsonb) returns void
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
    -- Placeable text (0037): where, how big, which angle, style and colour. Same limits as packages/core/src/edit.ts.
    if m ? 'style' and m->>'style' not in ('plain', 'box', 'outline') then raise exception 'Pick a text style.'; end if;
    if m ? 'color' and m->>'color' not in ('#ffffff', '#0b0b0f', '#22c55e', '#facc15', '#f97316', '#ef4444', '#ec4899', '#60a5fa') then
      raise exception 'Pick a text colour.'; end if;
    if (m ? 'size' and ((m->>'size')::numeric < 0.5 or (m->>'size')::numeric > 3))
      or (m ? 'x' and ((m->>'x')::numeric < 0 or (m->>'x')::numeric > 1)) or (m ? 'y' and ((m->>'y')::numeric < 0 or (m->>'y')::numeric > 1)) then
      raise exception 'A text is off the video or the wrong size.'; end if;
    if m ? 'until' and (m->>'until')::numeric <= t then raise exception 'A text ends before it starts.'; end if;
    marks := marks || jsonb_strip_nulls(jsonb_build_object('kind', m->>'kind', 'at', round(t, 2),
      'until', case when m ? 'until' then round(least((m->>'until')::numeric, total), 2) end,
      'text', nullif(trim(coalesce(m->>'text', '')), ''), 'productId', m->>'productId',
      'pos', case when m->>'pos' in ('top', 'middle', 'bottom') then m->>'pos' end,
      'x', case when m ? 'x' then round((m->>'x')::numeric, 3) end, 'y', case when m ? 'y' then round((m->>'y')::numeric, 3) end,
      'size', case when m ? 'size' then round((m->>'size')::numeric, 2) end,
      'rot', case when m ? 'rot' then greatest(-180, least(180, round((m->>'rot')::numeric))) end,
      'style', m->>'style', 'color', m->>'color'));
  end loop;
  t := coalesce((p_edit->>'cover')::numeric, 0);
  if t < 0 or t > total then t := 0; end if;
  update posts set edit = jsonb_build_object('clips', clips, 'marks', marks, 'cover', round(t, 2)) where id = p_post;
end $$;
