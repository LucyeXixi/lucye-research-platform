'use client'

import { getApiConfig } from './storage'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface CompletionOptions {
  temperature?: number
  maxTokens?: number
  onChunk?: (text: string) => void
}

const DEFAULT_MODELS: Record<string, string> = {
  deepseek: 'deepseek-chat',
  openai:   'gpt-4o-mini',
  claude:   'claude-sonnet-4-6',
  custom:   'gpt-3.5-turbo',
}

const DEFAULT_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  openai:   'https://api.openai.com/v1',
  claude:   'https://api.anthropic.com',
  custom:   '',
}

export async function chatCompletion(
  messages: Message[],
  options: CompletionOptions = {}
): Promise<string> {
  const cfg = getApiConfig()
  if (!cfg) throw new Error('请先配置 API Key')

  const baseUrl = cfg.baseUrl || DEFAULT_URLS[cfg.provider] || ''
  const model   = cfg.model   || DEFAULT_MODELS[cfg.provider]

  if (cfg.provider === 'claude') {
    const system = messages.find(m => m.role === 'system')?.content
    const msgs   = messages.filter(m => m.role !== 'system')
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type':                          'application/json',
        'x-api-key':                             cfg.apiKey,
        'anthropic-version':                     '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens || 2048,
        ...(system ? { system } : {}),
        messages: msgs,
      }),
    })
    if (!res.ok) throw new Error(`Claude API 错误 ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.content[0].text as string
  }

  // OpenAI-compatible (DeepSeek / OpenAI / custom)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens:  options.maxTokens  ?? 2048,
    }),
  })
  if (!res.ok) throw new Error(`AI API 错误 ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices[0].message.content as string
}

export async function testConnection(): Promise<string> {
  return chatCompletion(
    [{ role: 'user', content: '请回复"连接成功"四个字。' }],
    { maxTokens: 20 }
  )
}
