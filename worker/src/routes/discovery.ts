import type { ExplorePage, ExploreQuery, FavouriteLookupResponse, GalleryCategory } from '../../../shared/contracts'
import type { Env } from '../env'
import { publicMediaByIds } from '../gallery/media'
import { HttpError, json, parseJson, requireOrigin } from '../lib/http'
import { clientIp, rateLimit } from '../security/rateLimit'
import { publicCapabilities, readOperationalSettings } from '../settings'
import { getSemanticProvider } from '../ai/semantic/providerFactory'

export async function capabilitiesRoute(request: Request, env: Env) {
  return json(request, env, await publicCapabilities(env), 200, { 'Cache-Control': 'public, max-age=30' })
}

export async function categoriesRoute(request: Request, env: Env) {
  const result = await env.DB.prepare('SELECT id,slug,display_name FROM categories WHERE enabled=1 ORDER BY sort_order,id')
    .all<{ id: string; slug: string; display_name: string }>()
  const categories: GalleryCategory[] = result.results.map((row) => ({ id: row.id, slug: row.slug, displayName: row.display_name }))
  return json(request, env, categories, 200, { 'Cache-Control': 'public, max-age=300' })
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function favouriteLookupRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const payload = await parseJson<{ ids?: string[] }>(request)
  if (!Array.isArray(payload.ids) || payload.ids.length > 100 || payload.ids.some((id) => !validUuid(id))) {
    throw new HttpError(400, 'INVALID_MEDIA_IDS', 'Choose up to 100 valid memories.')
  }
  const uniqueIds = [...new Set(payload.ids)]
  const media = await publicMediaByIds(env, uniqueIds)
  const data: FavouriteLookupResponse = {
    items: uniqueIds.map((id) => media.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    missingIds: uniqueIds.filter((id) => !media.has(id)),
  }
  return json(request, env, data, 200, { 'Cache-Control': 'no-store' })
}

function validateExploreQuery(payload: ExploreQuery) {
  const query = payload.query?.trim()
  if (!query || query.length < 2 || query.length > 200) throw new HttpError(400, 'INVALID_SEARCH_QUERY', 'Enter a search between 2 and 200 characters.')
  if (payload.event && !['solemnisation','reception'].includes(payload.event)) throw new HttpError(400, 'INVALID_EVENT', 'Unknown search event.')
  if (payload.type && !['photo','video'].includes(payload.type)) throw new HttpError(400, 'INVALID_MEDIA_TYPE', 'Unknown media type.')
  if (payload.source && !['guest','photographer'].includes(payload.source)) throw new HttpError(400, 'INVALID_SOURCE', 'Unknown media source.')
  if (payload.category && !/^[a-z0-9-]{1,64}$/.test(payload.category)) throw new HttpError(400, 'INVALID_CATEGORY', 'Unknown category.')
  return query
}

async function currentSemanticVectors(env: Env, vectorIds: string[], provider: NonNullable<ReturnType<typeof getSemanticProvider>>) {
  const rows: Array<{ embedding_vector_id:string;media_id:string }> = []
  for (let offset=0;offset<vectorIds.length;offset+=80) {
    const chunk=vectorIds.slice(offset,offset+80)
    if (!chunk.length) continue
    const placeholders=chunk.map(()=>'?').join(',')
    const result=await env.DB.prepare(`SELECT embedding_vector_id,media_id FROM media_semantic_vectors
      WHERE deleted_at IS NULL AND embedding_provider=? AND embedding_model=? AND embedding_model_version=?
        AND embedding_dimensions=? AND distance_metric=? AND embedding_vector_id IN (${placeholders})`)
      .bind(provider.provider,provider.model,provider.modelVersion,provider.dimensions,provider.metric,...chunk)
      .all<{ embedding_vector_id:string;media_id:string }>()
    rows.push(...result.results)
  }
  return new Map(rows.map((row)=>[row.embedding_vector_id,row.media_id]))
}

export async function semanticSearchRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const payload = await parseJson<ExploreQuery>(request)
  const query = validateExploreQuery(payload)
  const settings = await readOperationalSettings(env)
  const provider = getSemanticProvider(env)
  if (settings.eventMode === 'archive' || !settings.aiEnabled || !settings.semanticSearchEnabled || !provider || !env.SEMANTIC_INDEX) {
    throw new HttpError(503, 'SEMANTIC_SEARCH_UNAVAILABLE', 'Natural-language memory search is unavailable. Category browsing still works.', true)
  }
  await Promise.all([
    rateLimit(env, `semantic-ip:${clientIp(request)}`, 'semantic_search', 30, 600),
    rateLimit(env, 'semantic-global', 'semantic_search_global', 500, 600),
  ])
  const embedding = await provider.embed(query)
  const vectorResult = await env.SEMANTIC_INDEX.query(embedding, { topK: 100, returnValues: false, returnMetadata: 'none' })
  embedding.fill(0)
  const currentVectors=await currentSemanticVectors(env,vectorResult.matches.map((match)=>match.id),provider)
  const scores = new Map<string, number>()
  for (const match of vectorResult.matches) {
    const mediaId = currentVectors.get(match.id)
    if (mediaId) scores.set(mediaId, Math.max(scores.get(mediaId) || -Infinity, match.score))
  }
  const rankedIds = [...scores.entries()].sort((left, right) => right[1] - left[1]).map(([id]) => id)
  const resolved = await publicMediaByIds(env, rankedIds, {
    event: payload.event,
    type: payload.type,
    source: payload.source,
    category: payload.category,
  })
  const limit = Math.min(50, Math.max(1, payload.limit || 30))
  const items = rankedIds.map((id) => {
    const item = resolved.get(id)
    return item ? { ...item, similarity: scores.get(id) } : null
  }).filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, limit)
  const page: ExplorePage = { items, nextCursor: null, semanticApplied: true, semanticAvailable: true }
  return json(request, env, page, 200, { 'Cache-Control': 'no-store' })
}
