-- Likes and reposts are public: anyone can see who liked or reposted what, like TikTok.
-- People can still only add or remove their own.
drop policy "own reactions" on post_reactions;
grant select on post_reactions to anon;
create policy "reactions are public" on post_reactions for select to anon, authenticated using (true);
create policy "add own reactions" on post_reactions for insert to authenticated with check (user_id = auth.uid());
create policy "remove own reactions" on post_reactions for delete to authenticated using (user_id = auth.uid());
