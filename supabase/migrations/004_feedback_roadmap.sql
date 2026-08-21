-- CatchLab roadmap: public statuses everyone can see, private inbox for the owner.
-- Statuses: pending (private, just submitted) | planned | in_progress | shipped | declined.

-- Public can read only roadmap items (never other users' raw pending submissions).
drop policy if exists "Anyone can read approved feedback" on public.feedback;
create policy "Anyone can read roadmap feedback" on public.feedback
  for select using (status in ('planned', 'in_progress', 'shipped'));

-- The owner (by email) can read EVERYTHING, including the pending inbox — this is
-- the private request log only they can consult.
drop policy if exists "Owner can read all feedback" on public.feedback;
create policy "Owner can read all feedback" on public.feedback
  for select using (auth.jwt() ->> 'email' = 'cinicololuca@gmail.com');

-- The owner can move items across the roadmap (pending -> planned -> shipped ...).
drop policy if exists "Owner can update feedback" on public.feedback;
create policy "Owner can update feedback" on public.feedback
  for update using (auth.jwt() ->> 'email' = 'cinicololuca@gmail.com');
