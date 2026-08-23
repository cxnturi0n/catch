// ============================================================================
// Resource folders / sections (migration 019), knowledge-drive helpers.
// Kept separate from dbPlatformV2.ts (which owns the flat `resources` table)
// so parallel agents don't collide. Reuses the `resources` bucket + rows,
// adding a nullable `folder_id` grouping layer on top.
// ============================================================================

import type { ResourceKind } from '../types'

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

// ── Local types (kept in this file, not in the shared src/types) ──

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






// ── Reads ──

/**
 * Fetch all folders in a workspace with a fileCount + lastUpdated stat.
 * Computed client-side from a single pass over the workspace's resources so we
 * avoid a per-folder round-trip.
 */
/** Count of resources that have no folder, surfaced as an "Unfiled" pseudo-folder. */

/** Files inside a folder. Pass `null` to fetch the Unfiled bucket. */
// ── Writes ──


/** Deletes the folder. Its resources' folder_id is set null by the FK (become Unfiled). */
/** Bump a folder's updated_at (called after importing a file into it). */

/**
 * Insert a resource row already tagged with a folder_id. Mirrors
 * dbPlatformV2.insertResource but carries the folder link (that helper can't be
 * edited). Reuse uploadResourceFile from dbPlatformV2 for the storage upload.
 */

// Data access now lives behind the Catch API.
export {
  fetchFolders,
  fetchUnfiledCount,
  fetchFolderFiles,
  createFolder,
  deleteFolder,
  togglePinFolder,
  insertFolderResource,
  type NewFolderInput,
  type NewFolderResourceInput,
} from './api/resources'
