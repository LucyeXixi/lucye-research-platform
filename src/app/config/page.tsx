'use client'

import { useState, useEffect } from 'react'
import { Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { getApiConfig, saveApiConfig, clearApiConfig, type Provider } from '@/lib/storage'
import { testConnection } from '@/lib/ai'

const PROVIDERS = [
  {
    id:      'deepseek' as Provider,
    name:    'DeepSeek（推荐）',
    desc:    '注册即送 500 万 tokens，价格极低，国内访问稳定。',
    baseUrl: 'https://api.deepseek.com/v1',
    model:   'deepseek-chat',
    docsUrl: 'https://platform.deepseek.com/api-keys',
    badge:   '免费额度',
    steps: [
      '访问 platform.deepseek.com，点击右上角注册',
      '完成邮箱验证后，前往「API Keys」页面',
      '点击「创建 API Key」，复制生成的 Key',
      '将 Key 粘贴到下方输入框，点击「保存并测试」',
    ],
  },
  {
    id:      'claude' as Provider,
    name:    'Claude (Anthropic)',
    desc:    '最强推理能力，适合复杂分析场景。需要国际信用卡充值。',
    baseUrl: 'https://api.anthropic.com',
    model:   'claude-sonnet-4-6',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    badge:   '高质量',
    steps: [
      '访问 console.anthropic.com，注册并验证手机号',
      '前往「Settings → API Keys」',
      '点击「Create Key」，复制生成的 Key（sk-ant-...）',
      '将 Key 粘贴到下方输入框，点击「保存并测试」',
    ],
  },
  {
    id:      'openai' as Provider,
    name:    'OpenAI',
    desc:    'GPT-4o-mini 性价比高，生态成熟。需要国际信用卡。',
    baseUrl: 'https://api.openai.com/v1',
    model:   'gpt-4o-mini',
    docsUrl: 'https://platform.openai.com/api-keys',
    badge:   '生态成熟',
    steps: [
      '访问 platform.openai.com，注册账号',
      '前往「API Keys」页面，点击「Create new secret key」',
      '复制生成的 Key（sk-...）',
      '将 Key 粘贴到下方输入框，点击「保存并测试」',
    ],
  },
  {
    id:      'custom' as Provider,
    name:    '自定义（兼容 OpenAI 格式）',
    desc:    '任何兼容 OpenAI Chat Completions API 的服务均可接入。',
    baseUrl: '',
    model:   '',
    docsUrl: '',
    badge:   '高级',
    steps: [
      '获取目标服务的 API Base URL 和 API Key',
      '填写 Base URL（如 https://api.example.com/v1）',
      '填写 API Key 和模型名称',
      '点击「保存并测试」验证连接',
    ],
  },
]

export default function ConfigPage() {
  const [provider, setProvider]   = useState<Provider>('deepseek')
  const [apiKey,   setApiKey]     = useState('')
  const [baseUrl,  setBaseUrl]    = useState('')
  const [model,    setModel]      = useState('')
  const [showKey,  setShowKey]    = useState(false)
  const [status,   setStatus]     = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [errMsg,   setErrMsg]     = useState('')
  const [openStep, setOpenStep]   = useState<Provider | null>('deepseek')

  useEffect(() => {
    const cfg = getApiConfig()
    if (cfg) {
      setProvider(cfg.provider)
      setApiKey(cfg.apiKey)
      setBaseUrl(cfg.baseUrl || '')
      setModel(cfg.model   || '')
    }
  }, [])

  const selectedProvider = PROVIDERS.find(p => p.id === provider)!

  function handleProviderChange(p: Provider) {
    setProvider(p)
    const def = PROVIDERS.find(x => x.id === p)!
    setBaseUrl(def.baseUrl)
    setModel(def.model)
    setStatus('idle')
  }

  function parseErrMsg(raw: string): string {
    if (raw.includes('Insufficient Balance') || raw.includes('insufficient_quota'))
      return '账户余额不足。请前往服务商平台充值后再试（DeepSeek 最低充值约 ¥10，可用很久）。'
    if (raw.includes('401') || raw.includes('invalid_api_key') || raw.includes('Unauthorized'))
      return 'API Key 无效或已过期，请确认复制完整，注意不要有多余空格。'
    if (raw.includes('403') || raw.includes('Permission'))
      return 'API Key 无访问权限，可能需要在服务商平台开通相应功能。'
    if (raw.includes('429') || raw.includes('rate_limit') || raw.includes('Too Many'))
      return '请求频率超限，请等待 30 秒后再试。'
    if (raw.includes('model_not_found') || raw.includes('invalid_model'))
      return '模型名称不存在，请检查模型填写是否正确（DeepSeek 默认：deepseek-chat）。'
    if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('CORS'))
      return '网络连接失败。请检查网络，或该服务商不支持从浏览器直接调用（需要后端代理）。'
    if (raw.includes('500') || raw.includes('502') || raw.includes('503'))
      return '服务商服务器暂时出错，请稍后重试。'
    return raw
  }

  async function handleSave() {
    if (!apiKey.trim()) { setErrMsg('请填写 API Key'); return }
    setStatus('testing')
    setErrMsg('')
    saveApiConfig({ provider, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined, model: model.trim() || undefined })
    try {
      await testConnection()
      setStatus('ok')
    } catch (e) {
      setStatus('error')
      const raw = e instanceof Error ? e.message : '连接失败'
      setErrMsg(parseErrMsg(raw))
    }
  }

  function handleClear() {
    clearApiConfig()
    setApiKey('')
    setBaseUrl('')
    setModel('')
    setStatus('idle')
    setErrMsg('')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">API 配置</h1>
        <p className="text-sm text-gray-500 mt-1">
          配置 AI 服务的 API Key。Key 仅保存在你的浏览器本地，不会上传到任何服务器。
        </p>
      </div>

      {/* Provider selection */}
      <div className="card divide-y divide-gray-100">
        <div className="px-4 py-3">
          <p className="text-sm font-medium text-gray-700">选择 AI 服务商</p>
        </div>
        {PROVIDERS.map(p => (
          <div key={p.id}>
            <button
              onClick={() => { handleProviderChange(p.id); setOpenStep(openStep === p.id ? null : p.id) }}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  provider === p.id ? 'border-primary-600' : 'border-gray-300'
                }`}>
                  {provider === p.id && <div className="w-2 h-2 rounded-full bg-primary-600" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{p.name}</span>
                    <span className="badge bg-gray-100 text-gray-500">{p.badge}</span>
                  </div>
                  <p className="text-xs text-gray-500">{p.desc}</p>
                </div>
              </div>
              {openStep === p.id
                ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
              }
            </button>

            {openStep === p.id && (
              <div className="px-4 pb-4 bg-blue-50 border-t border-blue-100">
                <div className="flex items-center justify-between mt-3 mb-2">
                  <p className="text-xs font-medium text-gray-600">获取 API Key 步骤</p>
                  {p.docsUrl && (
                    <a href={p.docsUrl} target="_blank" rel="noopener noreferrer"
                       className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                      前往官网 <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <ol className="space-y-1">
                  {p.steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-xs text-gray-600">
                      <span className="text-primary-500 font-medium shrink-0">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Key input */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="label">API Key</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={
                provider === 'deepseek' ? 'sk-...' :
                provider === 'claude'   ? 'sk-ant-...' :
                provider === 'openai'   ? 'sk-...' : '你的 API Key'
              }
              className="input pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {provider === 'custom' && (
          <>
            <div>
              <label className="label">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="input"
              />
            </div>
            <div>
              <label className="label">模型名称</label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="gpt-3.5-turbo"
                className="input"
              />
            </div>
          </>
        )}

        {provider !== 'custom' && (
          <div>
            <label className="label">模型</label>
            <input
              type="text"
              value={model || selectedProvider.model}
              onChange={e => setModel(e.target.value)}
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">留空则使用默认模型：{selectedProvider.model}</p>
          </div>
        )}

        {/* Status */}
        {status === 'ok' && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
            <CheckCircle2 className="w-4 h-4" /> 连接成功！API Key 已保存。
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errMsg || '连接失败，请检查 Key 是否正确。'}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={status === 'testing'}
            className="btn-primary"
          >
            {status === 'testing' && <Loader2 className="w-4 h-4 animate-spin" />}
            保存并测试连接
          </button>
          <button onClick={handleClear} className="btn-secondary text-red-500 border-red-100 hover:bg-red-50">
            清除配置
          </button>
        </div>
      </div>

      {/* Privacy note */}
      <p className="text-xs text-gray-400 text-center">
        🔒 API Key 仅存储在你的浏览器 localStorage 中，不经过任何服务器，你的 Key 只有你自己知道。
      </p>
    </div>
  )
}
