-- ============================================================================
-- 019 · Resource folders / sections (knowledge drive)
-- ----------------------------------------------------------------------------
-- Turns the flat Resources module into a folder/section system. A folder is a
-- typed section (Playbook, SOP, Template, …) that groups `resources` rows.
-- Existing resources keep working: `folder_id` is nullable, so rows with a null
-- folder surface under an "Unfiled" pseudo-folder in the UI.
--
-- Run in Supabase SQL editor. Safe to re-run (idempotent guards).
-- ============================================================================

-- ── 1. Folders table ──────────────────────────────────────────────────────
create table if not exists public.resource_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  section_type text not null,   -- Playbook | SOP | Template | Meeting notes | Marketing material | Brand asset | Reference | Schedule | Directory | Report
  pinned boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_resource_folders_workspace on public.resource_folders (workspace_id, updated_at desc);

-- ── 2. Link resources to a folder (nullable → existing rows stay reachable) ─
alter table public.resources
  add column if not exists folder_id uuid references public.resource_folders(id) on delete set null;
create index if not exists idx_resources_folder on public.resources (folder_id);

-- ── 3. RLS (mirror the owner-based workspace pattern used project-wide) ─────
alter table public.resource_folders enable row level security;

drop policy if exists "resource_folders_owner_all" on public.resource_folders;
create policy "resource_folders_owner_all" on public.resource_folders
  for all
  using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  )
  with check (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

-- ── 4. Grants (align with 005_grants pattern) ──────────────────────────────
grant all privileges on public.resource_folders to anon, authenticated, service_role;
