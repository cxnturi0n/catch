-- PROFILES
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email);
  return new;
end;
$$ language plpgsql security definer;
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- WORKSPACES
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  project_type text,
  community_size text,
  platforms text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.workspaces enable row level security;
create policy "Owner can manage workspaces" on public.workspaces
  for all using (owner_id = auth.uid());

-- INTEGRATIONS
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  platform text not null,
  status text default 'disconnected',
  credentials jsonb default '{}',
  metadata jsonb default '{}',
  last_sync timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(workspace_id, platform)
);
alter table public.integrations enable row level security;
create policy "Owner can manage integrations" on public.integrations
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- PLATFORM METRICS
create table if not exists public.platform_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  platform text not null,
  date date not null default current_date,
  metrics jsonb not null default '{}',
  created_at timestamptz default now(),
  unique(workspace_id, platform, date)
);
alter table public.platform_metrics enable row level security;
create policy "Owner can manage metrics" on public.platform_metrics
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- MODERATORS
create table if not exists public.moderators (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  full_name text not null,
  discord_handle text,
  telegram_handle text,
  platforms text[] default '{}',
  start_date date,
  contract_type text default 'Volunteer',
  monthly_rate numeric,
  currency text default 'USDT',
  timezone text,
  shift text,
  status text default 'Off Duty',
  notes text,
  warnings jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.moderators enable row level security;
create policy "Owner can manage moderators" on public.moderators
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- SCAM INCIDENTS
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  date date not null default current_date,
  type text not null,
  channel text not null,
  action_taken text,
  status text default 'Open',
  created_at timestamptz default now()
);
alter table public.incidents enable row level security;
create policy "Owner can manage incidents" on public.incidents
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- KOL TRACKER
create table if not exists public.kols (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  name text not null,
  handle text,
  channel text,
  reach integer default 0,
  status text default 'Pending',
  last_activity date,
  notes text,
  created_at timestamptz default now()
);
alter table public.kols enable row level security;
create policy "Owner can manage kols" on public.kols
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- TASKS
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  title text not null,
  assignee text,
  priority text default 'Medium',
  status text default 'To Do',
  due_date date,
  created_at timestamptz default now()
);
alter table public.tasks enable row level security;
create policy "Owner can manage tasks" on public.tasks
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );
