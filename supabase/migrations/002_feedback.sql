-- FEEDBACK (CatchLab)
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  category text not null,
  title text not null,
  description text not null,
  rating integer,
  role text,
  status text default 'pending',
  created_at timestamptz default now()
);
alter table public.feedback enable row level security;
create policy "Users can insert feedback" on public.feedback
  for insert with check (auth.uid() = user_id);
create policy "Anyone can read approved feedback" on public.feedback
  for select using (status = 'approved');
