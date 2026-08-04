import { readFile, writeFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, extname, basename } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import JSZip from 'jszip'

const execFileAsync = promisify(execFile)

/**
 * 主入口：从上传文件 Buffer 中提取文本
 * @param {{ buffer: Buffer, originalname: string, mimetype: string }} file
 * @returns {Promise<{ text: string, pageCount: number|null, metadata: object }>}
 */
export async function extractText(file) {
  const extension = extname(file.originalname || '').toLowerCase()
  const mimeType = file.mimetype || ''

  if (extension === '.pdf' || mimeType === 'application/pdf') {
    return extractPdfText(file)
  }

  if (extension === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      return await extractDocxText(file)
    } catch (error) {
      // .docx 解析失败时，检测是否为伪装的旧版 .doc 文件
      if (
        error.message.includes('end of central directory') ||
        error.message.includes('zip') ||
        isLegacyWord(file.buffer)
      ) {
        console.warn(`[file-parser] ${file.originalname} 可能是旧版 .doc 文件伪装为 .docx，尝试转换`)
        return extractLegacyDocText(file)
      }
      throw error
    }
  }

  if (extension === '.doc' || mimeType === 'application/msword' || isLegacyWord(file.buffer)) {
    return extractLegacyDocText(file)
  }

  if (isImage(extension, mimeType)) {
    return extractImageText(file)
  }

  throw new Error(`暂不支持的文件格式: ${extension || mimeType || '未知'}`)
}

/**
 * 提取 Word 原生批注与修订足迹，与合同正文分开处理。
 * 旧 .doc 先沿用正文解析的转换链路变为 .docx，再读取批注层。
 */
export async function extractWordAnnotations(file) {
  const extension = extname(file.originalname || '').toLowerCase()
  const mimeType = file.mimetype || ''
  const isDocx = extension === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const isDoc = extension === '.doc' || mimeType === 'application/msword' || isLegacyWord(file.buffer)
  if (!isDocx && !isDoc) return emptyWordAnnotations()

  try {
    // macOS textutil 转换 .doc 会丢弃 comments.xml；批注解析必须优先使用 LibreOffice。
    const docxBuffer = isDoc ? await convertLegacyDocToDocx(file, { preserveAnnotations: true }) : file.buffer
    return await parseDocxAnnotations(docxBuffer)
  } catch (error) {
    throw new Error(`Word 批注解析失败: ${error.message}`)
  }
}

/** 只移除被旧版 Word 转换器意外混入正文的完整批注行。 */
export function stripNativeCommentText(text, annotations = []) {
  const comments = new Set(annotations
    .map((annotation) => normalizeInlineText(annotation.text))
    .filter(Boolean))
  if (!comments.size) return String(text || '')
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => !comments.has(normalizeInlineText(line)))
    .join('\n')
}

/**
 * PDF 文本提取
 */
async function extractPdfText(file) {
  try {
    const pdfParse = (await import('pdf-parse')).default
    const data = await pdfParse(file.buffer)

    return {
      text: data.text || '',
      pageCount: data.numpages || null,
      metadata: {
        pages: data.numpages,
        info: data.info ? { title: data.info.Title, author: data.info.Author } : {}
      }
    }
  } catch (error) {
    throw new Error(`PDF 解析失败: ${error.message}`)
  }
}

/**
 * DOCX 文本提取
 */
async function extractDocxText(file) {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer: file.buffer })

    if (result.messages?.length) {
      const warnings = result.messages.filter((m) => m.type === 'warning')
      if (warnings.length) {
        console.warn(`[file-parser] DOCX warnings:`, warnings.map((m) => m.message).join('; '))
      }
    }

    return {
      text: result.value || '',
      pageCount: null,
      metadata: { format: 'docx' }
    }
  } catch (error) {
    throw new Error(`DOCX 解析失败: ${error.message}`)
  }
}

/**
 * 旧版 DOC 转换 + 提取
 */
async function extractLegacyDocText(file) {
  const originalName = file.originalname || 'document.doc'
  const safeBaseName = sanitizeFilename(basename(originalName, extname(originalName)) || 'document')
  const docxBuffer = await convertLegacyDocToDocx(file)
  return extractDocxText({ buffer: docxBuffer, originalname: `${safeBaseName}.docx`, mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

async function convertLegacyDocToDocx(file, { preserveAnnotations = false } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'doc-parse-'))
  const originalName = file.originalname || 'document.doc'
  const safeBaseName = sanitizeFilename(basename(originalName, extname(originalName)) || 'document')
  const inputPath = join(tempDir, `${safeBaseName}.doc`)
  const outputPath = join(tempDir, `${safeBaseName}.docx`)

  try {
    await writeFile(inputPath, file.buffer)

    if (preserveAnnotations) {
      await runLibreOfficeConversion(inputPath, tempDir)
    } else if (process.platform === 'darwin') {
      await execFileAsync('textutil', ['-convert', 'docx', inputPath, '-output', outputPath], { timeout: 60000 })
    } else {
      await runLibreOfficeConversion(inputPath, tempDir)
    }

    return await readFile(outputPath)
  } catch (error) {
    throw new Error(`旧版 Word .doc 转换失败，请先另存为 .docx 后再上传: ${error.message}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function parseDocxAnnotations(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const commentsFile = zip.file('word/comments.xml')
  const documentFile = zip.file('word/document.xml')
  if (!commentsFile || !documentFile) return emptyWordAnnotations()

  const [commentsXml, documentXml] = await Promise.all([commentsFile.async('string'), documentFile.async('string')])
  const rangeAnchors = extractCommentRangeAnchors(documentXml)
  const paragraphAnchors = extractCommentParagraphAnchors(documentXml)
  const comments = []
  for (const match of commentsXml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const id = xmlAttribute(match[1], 'id')
    const text = extractXmlText(match[2])
    if (!id || !text) continue
    comments.push({
      id,
      author: xmlAttribute(match[1], 'author'),
      date: xmlAttribute(match[1], 'date'),
      text,
      // 整段锚点比局部选中文字更适合审核阶段对照；没有批注引用时再回退到选中区间。
      anchor: paragraphAnchors.get(id) || rangeAnchors.get(id) || ''
    })
  }

  return {
    comments,
    revisions: {
      insertions: (documentXml.match(/<w:ins\b/g) || []).length,
      deletions: (documentXml.match(/<w:del\b/g) || []).length
    }
  }
}

function emptyWordAnnotations() {
  return { comments: [], revisions: { insertions: 0, deletions: 0 } }
}

function extractCommentRangeAnchors(documentXml) {
  const activeIds = new Set()
  const anchors = new Map()
  const tokenPattern = /<w:commentRangeStart\b([^>]*)\/>|<w:commentRangeEnd\b([^>]*)\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<\/w:p>/g
  for (const match of documentXml.matchAll(tokenPattern)) {
    if (match[1] !== undefined) {
      const id = xmlAttribute(match[1], 'id')
      if (id) {
        activeIds.add(id)
        if (!anchors.has(id)) anchors.set(id, '')
      }
      continue
    }
    if (match[2] !== undefined) {
      activeIds.delete(xmlAttribute(match[2], 'id'))
      continue
    }
    const value = match[3] !== undefined
      ? decodeXmlEntities(match[3])
      : match[0].startsWith('</w:p') ? '\n' : ' '
    for (const id of activeIds) anchors.set(id, `${anchors.get(id) || ''}${value}`)
  }
  return new Map([...anchors].map(([id, text]) => [id, normalizeInlineText(text)]).filter(([, text]) => text))
}

function extractCommentParagraphAnchors(documentXml) {
  const anchors = new Map()
  for (const paragraph of documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const text = extractXmlText(paragraph[1])
    if (!text) continue
    for (const reference of paragraph[1].matchAll(/<w:commentReference\b([^>]*)\/>/g)) {
      const id = xmlAttribute(reference[1], 'id')
      if (id && !anchors.has(id)) anchors.set(id, text)
    }
  }
  return anchors
}

function extractXmlText(xml) {
  return normalizeInlineText([...String(xml || '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlEntities(match[1]))
    .join(''))
}

function xmlAttribute(attributes, name) {
  return decodeXmlEntities(String(attributes || '').match(new RegExp(`\\bw:${name}="([^"]*)"`, 'i'))?.[1] || '')
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function normalizeInlineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

/**
 * 图片 OCR 文本提取
 */
async function extractImageText(file) {
  try {
    const { createWorker } = await import('tesseract.js')
    console.log(`[file-parser] Starting OCR for: ${file.originalname}`)

    const worker = await createWorker('chi_sim')
    const { data } = await worker.recognize(file.buffer)
    await worker.terminate()

    const text = data?.text || ''
    console.log(`[file-parser] OCR completed, text length: ${text.length}`)

    return {
      text,
      pageCount: null,
      metadata: {
        format: 'image',
        confidence: data?.confidence ?? null
      }
    }
  } catch (error) {
    throw new Error(`图片 OCR 识别失败: ${error.message}`)
  }
}

// --- Helpers ---

function isImage(extension, mimeType) {
  const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif']
  return imageExts.includes(extension) || mimeType.startsWith('image/')
}

function isLegacyWord(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  )
}

async function runLibreOfficeConversion(inputPath, outputDir) {
  const args = ['--headless', '--convert-to', 'docx', '--outdir', outputDir, inputPath]

  try {
    await execFileAsync('libreoffice', args, { timeout: 60000 })
  } catch (firstError) {
    try {
      await execFileAsync('soffice', args, { timeout: 60000 })
    } catch {
      throw new Error(`${firstError.message || 'libreoffice not available'}。Linux 服务器请安装 libreoffice。`)
    }
  }
}

function sanitizeFilename(name) {
  return name
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'document'
}
