import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { resourceFolders, resources, resourceViews } from '../../db/schema/index.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { downloadUrl, sanitizeFilename, storage } from '../../lib/storage/index.js'

// Resources drive: folders ("sections"), files stored through lib/storage and
// external links, plus a view log. Files never leave the server except through
// signed, expiring download links.

const params = z.object({ workspaceId: z.uuid() })
const idParams = params.extend({ id: z.uuid() })
const PREVIEW_LIMIT = 5

const folderBody = z.object({ name: z.string().trim().min(1).max(120), sectionType: z.string().trim().min(1).max(60) })
const linkBody = z.object({
  folderId: z.uuid().nullable().default(null),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  externalUrl: z.url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links'),
  visibility: z.enum(['team', 'private']).default('team'),
})

// Executables and scripts are refused regardless of the declared type.
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|sh|js|jar|vbs|dll|apk|app|deb|rpm)$/i

type FileRow = typeof resources.$inferSelect
const fileOut = (r: FileRow) => ({
  id: r.id,
  folderId: r.folderId,
  kind: r.kind,
  title: r.title,
  description: r.description,
  hasFile: r.storagePath !== null,
  externalUrl: r.externalUrl,
  mimeType: r.mimeType,
  sizeBytes: r.sizeBytes,
  visibility: r.visibility,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

async function assertFolder(workspaceId: string, folderId: string | null) {
  if (!folderId) return
  const [f] = await db.select({ id: resourceFolders.id }).from(resourceFolders).where(and(eq(resourceFolders.workspaceId, workspaceId), eq(resourceFolders.id, folderId))).limit(1)
  if (!f) throw badRequest('Unknown folder for this workspace', 'FOLDER_NOT_FOUND')
}

async function touchFolder(folderId: string | null) {
  if (folderId) await db.update(resourceFolders).set({ updatedAt: new Date() }).where(eq(resourceFolders.id, folderId))
}

export async function resourceRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()
  const member = app.requireWorkspace
  const base = '/workspaces/:workspaceId/resources'

  // Folders with aggregate stats + the "unfiled" bucket, in one round trip.
  r.get(`${base}/folders`, { preHandler: member, schema: { params } }, async (req) => {
    const [folders, files] = await Promise.all([
      db.select().from(resourceFolders).where(eq(resourceFolders.workspaceId, req.workspace.id)).orderBy(desc(resourceFolders.updatedAt)),
      db
        .select({ id: resources.id, folderId: resources.folderId, title: resources.title, kind: resources.kind, createdAt: resources.createdAt })
        .from(resources)
        .where(eq(resources.workspaceId, req.workspace.id))
        .orderBy(desc(resources.createdAt)),
    ])
    type Bucket = { count: number; last: Date | null; preview: Array<{ id: string; title: string; kind: string }> }
    const stats = new Map<string | null, Bucket>()
    for (const f of files) {
      const b = stats.get(f.folderId) ?? { count: 0, last: null, preview: [] }
      b.count += 1
      if (!b.last || f.createdAt > b.last) b.last = f.createdAt
      if (b.preview.length < PREVIEW_LIMIT) b.preview.push({ id: f.id, title: f.title, kind: f.kind })
      stats.set(f.folderId, b)
    }
    const unfiled = stats.get(null)
    return {
      folders: folders.map((f) => {
        const b = stats.get(f.id)
        return { ...f, fileCount: b?.count ?? 0, lastUpdated: b?.last && b.last > f.updatedAt ? b.last : f.updatedAt, filePreview: b?.preview ?? [] }
      }),
      unfiled: { count: unfiled?.count ?? 0, lastUpdated: unfiled?.last ?? null, filePreview: unfiled?.preview ?? [] },
    }
  })

  r.post(`${base}/folders`, { preHandler: member, schema: { params, body: folderBody } }, async (req, reply) => {
    const [f] = await db.insert(resourceFolders).values({ workspaceId: req.workspace.id, createdBy: req.auth!.user.id, ...req.body }).returning()
    return reply.status(201).send({ folder: f })
  })

  r.patch(`${base}/folders/:id`, { preHandler: member, schema: { params: idParams, body: folderBody.partial().extend({ pinned: z.boolean().optional() }) } }, async (req) => {
    const [f] = await db.update(resourceFolders).set(req.body).where(and(eq(resourceFolders.workspaceId, req.workspace.id), eq(resourceFolders.id, req.params.id))).returning()
    if (!f) throw notFound('Folder')
    return { folder: f }
  })

  // Deleting a folder keeps its files (they become unfiled), like the legacy behaviour.
  r.delete(`${base}/folders/:id`, { preHandler: member, schema: { params: idParams } }, async (req, reply) => {
    const d = await db.delete(resourceFolders).where(and(eq(resourceFolders.workspaceId, req.workspace.id), eq(resourceFolders.id, req.params.id))).returning({ id: resourceFolders.id })
    if (d.length === 0) throw notFound('Folder')
    return reply.status(204).send()
  })

  // Files and links. folderId=null → unfiled; omitted → all.
  r.get(`${base}`, { preHandler: member, schema: { params, querystring: z.object({ folderId: z.union([z.uuid(), z.literal('null')]).optional() }) } }, async (req) => {
    const where = [eq(resources.workspaceId, req.workspace.id)]
    if (req.query.folderId === 'null') where.push(isNull(resources.folderId))
    else if (req.query.folderId) where.push(eq(resources.folderId, req.query.folderId))
    const rows = await db.select().from(resources).where(and(...where)).orderBy(desc(resources.createdAt))
    return { resources: rows.map(fileOut) }
  })

  // Aggregate view stats for the whole drive.
  r.get(`${base}/stats`, { preHandler: member, schema: { params } }, async (req) => {
    const rows = await db
      .select({
        resourceId: resourceViews.resourceId,
        viewCount: sql<number>`count(*)::int`,
        lastViewedAt: sql<Date>`max(${resourceViews.viewedAt})`,
        uniqueViewers: sql<number>`count(distinct coalesce(${resourceViews.viewerModeratorId}::text, ${resourceViews.viewerUserId}::text, ${resourceViews.viewerLabel}, 'anon'))::int`,
      })
      .from(resourceViews)
      .where(eq(resourceViews.workspaceId, req.workspace.id))
      .groupBy(resourceViews.resourceId)
    return { stats: rows }
  })

  r.post(`${base}/links`, { preHandler: member, schema: { params, body: linkBody } }, async (req, reply) => {
    await assertFolder(req.workspace.id, req.body.folderId)
    const [row] = await db
      .insert(resources)
      .values({ workspaceId: req.workspace.id, createdBy: req.auth!.user.id, kind: 'external_link', ...req.body })
      .returning()
    await touchFolder(req.body.folderId)
    return reply.status(201).send({ resource: fileOut(row!) })
  })

  // Multipart: fields folderId?, title, description?; file part "file".
  r.post(`${base}/upload`, { preHandler: member, schema: { params } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } })
    if (!file) throw badRequest('A file is required', 'FILE_REQUIRED')
    const field = (name: string) => (file.fields[name] as { value?: string } | undefined)?.value?.trim() || undefined
    const parsed = z
      .object({ folderId: z.uuid().optional(), title: z.string().min(1).max(200).optional(), description: z.string().max(2000).optional() })
      .safeParse({ folderId: field('folderId'), title: field('title'), description: field('description') })
    if (!parsed.success) throw badRequest('Invalid upload fields', 'VALIDATION_ERROR')
    const { folderId = null, title, description } = parsed.data
    await assertFolder(req.workspace.id, folderId)
    if (BLOCKED_EXT.test(file.filename)) throw badRequest('This file type is not allowed', 'FILE_TYPE')
    const data = await file.toBuffer()
    if (file.file.truncated) throw badRequest(`File exceeds ${Math.round(config.MAX_UPLOAD_BYTES / 1024 / 1024)} MB`, 'FILE_TOO_LARGE')
    const key = `${req.workspace.id}/resources/${Date.now()}_${sanitizeFilename(file.filename)}`
    const mimeType = file.mimetype || 'application/octet-stream'
    await storage.put(key, data, mimeType)
    const [row] = await db
      .insert(resources)
      .values({
        workspaceId: req.workspace.id,
        createdBy: req.auth!.user.id,
        folderId,
        kind: 'file',
        title: title ?? file.filename,
        description: description ?? null,
        storagePath: key,
        mimeType,
        sizeBytes: data.length,
      })
      .returning()
    await touchFolder(folderId)
    return reply.status(201).send({ resource: fileOut(row!) })
  })

  r.get(`${base}/:id/url`, { preHandler: member, schema: { params: idParams } }, async (req) => {
    const [row] = await db.select().from(resources).where(and(eq(resources.workspaceId, req.workspace.id), eq(resources.id, req.params.id))).limit(1)
    if (!row) throw notFound('Resource')
    if (row.kind === 'external_link') return { url: row.externalUrl, expiresIn: null }
    if (!row.storagePath) throw notFound('File')
    return { url: downloadUrl(row.storagePath), expiresIn: 300 }
  })

  r.post(`${base}/:id/view`, { preHandler: member, schema: { params: idParams, body: z.object({ viewerModeratorId: z.uuid().nullish(), viewerLabel: z.string().trim().max(120).nullish() }).default({}) } }, async (req, reply) => {
    const [row] = await db.select({ id: resources.id }).from(resources).where(and(eq(resources.workspaceId, req.workspace.id), eq(resources.id, req.params.id))).limit(1)
    if (!row) throw notFound('Resource')
    await db.insert(resourceViews).values({
      workspaceId: req.workspace.id,
      resourceId: row.id,
      viewerUserId: req.auth!.user.id,
      viewerModeratorId: req.body.viewerModeratorId ?? null,
      viewerLabel: req.body.viewerLabel ?? null,
    })
    return reply.status(204).send()
  })

  r.delete(`${base}/:id`, { preHandler: member, schema: { params: idParams } }, async (req, reply) => {
    const [row] = await db.delete(resources).where(and(eq(resources.workspaceId, req.workspace.id), eq(resources.id, req.params.id))).returning()
    if (!row) throw notFound('Resource')
    if (row.storagePath) await storage.delete(row.storagePath).catch(() => undefined)
    return reply.status(204).send()
  })
}
