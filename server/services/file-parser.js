import { readFile, writeFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, extname, basename } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

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
  const tempDir = await mkdtemp(join(tmpdir(), 'doc-parse-'))
  const originalName = file.originalname || 'document.doc'
  const safeBaseName = sanitizeFilename(basename(originalName, extname(originalName)) || 'document')
  const inputPath = join(tempDir, `${safeBaseName}.doc`)
  const outputPath = join(tempDir, `${safeBaseName}.docx`)

  try {
    await writeFile(inputPath, file.buffer)

    if (process.platform === 'darwin') {
      await execFileAsync('textutil', ['-convert', 'docx', inputPath, '-output', outputPath], { timeout: 60000 })
    } else {
      await runLibreOfficeConversion(inputPath, tempDir)
    }

    const docxBuffer = await readFile(outputPath)
    return extractDocxText({ buffer: docxBuffer, originalname: `${safeBaseName}.docx`, mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  } catch (error) {
    throw new Error(`旧版 Word .doc 转换失败，请先另存为 .docx 后再上传: ${error.message}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
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
