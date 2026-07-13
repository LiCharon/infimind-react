import dotenv from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../../.env.local') })

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro'
const DEEPSEEK_FLASH_MODEL = process.env.DEEPSEEK_FLASH_MODEL || 'deepseek-v4-flash'

if (!DEEPSEEK_API_KEY) {
  console.warn('[llm-client] Missing DEEPSEEK_API_KEY environment variable.')
}

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${DEEPSEEK_API_KEY}`
  }
}

async function deepseekFetch(path, body, retries = 3) {
  const url = `${DEEPSEEK_BASE_URL}${path}`

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(body)
      })

      if (response.status === 429) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 30000)
        console.warn(`[llm-client] Rate limited. Retrying in ${waitMs}ms (attempt ${attempt}/${retries})`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }

      if (response.status === 400) {
        const err = await response.json().catch(() => ({}))
        throw new Error(`Bad request: ${JSON.stringify(err)}`)
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown error')
        throw new Error(`API error ${response.status}: ${errText}`)
      }

      return response
    } catch (err) {
      if (attempt === retries) throw err
      const waitMs = 1000 * attempt
      console.warn(`[llm-client] Request failed. Retrying in ${waitMs}ms (attempt ${attempt}/${retries})`)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }

  throw new Error('Unreachable')
}

/**
 * 非流式调用 DeepSeek Chat
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {object} options
 * @returns {Promise<string>}
 */
export async function chat(systemPrompt, userMessage, options = {}) {
  const {
    model = DEEPSEEK_MODEL,
    temperature = 0.3,
    maxTokens = 8192
  } = options

  const messages = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: userMessage })

  const response = await deepseekFetch('/chat/completions', {
    model,
    messages,
    temperature,
    max_tokens: maxTokens
  })

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content || ''

  if (data?.usage) {
    console.log(
      `[llm-client] Tokens: prompt=${data.usage.prompt_tokens}, completion=${data.usage.completion_tokens}, total=${data.usage.total_tokens}`
    )
  }

  return content
}

/**
 * 流式调用 DeepSeek Chat，返回 AsyncGenerator
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {object} options
 * @returns {AsyncGenerator<{content: string, reasoning: string, finishReason: string|null}>}
 */
export async function* streamChat(systemPrompt, userMessage, options = {}) {
  const {
    model = DEEPSEEK_MODEL,
    temperature = 0.3,
    maxTokens = 8192
  } = options

  const messages = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: userMessage })

  const inputChars = systemPrompt.length + userMessage.length
  console.log(`[llm-client] Starting stream with model: ${model}, input ~${inputChars} chars`)

  const response = await deepseekFetch('/chat/completions', {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let totalTokens = 0
  let receivedChunks = 0

  try {
    while (true) {
      let readResult
      try {
        readResult = await reader.read()
      } catch (readError) {
        if (receivedChunks === 0) {
          throw new Error(`流读取失败（尚未收到任何数据，可能是输入过大或 API 拒绝请求）: ${readError.message}`)
        }
        throw new Error(`流连接中断（已收到 ${receivedChunks} 个数据块）: ${readError.message}`)
      }

      const { done, value } = readResult
      if (done) break

      receivedChunks++
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('event:')) continue
        if (trimmed === 'data: [DONE]') {
          console.log(`[llm-client] Stream done. Total tokens: ${totalTokens}, chunks: ${receivedChunks}`)
          return
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6)
          try {
            const parsed = JSON.parse(jsonStr)
            const choice = parsed.choices?.[0]
            if (!choice) continue

            const delta = choice.delta ?? {}
            const content = delta.content ?? ''
            const reasoning = delta.reasoning_content ?? ''

            if (parsed.usage?.total_tokens) {
              totalTokens = parsed.usage.total_tokens
            }

            yield {
              content,
              reasoning,
              finishReason: choice.finish_reason ?? null
            }
          } catch {
            // 跳过不完整 JSON
            continue
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 获取 Flash 模型名称（用于简单任务）
 */
export function getFlashModel() {
  return DEEPSEEK_FLASH_MODEL
}

/**
 * 获取 Pro 模型名称（用于复杂任务）
 */
export function getProModel() {
  return DEEPSEEK_MODEL
}
