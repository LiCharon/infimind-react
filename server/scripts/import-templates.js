/**
 * 批量导入合同模版脚本
 *
 * 用法：node server/scripts/import-templates.js [模版文件目录]
 *
 * 功能：
 * 1. 扫描指定目录下的 .doc/.docx 文件
 * 2. 使用 mammoth + libreoffice/textutil 提取文本
 * 3. 将文本和元数据导入 SQLite 知识库
 * 4. 更新 index.json
 *
 * 前置条件：
 * - 模版文件放在 server/knowledge-base/templates/ 目录
 * - 或在命令行指定目录
 */

import { readdir, readFile, writeFile, mkdir, access } from 'fs/promises'
import { join, extname, basename, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createWriteStream } from 'fs'
import { initialize, addTemplate, listTemplates, close } from '../services/knowledge-base.js'
import { extractText } from '../services/file-parser.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const inputDir = process.argv[2] || join(__dirname, '..', 'knowledge-base', 'templates')
  const outputDir = join(__dirname, '..', 'knowledge-base', 'templates')
  const indexPath = join(__dirname, '..', 'knowledge-base', 'index.json')

  console.log(`[import-templates] Scanning: ${inputDir}`)
  console.log(`[import-templates] Output: ${outputDir}`)
  console.log('')

  // 确保输出目录存在
  await mkdir(outputDir, { recursive: true })

  // 扫描文件
  let files
  try {
    files = await readdir(inputDir)
  } catch (error) {
    console.error(`[import-templates] Cannot read directory: ${inputDir}`)
    console.error(`[import-templates] Please place .doc/.docx template files in: ${outputDir}`)
    process.exit(1)
  }

  const docFiles = files.filter((f) => {
    const ext = extname(f).toLowerCase()
    return ['.doc', '.docx'].includes(ext) && !f.startsWith('.')
  })

  if (docFiles.length === 0) {
    console.log('[import-templates] No .doc/.docx/.txt files found.')
    console.log(`[import-templates] Place your template files in: ${outputDir}`)
    process.exit(0)
  }

  console.log(`[import-templates] Found ${docFiles.length} files to process\n`)

  // 初始化数据库
  const db = initialize()

  // 读取现有索引
  let indexData = []
  try {
    const raw = await readFile(indexPath, 'utf-8')
    indexData = JSON.parse(raw)
    console.log(`[import-templates] Existing index: ${indexData.length} entries`)
  } catch {
    console.log('[import-templates] No existing index, creating new one')
  }

  const existingNames = new Set(indexData.map((item) => item.name))

  let imported = 0
  let skipped = 0

  for (const fileName of docFiles) {
    const filePath = join(inputDir, fileName)
    const ext = extname(fileName).toLowerCase()
    const baseName = basename(fileName, ext)
    const displayName = baseName.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()

    // 跳过已存在的
    if (existingNames.has(displayName)) {
      console.log(`  [skip] ${fileName} (already in index)`)
      skipped++
      continue
    }

    console.log(`  [processing] ${fileName}...`)

    try {
      // 如果是 .txt 直接读取
      let text = ''
      if (ext === '.txt') {
        const buffer = await readFile(filePath)
        text = buffer.toString('utf-8')
      } else {
        // .doc/.docx 需要解析
        const buffer = await readFile(filePath)
        const result = await extractText({
          buffer,
          originalname: fileName,
          mimetype: ext === '.docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/msword'
        })
        text = result.text
      }

      if (!text.trim()) {
        console.log(`  [warn] ${fileName}: No text extracted, skipping`)
        skipped++
        continue
      }

      // 保存 .txt 副本到输出目录
      const txtFileName = `${baseName}.txt`
      const txtFilePath = join(outputDir, txtFileName)
      await writeFile(txtFilePath, text, 'utf-8')
      console.log(`  [saved] ${txtFileName} (${text.length} chars)`)

      // 导入数据库
      addTemplate({
        name: displayName,
        contractType: guessContractType(displayName, text),
        industry: guessIndustry(displayName),
        description: `从 ${fileName} 导入的合同模板`,
        referenceRole: guessReferenceRole(displayName),
        reviewNotes: guessReferenceRole(displayName) === 'annotated_case'
          ? '该文件被识别为带批注的风险案例；审查时仅提取其中的问题、批注和修订思路，不将其原条款作为推荐文本。'
          : '',
        sourceFile: fileName,
        content: text
      })

      // 更新索引
      indexData.push({
        name: displayName,
        contract_type: guessContractType(displayName, text),
        industry: guessIndustry(displayName),
        description: `从 ${fileName} 导入的合同模板`,
        reference_role: guessReferenceRole(displayName),
        review_notes: guessReferenceRole(displayName) === 'annotated_case'
          ? '带批注风险案例，仅用于识别问题与修订思路。'
          : '',
        source_file: fileName,
        text_file: txtFileName
      })

      imported++
    } catch (error) {
      console.error(`  [error] ${fileName}: ${error.message}`)
    }
  }

  // 写入更新后的索引
  await writeFile(indexPath, JSON.stringify(indexData, null, 2), 'utf-8')
  console.log(`\n[import-templates] Index updated: ${indexData.length} entries`)

  // 验证
  const allTemplates = listTemplates()
  console.log(`[import-templates] Database: ${allTemplates.length} templates`)
  console.log(`[import-templates] Imported: ${imported}, Skipped: ${skipped}`)

  close()
  console.log('[import-templates] Done.')
}

function guessContractType(name, text) {
  const combined = (name + ' ' + text.slice(0, 1000)).toLowerCase()

  if (combined.includes('股权') || combined.includes('股份')) return '股权转让合同'
  if (combined.includes('买卖') || combined.includes('销售') || combined.includes('采购') || combined.includes('购销')) {
    return '买卖合同'
  }
  if (combined.includes('租赁') || combined.includes('出租') || combined.includes('承租')) return '租赁合同'
  if (combined.includes('经纪') || combined.includes('主播') || combined.includes('艺人')) return '经纪合同'
  if (combined.includes('广告') || combined.includes('投放')) return '广告合同'
  if (combined.includes('服务')) return '服务合同'
  if (combined.includes('保密') || combined.includes('nda')) return '保密协议'
  if (combined.includes('劳动') || combined.includes('聘用')) return '劳动合同'

  return '买卖合同'
}

function guessIndustry(name) {
  const lower = name.toLowerCase()
  if (lower.includes('设备') || lower.includes('机械') || lower.includes('制造')) return '设备制造'
  if (lower.includes('货物') || lower.includes('采购') || lower.includes('供应')) return '贸易采购'
  if (lower.includes('建筑') || lower.includes('工程')) return '建筑工程'
  if (lower.includes('软件') || lower.includes('技术') || lower.includes('it')) return '信息技术'
  return '通用'
}

function guessReferenceRole(name) {
  const normalized = name.toLowerCase()
  if (/(批注|问题|不良|错误|风险案例|反例|修订前)/.test(normalized)) return 'annotated_case'
  if (/(优秀|示范|标准|范本|修订后|合规)/.test(normalized)) return 'excellent_template'
  return 'reference'
}

main().catch((error) => {
  console.error('[import-templates] Fatal error:', error)
  process.exit(1)
})
