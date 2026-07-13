import Database from 'better-sqlite3'
import { readFile, readdir, access } from 'fs/promises'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DB_PATH = join(__dirname, '..', 'knowledge-base', 'templates.db')
const DEFAULT_TEMPLATES_DIR = join(__dirname, '..', 'knowledge-base', 'templates')
const DEFAULT_INDEX_PATH = join(__dirname, '..', 'knowledge-base', 'index.json')

let db = null

/**
 * 初始化知识库：创建数据库和表结构
 * @param {string} dbPath
 * @returns {import('better-sqlite3').Database}
 */
export function initialize(dbPath = DEFAULT_DB_PATH) {
  if (db) return db

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contract_type TEXT DEFAULT '',
      industry TEXT DEFAULT '',
      description TEXT DEFAULT '',
      reference_role TEXT DEFAULT 'reference',
      review_notes TEXT DEFAULT '',
      source_file TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS templates_fts USING fts5(
      name, contract_type, industry, description, content,
      tokenize='unicode61'
    );
  `)

  // 兼容已创建的本地知识库。新增字段用于区分优秀模板与已批注的反例，
  // 让检索结果在审查提示词中拥有明确的使用方式。
  const columns = db.prepare('PRAGMA table_info(templates)').all().map((column) => column.name)
  if (!columns.includes('reference_role')) {
    db.exec("ALTER TABLE templates ADD COLUMN reference_role TEXT DEFAULT 'reference'")
  }
  if (!columns.includes('review_notes')) {
    db.exec("ALTER TABLE templates ADD COLUMN review_notes TEXT DEFAULT ''")
  }

  console.log('[knowledge-base] Database initialized')
  return db
}

/**
 * 从 index.json 和 templates/ 目录加载模版数据
 */
export async function loadTemplates(opts = {}) {
  const {
    templatesDir = DEFAULT_TEMPLATES_DIR,
    indexPath = DEFAULT_INDEX_PATH,
    dbPath = DEFAULT_DB_PATH
  } = opts

  const database = initialize(dbPath)

  // 检查是否已加载过
  const count = database.prepare('SELECT COUNT(*) as count FROM templates').get()
  if (count.count > 0) {
    console.log(`[knowledge-base] ${count.count} templates already loaded, skipping`)
    return count.count
  }

  // 读取元数据索引
  let indexData = []
  try {
    const raw = await readFile(indexPath, 'utf-8')
    indexData = JSON.parse(raw)
    console.log(`[knowledge-base] Loaded index with ${indexData.length} entries`)
  } catch {
    console.warn('[knowledge-base] No index.json found, creating empty index')
  }

  const insertTemplate = database.prepare(`
    INSERT INTO templates (name, contract_type, industry, description, reference_role, review_notes, source_file)
    VALUES (@name, @contract_type, @industry, @description, @reference_role, @review_notes, @source_file)
  `)

  const insertFts = database.prepare(`
    INSERT INTO templates_fts (rowid, name, contract_type, industry, description, content)
    VALUES (@rowid, @name, @contract_type, @industry, @description, @content)
  `)

  // 在事务外先读取所有模版文本文件
  const templateContents = []
  for (const item of indexData) {
    const info = database.prepare(
      'SELECT id FROM templates WHERE name = ? AND source_file = ?'
    ).get(item.name, item.source_file || '')

    if (info) continue

    let content = ''
    const txtPath = join(templatesDir, item.text_file || `${item.name}.txt`)
    try {
      content = await readFile(txtPath, 'utf-8')
    } catch {
      const altPath = join(templatesDir, item.name + '.txt')
      try {
        content = await readFile(altPath, 'utf-8')
      } catch {
        console.warn(`[knowledge-base] No text file found for: ${item.name}`)
        content = item.description || item.name
      }
    }

    templateContents.push({ item, content })
  }

  // 在同步事务中批量写入
  const imported = database.transaction((entries) => {
    let count = 0
    for (const { item, content } of entries) {
      const result = insertTemplate.run({
        name: item.name,
        contract_type: item.contract_type || '买卖合同',
        industry: item.industry || '',
        description: item.description || '',
        reference_role: item.reference_role || item.knowledge_role || 'reference',
        review_notes: item.review_notes || item.annotation_summary || '',
        source_file: item.source_file || ''
      })

      insertFts.run({
        rowid: result.lastInsertRowid,
        name: item.name,
        contract_type: item.contract_type || '',
        industry: item.industry || '',
        description: item.description || '',
        content
      })

      count++
    }
    return count
  })(templateContents)
  console.log(`[knowledge-base] Imported ${imported} templates`)
  return imported
}

/**
 * 搜索知识库
 * @param {string} query - 搜索关键词
 * @param {object} options
 * @returns {Array<{id: number, name: string, contract_type: string, content: string}>}
 */
export function search(query, options = {}) {
  if (!db) initialize()

  const { limit = 5 } = options

  if (!query || !query.trim()) {
    // 无关键词时返回最新模版
    return db.prepare(`
      SELECT t.id, t.name, t.contract_type, t.industry, t.description, t.reference_role, t.review_notes,
             COALESCE((SELECT content FROM templates_fts WHERE rowid = t.id), '') as content
      FROM templates t
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(limit)
  }

  // FTS5 全文搜索
  // 将查询中的中文/英文关键词用 OR 连接以提高召回率
  const ftsQuery = buildFtsQuery(query)

  try {
    const results = db.prepare(`
      SELECT t.id, t.name, t.contract_type, t.industry, t.description, t.reference_role, t.review_notes,
             templates_fts.content,
             rank
      FROM templates_fts
      JOIN templates t ON templates_fts.rowid = t.id
      WHERE templates_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit)

    return results
  } catch (error) {
    // FTS5 查询语法错误时回退到 LIKE 搜索
    console.warn(`[knowledge-base] FTS5 query failed, falling back to LIKE: ${error.message}`)
    const likePattern = `%${query.replace(/[%_]/g, '\\$&')}%`

    return db.prepare(`
      SELECT t.id, t.name, t.contract_type, t.industry, t.description, t.reference_role, t.review_notes,
             COALESCE((SELECT content FROM templates_fts WHERE rowid = t.id), '') as content
      FROM templates t
      WHERE t.name LIKE ? OR t.description LIKE ? OR t.contract_type LIKE ?
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(likePattern, likePattern, likePattern, limit)
  }
}

/**
 * 从分析报告中提取搜索关键词
 */
export function extractSearchKeywords(analysisReport) {
  if (!analysisReport) return ''

  // 提取报告中出现的合同要素关键词
  const keywords = [
    '买卖合同', '违约责任', '付款方式', '交付验收', '质量标准',
    '质保条款', '争议解决', '风险转移', '所有权', '保密条款',
    '知识产权', '不可抗力', '合同主体', '标的物', '价款支付'
  ]

  const found = keywords.filter((kw) => analysisReport.includes(kw))

  return found.length ? found.join(' OR ') : '买卖合同'
}

/**
 * 添加单个模版到知识库
 */
export function addTemplate({ name, contractType, industry, description, referenceRole, reviewNotes, sourceFile, content }) {
  if (!db) initialize()

  const transaction = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO templates (name, contract_type, industry, description, reference_role, review_notes, source_file)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, contractType || '', industry || '', description || '', referenceRole || 'reference', reviewNotes || '', sourceFile || '')

    const rowId = result.lastInsertRowid

    db.prepare(`
      INSERT INTO templates_fts (rowid, name, contract_type, industry, description, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(rowId, name, contractType || '', industry || '', description || '', content || '')

    return rowId
  })

  return transaction()
}

/**
 * 获取所有模版列表
 */
export function listTemplates() {
  if (!db) initialize()
  return db.prepare('SELECT id, name, contract_type, industry, description, reference_role, review_notes, source_file, created_at FROM templates ORDER BY created_at DESC').all()
}

/**
 * 关闭数据库连接
 */
export function close() {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * 构建 FTS5 查询表达式
 */
function buildFtsQuery(query) {
  return query
    .trim()
    .split(/\s*OR\s*|\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(' OR ')
}
