// ============================================================================
// Resource folders / sections (migration 019) — knowledge-drive helpers.
// Kept separate from dbPlatformV2.ts (which owns the flat `resources` table)
// so parallel agents don't collide. Reuses the `resources` bucket + rows,
// adding a nullable `folder_id` grouping layer on top.
// ============================================================================

import { supabase } from './supabase'
import type { ResourceKind, WorkspaceId } from '../types'

// ── Section types (the folder "kinds" a user can create) ──
export const SECTION_TYPES = [
  'Playbook',
  'SOP',
  'Template',
  'Meeting notes',
  'Marketing material',
  'Brand asset',
  'Reference',
  'Schedule',
  'Directory',
  'Report',
] as const

export type SectionType = (typeof SECTION_TYPES)[number]

// ── Local types (kept in this file — not in the shared src/types) ──

export interface ResourceFolder {
  id: string
  workspaceId: string
  name: string
  sectionType: string
  pinned: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** Lightweight file row shown as a preview inside a folder card. */
export interface FolderFilePreview {
  id: string
  title: string
  kind: ResourceKind
}

/** Folder decorated with the aggregate stats the grid/list views render. */
export interface FolderWithStats extends ResourceFolder {
  fileCount: number
  /** Most recent of the folder's own updatedAt and its newest file's createdAt. */
  lastUpdated: string
  /** Newest-first preview of the folder's files (capped) for card bodies. */
  filePreview: FolderFilePreview[]
}

/** How many files a card renders inline before collapsing to a "+N more" row. */
export const FOLDER_PREVIEW_LIMIT = 5

/** A file/link row belonging to a folder (subset of the resources columns). */
export interface FolderFile {
  id: string
  folderId: string | null
  kind: ResourceKind
  title: string
  description: string | null
  storagePath: string | null
  externalUrl: string | null
  mimeType: string | null
  sizeBytes: number | null
  createdAt: string
}

interface FolderRow {
  id: string
  workspace_id: string
  name: string
  section_type: string
  pinned: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

function mapFolder(r: FolderRow): ResourceFolder {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    sectionType: r.section_type,
    pinned: r.pinned,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

interface FileRow {
  id: string
  folder_id: string | null
  kind: ResourceKind
  title: string
  description: string | null
  storage_path: string | null
  external_url: string | null
  mime_type: string | null
  size_bytes: number | null
  created_at: string
}

function mapFile(r: FileRow): FolderFile {
  return {
    id: r.id,
    folderId: r.folder_id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    storagePath: r.storage_path,
    externalUrl: r.external_url,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
  }
}

const FILE_COLS = 'id, folder_id, kind, title, description, storage_path, external_url, mime_type, size_bytes, created_at'

// ── Reads ──

/**
 * Fetch all folders in a workspace with a fileCount + lastUpdated stat.
 * Computed client-side from a single pass over the workspace's resources so we
 * avoid a per-folder round-trip.
 */
export async function fetchFolders(workspaceId: WorkspaceId): Promise<FolderWithStats[]> {
  const [foldersRes, filesRes] = await Promise.all([
    supabase
      .from('resource_folders')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false }),
    supabase
      .from('resources')
      .select('folder_id, created_at, id, title, kind')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
  ])
  if (foldersRes.error) throw new Error(foldersRes.error.message)

  const files = (filesRes.data ?? []) as Array<{
    folder_id: string | null
    created_at: string
    id: string
    title: string
    kind: ResourceKind
  }>
  const stats = new Map<string, { count: number; last: string | null; preview: FolderFilePreview[] }>()
  for (const f of files) {
    if (!f.folder_id) continue
    const b = stats.get(f.folder_id) ?? { count: 0, last: null, preview: [] }
    b.count += 1
    if (!b.last || f.created_at > b.last) b.last = f.created_at
    // files arrive newest-first, so the first rows collected are the freshest
    if (b.preview.length < FOLDER_PREVIEW_LIMIT) b.preview.push({ id: f.id, title: f.title, kind: f.kind })
    stats.set(f.folder_id, b)
  }

  return (foldersRes.data as FolderRow[]).map(mapFolder).map((folder) => {
    const b = stats.get(folder.id)
    const lastUpdated =
      b?.last && b.last > folder.updatedAt ? b.last : folder.updatedAt
    return { ...folder, fileCount: b?.count ?? 0, lastUpdated, filePreview: b?.preview ?? [] }
  })
}

/** Count of resources that have no folder — surfaced as an "Unfiled" pseudo-folder. */
export async function fetchUnfiledCount(
  workspaceId: WorkspaceId,
): Promise<{ count: number; lastUpdated: string | null; filePreview: FolderFilePreview[] }> {
  const res = await supabase
    .from('resources')
    .select('created_at, id, title, kind')
    .eq('workspace_id', workspaceId)
    .is('folder_id', null)
    .order('created_at', { ascending: false })
  if (res.error) throw new Error(res.error.message)
  const rows = (res.data ?? []) as Array<{ created_at: string; id: string; title: string; kind: ResourceKind }>
  let last: string | null = null
  const preview: FolderFilePreview[] = []
  for (const r of rows) {
    if (!last || r.created_at > last) last = r.created_at
    if (preview.length < FOLDER_PREVIEW_LIMIT) preview.push({ id: r.id, title: r.title, kind: r.kind })
  }
  return { count: rows.length, lastUpdated: last, filePreview: preview }
}

/** Files inside a folder. Pass `null` to fetch the Unfiled bucket. */
export async function fetchFolderFiles(workspaceId: WorkspaceId, folderId: string | null): Promise<FolderFile[]> {
  let q = supabase
    .from('resources')
    .select(FILE_COLS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  q = folderId === null ? q.is('folder_id', null) : q.eq('folder_id', folderId)
  const res = await q
  if (res.error) throw new Error(res.error.message)
  return (res.data as FileRow[]).map(mapFile)
}

// ── Writes ──

export interface NewFolderInput {
  workspaceId: WorkspaceId
  name: string
  sectionType: string
  createdBy?: string | null
}

export async function createFolder(input: NewFolderInput): Promise<ResourceFolder> {
  const row = {
    workspace_id: input.workspaceId,
    name: input.name,
    section_type: input.sectionType,
    created_by: input.createdBy ?? null,
  }
  const res = await supabase.from('resource_folders').insert(row).select('*').single()
  if (res.error || !res.data) throw new Error(res.error?.message ?? 'Failed to create section.')
  return mapFolder(res.data as FolderRow)
}

/** Deletes the folder. Its resources' folder_id is set null by the FK (become Unfiled). */
export async function deleteFolder(id: string): Promise<void> {
  const { error } = await supabase.from('resource_folders').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function togglePinFolder(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase
    .from('resource_folders')
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** Bump a folder's updated_at (called after importing a file into it). */
export async function touchFolder(id: string): Promise<void> {
  const { error } = await supabase
    .from('resource_folders')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export interface NewFolderResourceInput {
  workspaceId: WorkspaceId
  folderId: string | null
  kind: ResourceKind
  title: string
  description?: string | null
  storagePath?: string | null
  externalUrl?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  createdBy?: string | null
}

/**
 * Insert a resource row already tagged with a folder_id. Mirrors
 * dbPlatformV2.insertResource but carries the folder link (that helper can't be
 * edited). Reuse uploadResourceFile from dbPlatformV2 for the storage upload.
 */
export async function insertFolderResource(input: NewFolderResourceInput): Promise<FolderFile> {
  const row = {
    workspace_id: input.workspaceId,
    folder_id: input.folderId,
    kind: input.kind,
    title: input.title,
    description: input.description ?? null,
    storage_path: input.storagePath ?? null,
    external_url: input.externalUrl ?? null,
    mime_type: input.mimeType ?? null,
    size_bytes: input.sizeBytes ?? null,
    visibility: 'team',
    created_by: input.createdBy ?? null,
  }
  const res = await supabase.from('resources').insert(row).select(FILE_COLS).single()
  if (res.error || !res.data) throw new Error(res.error?.message ?? 'Failed to add resource.')
  if (input.folderId) await touchFolder(input.folderId)
  return mapFile(res.data as FileRow)
}
