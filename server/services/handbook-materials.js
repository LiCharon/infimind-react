import { extractText } from './file-parser.js'

export const HANDBOOK_PARSER_VERSION = 3

// Extraction and embedded-image OCR belong to the shared parser.
export async function extractHandbookText(file, options = {}) {
  return extractText(file, options)
}
