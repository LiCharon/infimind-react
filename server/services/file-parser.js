import { readFile, writeFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, extname, basename } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import JSZip from 'jszip'

const execFileAsync = promisify(execFile)
const PLAIN_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.html', '.htm'])
const OFFICE_TEXT_EXTENSIONS = new Set(['.rtf', '.odt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp'])
const MACOS_TEXTUTIL_EXTENSIONS = new Set(['.rtf', '.odt'])

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

  if (PLAIN_TEXT_EXTENSIONS.has(extension) || mimeType.startsWith('text/')) {
    return extractPlainText(file, extension)
  }

  if (OFFICE_TEXT_EXTENSIONS.has(extension)) {
    return extractOfficeDocumentText(file, extension)
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

/**
 * RTF、OpenDocument、Excel 与 PowerPoint 使用系统可用的文档转换器提取文本。
 * LibreOffice 能保持跨平台一致；macOS 上 RTF/ODT 还能直接由 textutil 处理。
 */
async function extractOfficeDocumentText(file, extension) {
  let text
  try {
    text = await convertDocumentToText(file, extension)
  } catch (error) {
    // RTF 是文本容器，转换器对历史编码文件可能返回空内容；可安全回退到控制字解析。
    if (extension !== '.rtf') throw error
    text = extractRtfText(file.buffer)
    if (!text) throw error
    console.warn(`[file-parser] RTF converter fallback used for ${file.originalname}`)
  }
  return {
    text,
    pageCount: null,
    metadata: { format: extension.slice(1), converted: true }
  }
}

function extractRtfText(buffer) {
  return decodeTextBuffer(buffer)
    .replace(/\\par[d]?\b/gi, '\n')
    .replace(/\\line\b/gi, '\n')
    .replace(/\\tab\b/gi, '\t')
    .replace(/\\u(-?\d+)[^\\{}]?/g, (_, value) => String.fromCharCode((Number(value) + 65536) % 65536))
    .replace(/\\'([0-9a-f]{2})/gi, (_, value) => String.fromCharCode(parseInt(value, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/\\[^a-z]/gi, '')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function convertDocumentToText(file, extension) {
  const tempDir = await mkdtemp(join(tmpdir(), 'office-text-'))
  const originalName = file.originalname || `document${extension}`
  const safeBaseName = sanitizeFilename(basename(originalName, extname(originalName)) || 'document')
  const normalizedExtension = OFFICE_TEXT_EXTENSIONS.has(extension) ? extension : '.doc'
  const inputPath = join(tempDir, `${safeBaseName}${normalizedExtension}`)
  const outputPath = join(tempDir, `${safeBaseName}.txt`)

  try {
    await writeFile(inputPath, file.buffer)
    if (process.platform === 'darwin' && MACOS_TEXTUTIL_EXTENSIONS.has(normalizedExtension)) {
      await execFileAsync('textutil', ['-convert', 'txt', '-encoding', 'UTF-8', inputPath, '-output', outputPath], { timeout: 60000 })
    } else {
      await runLibreOfficeConversion(inputPath, tempDir, 'txt:Text')
    }
    const text = decodeTextBuffer(await readFile(outputPath))
    if (!text.trim()) throw new Error('转换后未提取到文字')
    return text
  } catch (error) {
    throw new Error(`${extension.slice(1).toUpperCase()} 解析失败: ${error.message}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
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
      try {
        await execFileAsync('textutil', ['-convert', 'docx', inputPath, '-output', outputPath], { timeout: 60000 })
      } catch (textutilError) {
        // 部分旧版编码/复合文档不被 textutil 接受，回退到 LibreOffice。
        console.warn(`[file-parser] textutil 转换失败，尝试 LibreOffice: ${textutilError.message}`)
        await runLibreOfficeConversion(inputPath, tempDir)
      }
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
async function extractPlainText(file, extension) {
  const source = decodeTextBuffer(file.buffer)
  const text = ['.html', '.htm', '.xml'].includes(extension) ? stripMarkup(source) : source
  return {
    text,
    pageCount: null,
    metadata: { format: extension.slice(1) || 'text' }
  }
}

function decodeTextBuffer(buffer) {
  const source = Buffer.from(buffer || [])
  // UTF-8 BOM 与 UTF-16 文本在合同附件中较常见；其他编码保持 UTF-8 容错解码。
  if (source[0] === 0xff && source[1] === 0xfe) return source.subarray(2).toString('utf16le')
  if (source[0] === 0xfe && source[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(Math.max(0, source.length - 2))
    for (let index = 2; index + 1 < source.length; index += 2) {
      swapped[index - 2] = source[index + 1]
      swapped[index - 1] = source[index]
    }
    return swapped.toString('utf16le')
  }
  return source.toString('utf8').replace(/^\uFEFF/, '')
}

function stripMarkup(source) {
  return decodeXmlEntities(String(source || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
    .trim()
}

/**
 * 图片 OCR：先放大、灰度化、增强对比度，再以中英双语识别；低置信度时补跑稀疏文本模式。
 * Jimp 为纯 JavaScript 依赖，避免部署时编译原生图像库。
 */
async function extractImageText(file) {
  try {
    const { createWorker } = await import('tesseract.js')
    const { Jimp, JimpMime } = await import('jimp')
    console.log(`[file-parser] Starting OCR for: ${file.originalname}`)

    let imageBuffer = file.buffer
    let preprocessed = false
    try {
      const image = await Jimp.read(file.buffer)
      const shortestSide = Math.min(image.width, image.height)
      const scale = shortestSide > 0 ? Math.min(3, Math.max(1, 1800 / shortestSide)) : 1
      if (scale > 1) image.resize({ w: Math.round(image.width * scale), h: Math.round(image.height * scale) })
      image.greyscale().contrast(0.25)
      imageBuffer = await image.getBuffer(JimpMime.png)
      preprocessed = true
    } catch (error) {
      // 解码失败时仍交给 Tesseract 处理原始格式，避免预处理阻断可识别图片。
      console.warn(`[file-parser] Image preprocessing skipped for ${file.originalname}: ${error.message}`)
    }

    const worker = await createWorker(['chi_sim', 'eng'])
    let data
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' })
      const primary = (await worker.recognize(imageBuffer)).data
      data = primary
      if (Number(primary?.confidence || 0) < 82) {
        await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '300' })
        const alternate = (await worker.recognize(imageBuffer)).data
        if (ocrScore(alternate) > ocrScore(primary)) data = alternate
      }
    } finally {
      await worker.terminate()
    }

    const text = normalizeOcrText(data?.text || '')
    console.log(`[file-parser] OCR completed, text length: ${text.length}`)

    return {
      text,
      pageCount: null,
      metadata: {
        format: 'image',
        confidence: data?.confidence ?? null,
        languages: 'chi_sim+eng',
        preprocessed
      }
    }
  } catch (error) {
    throw new Error(`图片 OCR 识别失败: ${error.message}`)
  }
}

function ocrScore(data) {
  const confidence = Number(data?.confidence || 0)
  const characters = normalizeOcrText(data?.text || '').replace(/\s/g, '').length
  return confidence + Math.min(12, characters / 100)
}

function normalizeOcrText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// --- Helpers ---

function isImage(extension, mimeType) {
  const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif', '.gif']
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

async function runLibreOfficeConversion(inputPath, outputDir, outputFormat = 'docx') {
  const args = ['--headless', '--convert-to', outputFormat, '--outdir', outputDir, inputPath]

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
