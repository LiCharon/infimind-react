import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { extractText } from './file-parser.js'
import { recognizeHandbookImage } from './handbook-ocr-process.js'

export const HANDBOOK_PARSER_VERSION = 2

// Handbook-only enrichment. Other tools keep their current parser and offsets.
export async function extractHandbookText(file, { signal, recognizeImage = recognizeHandbookImage, ...options } = {}) {
  const extension = extname(file.originalname || '').toLowerCase()
  if (/^\.(?:png|jpe?g|gif|bmp|webp|tiff?)$/.test(extension) || file.mimetype?.startsWith('image/')) return recognizeImage(file, { signal })
  const base = await extractText(file, { signal, recognizeImage, ...options })
  if (base.metadata?.format === 'docx') return enrichWord(file, base, { signal, recognizeImage })
  if (extension !== '.pdf' && file.mimetype !== 'application/pdf') return base
  return enrichPdf(file, base, { signal, recognizeImage })
}

async function readImage(image, label, { signal, recognizeImage }, warnings, unreadableParts) {
  signal?.throwIfAborted()
  try {
    const result = await recognizeImage({ buffer: image, originalname: `${label}.png`, mimetype: 'image/png' }, { signal })
    signal?.throwIfAborted()
    warnings.push(`${label}使用OCR识别，请对照原件核对，置信度不代表逐字准确。`)
    if (!result.text?.trim()) {
      unreadableParts.push(`${label}未识别到文字，请核对是否仅为装饰图片。`)
      return `【${label}：未识别到文字】`
    }
    return `【${label}，OCR识别待核对】\n${result.text.trim()}`
  } catch (cause) {
    signal?.throwIfAborted()
    unreadableParts.push(`${label}读取失败：${String(cause.message || '').slice(0, 160)}`)
    return `【${label}：未读取成功】`
  }
}

async function enrichWord(file, base, options) {
  if (file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
    return { ...base, metadata: { ...base.metadata, warnings: [...(base.metadata.warnings || []), '旧Word转换正文已读取，内嵌图片尚未核对；请另存为DOCX核对图文完整性。'] } }
  }
  const zip = await JSZip.loadAsync(file.buffer)
  const xml = await zip.file('word/document.xml')?.async('string') || ''
  const hasImages = /<(?:\w+:)?(?:drawing|pict)\b/.test(xml)
  const hasTables = /<w:tbl\b/.test(xml)
  if (!hasImages && !hasTables) return base
  const mammoth = await import('mammoth')
  const marker = `HANDBOOK_${randomUUID()}_IMAGE_`
  const images = [], warnings = [...(base.metadata?.warnings || [])], unreadableParts = []
  const converted = await mammoth.convertToHtml({ buffer: file.buffer }, {
    externalFileAccess: false,
    convertImage: mammoth.images.imgElement(async (image) => {
      options.signal?.throwIfAborted()
      const index = images.length
      const pending = { index }
      images.push(pending)
      try { pending.buffer = await image.readAsBuffer() } catch (cause) { pending.error = cause.message }
      return { src: `handbook-image-${index}` }
    })
  })
  options.signal?.throwIfAborted()
  let html = converted.value
  // Insert plain-text markers first, then replace them AFTER stripping markup;
  // OCR text cannot inject HTML and stays at its image's position in the document.
  for (const image of images) {
    const label = `Word内嵌图片${image.index + 1}`
    if (image.error) unreadableParts.push(`${label}未读取成功：${image.error}`)
    image.text = image.buffer ? await readImage(image.buffer, label, options, warnings, unreadableParts) : `【${label}：未读取成功】`
    html = html.replace(new RegExp(`<img\\b[^>]*src="handbook-image-${image.index}"[^>]*>`, 'g'), `\n${marker}${image.index}_END\n`)
  }
  if (hasImages && !images.length) unreadableParts.push('Word包含绘图或链接图片，但转换器未提取到图片，请核对原件。')
  if (/<(?:td|th)\b[^>]*(?:rowspan|colspan)=/.test(html)) warnings.push('Word存在合并单元格，文字已保留，行列适用关系需对照原表核对。')
  html = html.replace(/<\/(?:td|th)>/g, '\t')
  const flattened = await extractText({ buffer: Buffer.from(html), originalname: 'handbook.html', mimetype: 'text/html' })
  let text = flattened.text
  for (const image of images) text = text.replaceAll(`${marker}${image.index}_END`, image.text)
  warnings.push(...converted.messages.map((message) => `Word转换提示：${message.message}`))
  return { ...base, text, metadata: { ...base.metadata, embeddedImages: images.length, warnings, unreadableParts } }
}

async function enrichPdf(file, base, options) {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(file.buffer) })
  const abort = () => { void parser.destroy().catch(() => {}) }
  options.signal?.addEventListener('abort', abort, { once: true })
  const pages = [], warnings = [...(base.metadata?.warnings || [])], unreadableParts = []
  try {
    for (const original of base.metadata.pages || []) {
      options.signal?.throwIfAborted()
      const page = { ...original }
      // Empty-text pages already passed through full-page OCR in the shared parser.
      if (page.method === 'text') {
        try {
          const extracted = await parser.getImage({ partial: [page.page], imageThreshold: 0, imageDataUrl: false, imageBuffer: true })
          const images = extracted.pages.flatMap((item) => item.images)
          for (const [index, image] of images.entries()) {
            const content = await readImage(Buffer.from(image.data), `第${page.page}页内嵌图片${index + 1}`, options, warnings, unreadableParts)
            page.text += `\n\n${content}`
          }
          if (images.length) page.method = 'text+ocr'
        } catch (cause) {
          options.signal?.throwIfAborted()
          unreadableParts.push(`第${page.page}页图片检查失败：${String(cause.message || '').slice(0, 160)}`)
        }
      }
      pages.push(page)
    }
    return { ...base, text: pages.filter((page) => page.text?.trim()).map((page) => `【第${page.page}页${page.method === 'text' ? '' : '，含OCR识别待核对'}】\n${page.text}`).join('\n\n'),
      metadata: { ...base.metadata, pages, warnings, unreadableParts } }
  } finally {
    options.signal?.removeEventListener('abort', abort)
    await parser.destroy().catch(() => {})
  }
}
