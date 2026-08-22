import { api, API_URL } from './client'
import type { Resource, ResourceKind, ResourceWithStats, WorkspaceId } from '../../types'
import type { FolderFile, FolderFilePreview, FolderWithStats, ResourceFolder } from '../resourceFolders'

interface ApiResource {
  id: string
  folderId: string | null
  kind: ResourceKind
  title: string
  description: string | null
  hasFile: boolean
  externalUrl: string | null
  mimeType: string | null
  sizeBytes: number | null
  visibility: Resource['visibility']
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

// `storagePath` used to be the Supabase object key; the API never exposes
// the key, so the resource id stands in for "has a downloadable file".
const toFolderFile = (r: ApiResource): FolderFile => ({
  id: r.id,
  folderId: r.folderId,
  kind: r.kind,
  title: r.title,
  description: r.description,
  storagePath: r.hasFile ? r.id : null,
  externalUrl: r.externalUrl,
  mimeType: r.mimeType,
  sizeBytes: r.sizeBytes,
  createdAt: r.createdAt,
})

const toResource = (r: ApiResource, workspaceId: string): Resource => ({
  id: r.id,
  workspaceId,
  kind: r.kind,
  title: r.title,
  description: r.description,
  storagePath: r.hasFile ? r.id : null,
  externalUrl: r.externalUrl,
  mimeType: r.mimeType,
  sizeBytes: r.sizeBytes,
  visibility: r.visibility,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

const base = (ws: WorkspaceId) => `/workspaces/${ws}/resources`

interface FoldersResponse {
  folders: Array<ResourceFolder & { fileCount: number; lastUpdated: string; filePreview: FolderFilePreview[] }>
  unfiled: { count: number; lastUpdated: string | null; filePreview: FolderFilePreview[] }
}

let lastFolders: { ws: string; data: FoldersResponse } | null = null

export async function fetchFolders(workspaceId: WorkspaceId): Promise<FolderWithStats[]> {
  const data = await api<FoldersResponse>(`${base(workspaceId)}/folders`)
  lastFolders = { ws: workspaceId, data }
  return data.folders
}

// The folders call already carries the unfiled bucket; callers that request
// both in parallel get a single network round trip.
export async function fetchUnfiledCount(workspaceId: WorkspaceId): Promise<FoldersResponse['unfiled']> {
  if (lastFolders?.ws === workspaceId) return lastFolders.data.unfiled
  const data = await api<FoldersResponse>(`${base(workspaceId)}/folders`)
  lastFolders = { ws: workspaceId, data }
  return data.unfiled
}

export async function fetchFolderFiles(workspaceId: WorkspaceId, folderId: string | null): Promise<FolderFile[]> {
  const r = await api<{ resources: ApiResource[] }>(`${base(workspaceId)}?folderId=${folderId ?? 'null'}`)
  return r.resources.map(toFolderFile)
}

export interface NewFolderInput {
  workspaceId: WorkspaceId
  name: string
  sectionType: string
  createdBy?: string | null
}

export async function createFolder(input: NewFolderInput): Promise<ResourceFolder> {
  const { workspaceId, createdBy: _ignored, ...body } = input
  return (await api<{ folder: ResourceFolder }>(`${base(workspaceId)}/folders`, { method: 'POST', body })).folder
}

export async function deleteFolder(workspaceId: WorkspaceId, id: string): Promise<void> {
  await api(`${base(workspaceId)}/folders/${id}`, { method: 'DELETE' })
}

export async function togglePinFolder(workspaceId: WorkspaceId, id: string, pinned: boolean): Promise<void> {
  await api(`${base(workspaceId)}/folders/${id}`, { method: 'PATCH', body: { pinned } })
}

export interface NewFolderResourceInput {
  workspaceId: WorkspaceId
  folderId: string | null
  kind: ResourceKind
  title: string
  description?: string | null
  externalUrl?: string | null
  createdBy?: string | null
  /** For kind 'file': the browser File to upload. */
  file?: File
}

// Links are a JSON call; files go as multipart and the server creates the
// resource row in the same request (no orphan objects on failure).
export async function insertFolderResource(input: NewFolderResourceInput): Promise<FolderFile> {
  if (input.kind === 'external_link') {
    const r = await api<{ resource: ApiResource }>(`${base(input.workspaceId)}/links`, {
      method: 'POST',
      body: { folderId: input.folderId, title: input.title, description: input.description ?? null, externalUrl: input.externalUrl },
    })
    return toFolderFile(r.resource)
  }
  if (!input.file) throw new Error('A file is required.')
  const form = new FormData()
  if (input.folderId) form.append('folderId', input.folderId)
  form.append('title', input.title)
  if (input.description) form.append('description', input.description)
  form.append('file', input.file, input.file.name)
  const res = await fetch(`${API_URL}${base(input.workspaceId)}/upload`, { method: 'POST', credentials: 'include', body: form })
  const data = (await res.json().catch(() => null)) as { resource?: ApiResource; error?: { message?: string } } | null
  if (!res.ok || !data?.resource) throw new Error(data?.error?.message ?? 'Upload failed.')
  return toFolderFile(data.resource)
}

export async function deleteResource(workspaceId: WorkspaceId, id: string): Promise<void> {
  await api(`${base(workspaceId)}/${id}`, { method: 'DELETE' })
}

export async function getResourceSignedUrl(workspaceId: WorkspaceId, resourceId: string): Promise<string> {
  const r = await api<{ url: string | null }>(`${base(workspaceId)}/${resourceId}/url`)
  if (!r.url) throw new Error('No URL available for this resource.')
  return r.url
}

export async function logResourceView(input: { resourceId: string; workspaceId: WorkspaceId; viewerModeratorId?: string | null; viewerLabel?: string | null }): Promise<void> {
  await api(`${base(input.workspaceId)}/${input.resourceId}/view`, { method: 'POST', body: { viewerModeratorId: input.viewerModeratorId ?? null, viewerLabel: input.viewerLabel ?? null } })
}

export async function fetchResources(workspaceId: WorkspaceId): Promise<Resource[]> {
  const r = await api<{ resources: ApiResource[] }>(base(workspaceId))
  return r.resources.map((x) => toResource(x, workspaceId))
}

export async function fetchResourcesWithStats(workspaceId: WorkspaceId): Promise<ResourceWithStats[]> {
  const [list, stats] = await Promise.all([
    fetchResources(workspaceId),
    api<{ stats: Array<{ resourceId: string; viewCount: number; lastViewedAt: string | null; uniqueViewers: number }> }>(`${base(workspaceId)}/stats`),
  ])
  const by = new Map(stats.stats.map((s) => [s.resourceId, s]))
  return list.map((r) => {
    const s = by.get(r.id)
    return { ...r, viewCount: s?.viewCount ?? 0, lastViewedAt: s?.lastViewedAt ?? null, uniqueViewers: s?.uniqueViewers ?? 0 }
  })
}
