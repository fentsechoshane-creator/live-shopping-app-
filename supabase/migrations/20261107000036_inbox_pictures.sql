-- Inbox like a social app's messages (asked by Ofentse 7 Nov 2026): every chat shows the other person's picture and
-- "You:" when the last message was yours. For a buyer the picture is the shop owner's; for a seller, the buyer's.
drop function my_conversations();
create function my_conversations()
returns table (id uuid, shop_id uuid, shop_name text, shop_handle text, other_name text, i_am_seller boolean,
               last_body text, last_at timestamptz, unread int, buyer_id uuid, other_avatar text, last_mine boolean)
language sql stable security definer set search_path = public as $$
  select c.id, s.id, s.name, s.handle,
         case when c.buyer_id = auth.uid() then s.name else coalesce(nullif(p.display_name, ''), 'Buyer') end,
         c.buyer_id <> auth.uid(),
         (select case when m.offer_id is not null then 'Sent an offer' when length(m.body) = 0 then 'Sent a photo' else m.body end
            from messages m where m.conversation_id = c.id order by created_at desc limit 1),
         c.last_message_at,
         (select count(*)::int from messages m where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.read_at is null),
         c.buyer_id,
         case when c.buyer_id = auth.uid() then o.avatar_path else p.avatar_path end,
         (select m.sender_id = auth.uid() from messages m where m.conversation_id = c.id order by created_at desc limit 1)
  from conversations c join shops s on s.id = c.shop_id join profiles p on p.id = c.buyer_id join profiles o on o.id = s.owner_id
  where (c.buyer_id = auth.uid() or s.owner_id = auth.uid())
    and not blocked_between(c.buyer_id, s.owner_id)
  order by c.last_message_at desc;
$$;
grant execute on function my_conversations() to authenticated;
