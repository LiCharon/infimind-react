import dotenv from 'dotenv'
import { createHash } from 'crypto'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../../.env.local') })

const VECTOR_URL = (process.env.RAG_VECTOR_URL || '').replace(/\/$/, '')
const VECTOR_COLLECTION = process.env.RAG_VECTOR_COLLECTION || 'contract_knowledge_evidence'
const VECTOR_API_KEY = process.env.RAG_VECTOR_API_KEY || ''
const EMBEDDING_URL = (process.env.RAG_EMBEDDING_URL || 'https://api.siliconflow.cn/v1/embeddings').replace(/\/$/, '')
const EMBEDDING_API_KEY = process.env.RAG_EMBEDDING_API_KEY || process.env.SILICONFLOW_API_KEY || ''
const EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || 'BAAI/bge-m3'

export function getVectorStatus() {
  const embeddingConfigured = Boolean(EMBEDDING_URL && EMBEDDING_MODEL && EMBEDDING_API_KEY)
  const vectorConfigured = Boolean(VECTOR_URL)
  return {
    enabled: embeddingConfigured && vectorConfigured,
    vectorConfigured,
    embeddingConfigured,
    collection: VECTOR_COLLECTION,
    mode: embeddingConfigured && vectorConfigured ? 'hybrid-ready' : 'lexical-fallback'
  }
}

/** 在导入后同步条款和风险规则到 Qdrant；未配置服务时无副作用地跳过。 */
export async function syncVectorIndex(records, { rebuild = process.env.RAG_VECTOR_REBUILD_ON_IMPORT === 'true' } = {}) {
  if (!getVectorStatus().enabled) {
    console.log('[vector-store] Vector sync skipped: RAG_VECTOR_URL / SiliconFlow Embedding API key not fully configured')
    return { synced: 0, skipped: true }
  }
  const usable = records.filter((record) => record.content?.trim())
  if (!usable.length) return { synced: 0, skipped: false }
  const vectors = await embedTexts(usable.map(formatEmbeddingText))
  const dimension = vectors[0]?.length
  if (!dimension) throw new Error('Embedding provider returned an empty vector')
  if (rebuild) await deleteCollection().catch(() => {})
  await ensureCollection(dimension)

  const points = usable.map((record, index) => ({
    id: stablePointId(record.evidence_id),
    vector: vectors[index],
    payload: {
      evidenceId: record.evidence_id,
      kind: record.kind,
      contractType: record.contract_type,
      referenceRole: record.reference_role,
      pairKey: record.pair_key,
      sourcePath: record.source_path,
      sourceName: record.name,
      heading: `${record.clause_no || ''} ${record.title || ''}`.trim()
    }
  }))
  for (const batch of chunk(points, 64)) await vectorRequest(`/collections/${VECTOR_COLLECTION}/points?wait=true`, 'PUT', { points: batch })
  console.log(`[vector-store] Synced ${points.length} evidence vectors to ${VECTOR_COLLECTION}`)
  return { synced: points.length, skipped: false }
}

export async function searchVectorEvidence(topics, { limit = 24, contractType = '' } = {}) {
  if (!getVectorStatus().enabled) return []
  const outputs = []
  const vectors = await embedTexts(topics.map((topic) => `${topic.label}\n${topic.query}`))
  for (let index = 0; index < topics.length; index++) {
    const topic = topics[index]
    const body = {
      query: vectors[index],
      limit,
      with_payload: true,
      ...(contractType ? { filter: { must: [{ key: 'contractType', match: { value: contractType } }] } } : {})
    }
    const data = await vectorRequest(`/collections/${VECTOR_COLLECTION}/points/query`, 'POST', body)
    const points = data?.result?.points || data?.result || []
    for (const point of points) {
      const evidenceId = point?.payload?.evidenceId
      if (evidenceId) outputs.push({ evidenceId, topicId: topic.id, topicLabel: topic.label, score: Number(point.score) || 0 })
    }
  }
  return outputs.sort((a, b) => b.score - a.score)
}

async function embedTexts(texts) {
  const output = []
  for (const batch of chunk(texts, 32)) {
    const response = await fetch(EMBEDDING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EMBEDDING_API_KEY}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch })
    })
    if (!response.ok) throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`)
    const data = await response.json()
    const vectors = (data?.data || []).sort((a, b) => (a.index || 0) - (b.index || 0)).map((item) => item.embedding)
    if (vectors.length !== batch.length || vectors.some((vector) => !Array.isArray(vector))) throw new Error('Embedding response format is invalid')
    output.push(...vectors)
  }
  return output
}

async function ensureCollection(size) {
  const existing = await fetch(`${VECTOR_URL}/collections/${VECTOR_COLLECTION}`, { headers: vectorHeaders() })
  if (existing.ok) return
  await vectorRequest(`/collections/${VECTOR_COLLECTION}`, 'PUT', { vectors: { size, distance: 'Cosine' } })
}

async function deleteCollection() {
  const response = await fetch(`${VECTOR_URL}/collections/${VECTOR_COLLECTION}`, { method: 'DELETE', headers: vectorHeaders() })
  if (!response.ok && response.status !== 404) throw new Error(`Unable to reset vector collection: ${response.status}`)
}

async function vectorRequest(path, method, body) {
  const response = await fetch(`${VECTOR_URL}${path}`, { method, headers: vectorHeaders(), body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Qdrant request failed: ${response.status} ${await response.text()}`)
  return response.json()
}

function vectorHeaders() {
  return { 'Content-Type': 'application/json', ...(VECTOR_API_KEY ? { 'api-key': VECTOR_API_KEY } : {}) }
}

function formatEmbeddingText(record) {
  return [record.contract_type, record.reference_role, record.name, record.clause_no, record.title, record.parent_title, record.content].filter(Boolean).join('\n')
}

function stablePointId(value) {
  const hex = createHash('sha1').update(String(value)).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size))
}
