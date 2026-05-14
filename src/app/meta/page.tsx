'use client'

import { useState } from 'react'
import { Search, Loader2, BarChart2, ChevronRight, AlertCircle, Network, GitMerge, Calendar } from 'lucide-react'
import { searchPubMed, type SearchResult } from '@/lib/pubmed'
import { chatCompletion } from '@/lib/ai'
import ApiKeyBanner from '@/components/ApiKeyBanner'
import StepWizard from '@/components/StepWizard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const STEPS = [
  { label: '研究问题' },
  { label: '类型推荐' },
  { label: '检索背调' },
  { label: '可行性' },
  { label: '期刊匹配' },
  { label: '进度规划' },
]

const SEARCH_DEPTHS = [
  { id: 'light',  label: '轻量', years: 5 },
  { id: 'medium', label: '中量', years: 10 },
  { id: 'heavy',  label: '深度', years: 20 },
]

type MetaType = 'pairwise' | 'nma' | 'unknown'

export default function MetaPage() {
  const [step,          setStep]          = useState(0)
  const [question,      setQuestion]      = useState('')
  const [depth,         setDepth]         = useState('medium')
  const [recommending,  setRecommending]  = useState(false)
  const [metaType,      setMetaType]      = useState<MetaType>('unknown')
  const [typeRationale, setTypeRationale] = useState('')
  const [searching,     setSearching]     = useState(false)
  const [searchResult,  setSearchResult]  = useState<SearchResult | null>(null)
  const [assessing,     setAssessing]     = useState(false)
  const [feasibility,   setFeasibility]   = useState('')
  const [deadline,      setDeadline]      = useState('')
  const [error,         setError]         = useState('')

  const depthConfig = SEARCH_DEPTHS.find(d => d.id === depth)!

  async function handleRecommendType() {
    if (!question.trim()) return
    setRecommending(true)
    setError('')
    try {
      const text = await chatCompletion([
        {
          role: 'system',
          content: '你是一位生物统计学和循证医学专家。根据用户描述的临床问题，判断应做普通配对Meta分析还是网状Meta分析（NMA），并给出详细理由。回复使用中文，结构清晰。',
        },
        {
          role: 'user',
          content: `我想做一个Meta分析，研究问题是：${question}

请分析：
## 推荐类型
是普通 Pairwise Meta 分析，还是网状 Meta 分析（NMA）？请给出明确结论。

## 判断依据
详细说明为什么推荐这种类型（考虑：比较的干预措施数量、是否有多种治疗方案需要间接比较、是否需要排名）。

## 类型说明
如果推荐 NMA：解释什么是网状Meta，优势在哪里，以及主要挑战（异质性、一致性假设）。
如果推荐普通 Meta：说明标准配对Meta的框架和局限性。

## PICO 建议
帮我初步定义这个Meta分析的PICO。

请在回复第一行用 [PAIRWISE] 或 [NMA] 标注推荐类型。`,
        },
      ], { maxTokens: 1200 })

      const isPairwise = text.includes('[PAIRWISE]')
      const isNMA      = text.includes('[NMA]')
      setMetaType(isNMA ? 'nma' : isPairwise ? 'pairwise' : 'unknown')
      setTypeRationale(text.replace(/^\[(?:PAIRWISE|NMA)\]\s*/m, ''))
      setStep(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 分析失败')
    } finally {
      setRecommending(false)
    }
  }

  async function handleSearch() {
    setSearching(true)
    setError('')
    try {
      const result = await searchPubMed(question, depthConfig.years)
      setSearchResult(result)
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : '检索失败')
    } finally {
      setSearching(false)
    }
  }

  async function handleFeasibility() {
    if (!searchResult) return
    setAssessing(true)
    setError('')
    try {
      const metaLabel = metaType === 'nma' ? '网状 Meta 分析（NMA）' : '普通 Pairwise Meta 分析'
      const text = await chatCompletion([
        {
          role: 'system',
          content: '你是一位循证医学专家，帮助评估Meta分析的可行性。回复使用中文，要实用具体。',
        },
        {
          role: 'user',
          content: `我计划做一个"${question}"的${metaLabel}。

PubMed 检索结果（近${depthConfig.years}年）：
- 总文献量：${searchResult.totalCount} 篇（这是含关键词的所有文献，非精筛后的RCT数量）
- 主要发表期刊：${searchResult.topJournals.slice(0, 5).map(j => j.name).join('、')}

请评估可行性：

## 文献量评估
这个文献量做${metaLabel}是否足够？通常需要多少篇 RCT 纳入才合适？

## PROSPERO 注册建议
是否需要在 PROSPERO 注册 protocol？注册时需要注意什么？

## 潜在挑战
这个选题可能面临哪些挑战（异质性、发表偏倚、语言偏倚等）？

## 工作量估算
从 protocol 到投稿，预计需要多少时间？各阶段大约多久？

## 综合建议
这个选题是否值得做？有什么调整建议？

## 可行性评分
综合评分（1-10分）及理由。`,
        },
      ], { maxTokens: 1200 })
      setFeasibility(text)
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 分析失败')
    } finally {
      setAssessing(false)
    }
  }

  const yearData = searchResult
    ? Object.entries(searchResult.yearDistribution)
        .filter(([y]) => /^\d{4}$/.test(y))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([year, count]) => ({ year, count }))
    : []

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center">
          <BarChart2 className="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Meta 分析选题向导</h1>
          <p className="text-sm text-gray-500">普通 Meta-analysis · 网状 Meta（NMA）</p>
        </div>
      </div>

      <ApiKeyBanner />
      <StepWizard steps={STEPS} currentStep={step} onChange={setStep} />

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 px-4 py-3 rounded-lg border border-red-100">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Step 0: Research question */}
      {step === 0 && (
        <div className="card p-6 space-y-5">
          <h2 className="section-title">描述你的临床问题</h2>
          <div>
            <label className="label">研究问题</label>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder={`例如：
• 不同降糖药物（二甲双胍/GLP-1/SGLT2）对2型糖尿病患者心血管结局的比较
• 腹腔镜vs开腹手术在结直肠癌中的安全性Meta分析
• 不同镇痛方案对腰椎术后疼痛控制的效果比较`}
              rows={4}
              className="input resize-none"
            />
          </div>

          {/* Meta type cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border border-violet-100 bg-violet-50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <GitMerge className="w-4 h-4 text-violet-600" />
                <span className="text-sm font-medium text-violet-700">普通 Meta 分析</span>
              </div>
              <p className="text-xs text-gray-500">仅比较两组（如A vs B），文献要求相对较低，方法更成熟。适合入门。</p>
            </div>
            <div className="border border-blue-100 bg-blue-50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Network className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">网状 Meta（NMA）</span>
              </div>
              <p className="text-xs text-gray-500">同时比较3种及以上干预措施，可给出排名，发表于高影响力期刊概率更高。</p>
            </div>
          </div>

          <p className="text-xs text-gray-400">不确定做哪种？填写研究问题后，让 AI 帮你推荐。</p>

          <button
            onClick={handleRecommendType}
            disabled={!question.trim() || recommending}
            className="btn-primary"
          >
            {recommending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> AI 分析中…</>
              : 'AI 推荐 Meta 类型'
            }
          </button>
        </div>
      )}

      {/* Step 1: Type recommendation */}
      {step >= 1 && typeRationale && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="section-title">推荐类型</h2>
            {metaType === 'nma' && (
              <span className="badge bg-blue-100 text-blue-700 flex items-center gap-1">
                <Network className="w-3 h-3" /> 网状 Meta（NMA）
              </span>
            )}
            {metaType === 'pairwise' && (
              <span className="badge bg-violet-100 text-violet-700 flex items-center gap-1">
                <GitMerge className="w-3 h-3" /> 普通 Meta 分析
              </span>
            )}
          </div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{typeRationale}</div>

          <div>
            <label className="label mt-2">检索深度</label>
            <div className="flex gap-2">
              {SEARCH_DEPTHS.map(d => (
                <button
                  key={d.id}
                  onClick={() => setDepth(d.id)}
                  className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                    depth === d.id
                      ? 'border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {d.label}（近{d.years}年）
                </button>
              ))}
            </div>
          </div>

          {step === 1 && (
            <button
              onClick={handleSearch}
              disabled={searching}
              className="btn-primary"
            >
              {searching
                ? <><Loader2 className="w-4 h-4 animate-spin" /> 检索中…</>
                : <><Search className="w-4 h-4" /> PubMed 检索背调</>
              }
            </button>
          )}
        </div>
      )}

      {/* Step 2: Search results */}
      {step >= 2 && searchResult && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">检索结果</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '总文献量', value: searchResult.totalCount.toLocaleString() + ' 篇' },
              { label: '类型', value: metaType === 'nma' ? '网状 NMA' : '普通 Meta' },
              { label: '覆盖期刊', value: searchResult.topJournals.length + ' 本' },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className="text-base font-semibold text-gray-900">{s.value}</p>
              </div>
            ))}
          </div>

          {yearData.length > 0 && (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={yearData}>
                <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#7c3aed" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">PROSPERO 查重</p>
            <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3 text-sm">
              <span className="text-gray-600">在 PROSPERO 手动检索是否已有同类注册：</span>
              <a
                href={`https://www.crd.york.ac.uk/prospero/#searchadvanced?query=${encodeURIComponent(question)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:underline font-medium"
              >
                前往 PROSPERO 检索 →
              </a>
            </div>
          </div>

          {step === 2 && (
            <button
              onClick={handleFeasibility}
              disabled={assessing}
              className="btn-primary"
            >
              {assessing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> 评估中…</>
                : 'AI 可行性评估'
              }
            </button>
          )}
        </div>
      )}

      {/* Step 3: Feasibility */}
      {step >= 3 && feasibility && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">可行性评估</h2>
          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{feasibility}</div>
          {step === 3 && (
            <button onClick={() => setStep(4)} className="btn-primary">
              期刊匹配 <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Step 4: Journal matching */}
      {step >= 4 && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">期刊匹配推荐</h2>
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 text-sm text-amber-700">
            <p className="font-medium">期刊数据库准备中</p>
            <p className="mt-1 text-xs">
              完整期刊数据将在 Codex 爬虫完成后自动接入。目前可参考以下常见{metaType === 'nma' ? 'NMA' : 'Meta 分析'}期刊：
            </p>
          </div>
          <div className="space-y-2">
            {(metaType === 'nma'
              ? ['BMJ', 'JAMA', 'Lancet', 'Annals of Internal Medicine', 'Journal of Clinical Medicine']
              : ['Systematic Reviews', 'PLOS ONE', 'BMC Medical Research Methodology', 'European Journal of Clinical Investigation']
            ).map(name => (
              <div key={name} className="flex items-center justify-between border border-gray-100 rounded-lg px-4 py-3">
                <p className="text-sm font-medium text-gray-900">{name}</p>
                <a
                  href={`https://www.letpub.com.cn/index.php?page=journalapp&view=query&journal_name=${encodeURIComponent(name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary-600 hover:underline"
                >
                  查 LetPub →
                </a>
              </div>
            ))}
          </div>
          {step === 4 && (
            <button onClick={() => setStep(5)} className="btn-primary">
              进度规划 <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Step 5: Progress */}
      {step >= 5 && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title flex items-center gap-2">
            <Calendar className="w-4 h-4" /> 进度规划
          </h2>
          <div>
            <label className="label">目标完成/投稿日期</label>
            <input
              type="date"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              className="input max-w-xs"
            />
          </div>
          {deadline && <MetaProgressPlan deadline={deadline} type={metaType} />}
        </div>
      )}
    </div>
  )
}

function MetaProgressPlan({ deadline, type }: { deadline: string; type: MetaType }) {
  const end       = new Date(deadline)
  const today     = new Date()
  const totalDays = Math.max(1, Math.floor((end.getTime() - today.getTime()) / 86400000))

  const milestones = type === 'nma'
    ? [
        { label: 'PROSPERO 注册 Protocol',   pct: 0.08 },
        { label: '系统检索 + 去重',            pct: 0.20 },
        { label: '独立筛选 + 纳排',            pct: 0.38 },
        { label: '数据提取 + RoB 评估',        pct: 0.55 },
        { label: 'STATA/R 网状 Meta 分析',     pct: 0.72 },
        { label: '论文写作（PRISMA-NMA）',     pct: 0.88 },
        { label: '修改润色 + 投稿',            pct: 1.00 },
      ]
    : [
        { label: 'PROSPERO 注册 Protocol',   pct: 0.08 },
        { label: '系统检索 + 去重',            pct: 0.22 },
        { label: '独立筛选 + 纳排',            pct: 0.40 },
        { label: '数据提取 + RoB 评估',        pct: 0.58 },
        { label: 'RevMan/R 统计分析',          pct: 0.75 },
        { label: '论文写作（PRISMA）',         pct: 0.90 },
        { label: '修改润色 + 投稿',            pct: 1.00 },
      ]

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500">距截止还有 <span className="font-medium text-gray-900">{totalDays}</span> 天</p>
      {milestones.map((m, i) => {
        const d = new Date(today.getTime() + m.pct * totalDays * 86400000)
        return (
          <div key={i} className="flex items-center gap-3 text-sm">
            <div className="w-2 h-2 rounded-full bg-violet-400 shrink-0" />
            <span className="text-gray-700 flex-1">{m.label}</span>
            <span className="text-gray-400 shrink-0">
              {d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
            </span>
          </div>
        )
      })}
    </div>
  )
}
