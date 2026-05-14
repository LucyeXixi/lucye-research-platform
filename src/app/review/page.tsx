'use client'

import { useState } from 'react'
import { Search, Loader2, BookOpen, ChevronRight, BarChart2, Calendar, AlertCircle } from 'lucide-react'
import { searchPubMed, type SearchResult } from '@/lib/pubmed'
import { chatCompletion } from '@/lib/ai'
import ApiKeyBanner from '@/components/ApiKeyBanner'
import StepWizard from '@/components/StepWizard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const STEPS = [
  { label: '输入方向' },
  { label: '检索背调' },
  { label: 'AI 分析' },
  { label: '期刊匹配' },
  { label: '进度规划' },
]

const SEARCH_DEPTHS = [
  { id: 'light',  label: '轻量',  desc: 'PubMed 近5年', years: 5 },
  { id: 'medium', label: '中量',  desc: 'PubMed 近10年 + OpenAlex', years: 10 },
  { id: 'heavy',  label: '深度',  desc: 'PubMed 全库 + 多库', years: 20 },
]

export default function ReviewPage() {
  const [step,        setStep]        = useState(0)
  const [keywords,    setKeywords]    = useState('')
  const [depth,       setDepth]       = useState('medium')
  const [searching,   setSearching]   = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [analyzing,   setAnalyzing]   = useState(false)
  const [analysis,    setAnalysis]    = useState('')
  const [deadline,    setDeadline]    = useState('')
  const [error,       setError]       = useState('')

  const depthConfig = SEARCH_DEPTHS.find(d => d.id === depth)!

  async function handleSearch() {
    if (!keywords.trim()) return
    setSearching(true)
    setError('')
    try {
      const result = await searchPubMed(keywords, depthConfig.years)
      setSearchResult(result)
      setStep(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : '检索失败，请稍后重试')
    } finally {
      setSearching(false)
    }
  }

  async function handleAnalyze() {
    if (!searchResult) return
    setAnalyzing(true)
    setError('')
    try {
      const topJournals = searchResult.topJournals.map(j => `${j.name}(${j.count}篇)`).join('、')
      const yearTrend   = Object.entries(searchResult.yearDistribution)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([y, c]) => `${y}:${c}篇`)
        .join(', ')

      const text = await chatCompletion([
        {
          role: 'system',
          content: `你是一位经验丰富的临床科研指导老师，帮助医学生进行综述选题分析。回复请使用中文，结构清晰，每部分用 ## 标题分隔。`,
        },
        {
          role: 'user',
          content: `我想写一篇关于"${keywords}"的综述文章。

PubMed 检索结果（近${depthConfig.years}年）：
- 总文献量：${searchResult.totalCount} 篇
- 发表趋势：${yearTrend}
- 主要发表期刊：${topJournals}

请帮我分析：
## 1. 研究热度评估
这个方向的研究热度如何？趋势是上升还是平稳？

## 2. 潜在研究空白
根据文献量和趋势，哪些子方向可能有研究空白？请给出 3-5 个具体建议。

## 3. PICO 框架建议
针对最有潜力的方向，帮我初步拆解 PICO（P:人群 I:干预/暴露 C:对照 O:结局）。

## 4. 综述类型建议
建议做 Narrative Review、Systematic Review 还是 Scoping Review？理由是什么？

## 5. 注意事项
写这个方向综述时需要特别注意什么？`,
        },
      ], { maxTokens: 1500 })
      setAnalysis(text)
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 分析失败，请检查 API 配置')
    } finally {
      setAnalyzing(false)
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
        <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">综述选题向导</h1>
          <p className="text-sm text-gray-500">Narrative / Scoping / Systematic Review</p>
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

      {/* Step 0: Input */}
      {step === 0 && (
        <div className="card p-6 space-y-5">
          <h2 className="section-title">输入你的研究方向</h2>
          <div>
            <label className="label">关键词 / 研究主题</label>
            <textarea
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              placeholder="例如：老年人心房颤动 / atrial fibrillation elderly / 2型糖尿病与认知障碍"
              rows={3}
              className="input resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">支持中英文，可用疾病名+干预/人群组合</p>
          </div>

          <div>
            <label className="label">检索深度</label>
            <div className="grid grid-cols-3 gap-3">
              {SEARCH_DEPTHS.map(d => (
                <button
                  key={d.id}
                  onClick={() => setDepth(d.id)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    depth === d.id
                      ? 'border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  <p className="text-sm font-medium">{d.label}</p>
                  <p className="text-xs text-gray-400">{d.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSearch}
            disabled={!keywords.trim() || searching}
            className="btn-primary"
          >
            {searching
              ? <><Loader2 className="w-4 h-4 animate-spin" /> 检索中…</>
              : <><Search className="w-4 h-4" /> 开始检索</>
            }
          </button>
        </div>
      )}

      {/* Step 1: Search results */}
      {step >= 1 && searchResult && (
        <div className="card p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="section-title">检索结果</h2>
            <span className="text-xs text-gray-400">关键词：{keywords}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: '总文献量', value: searchResult.totalCount.toLocaleString() + ' 篇' },
              { label: '检索范围', value: `近 ${depthConfig.years} 年` },
              { label: '覆盖期刊', value: searchResult.topJournals.length + ' 本（样本）' },
            ].map(stat => (
              <div key={stat.label} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">{stat.label}</p>
                <p className="text-lg font-semibold text-gray-900">{stat.value}</p>
              </div>
            ))}
          </div>

          {yearData.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">发表趋势</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={yearData}>
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">主要发表期刊（样本前 8）</p>
            <div className="space-y-1.5">
              {searchResult.topJournals.map(j => (
                <div key={j.name} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 truncate max-w-xs">{j.name}</span>
                  <span className="text-gray-400 shrink-0 ml-2">{j.count} 篇</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">近期文献（前 10）</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {searchResult.articles.slice(0, 10).map(a => (
                <div key={a.pmid} className="border border-gray-100 rounded-lg p-3">
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary-600 hover:underline font-medium line-clamp-2"
                  >
                    {a.title}
                  </a>
                  <p className="text-xs text-gray-400 mt-1">
                    {a.authors.join(', ')} · {a.journal} · {a.year}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {step === 1 && (
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="btn-primary"
            >
              {analyzing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> AI 分析中…</>
                : <><BarChart2 className="w-4 h-4" /> AI 分析研究空白</>
              }
            </button>
          )}
        </div>
      )}

      {/* Step 2: AI analysis */}
      {step >= 2 && analysis && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">AI 分析结果</h2>
          <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed text-sm">
            {analysis}
          </div>
          {step === 2 && (
            <button onClick={() => setStep(3)} className="btn-primary">
              期刊匹配 <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Step 3: Journal matching (placeholder until journals.json ready) */}
      {step >= 3 && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">期刊匹配推荐</h2>
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 text-sm text-amber-700">
            <p className="font-medium">期刊数据库准备中</p>
            <p className="mt-1 text-xs">
              期刊完整数据（中科院分区、IF、版面费、审稿周期）需要 Codex 爬虫任务完成后生成
              <code className="mx-1 bg-amber-100 px-1 rounded">journals_merged.json</code>，
              并放置到 <code className="bg-amber-100 px-1 rounded">public/data/</code> 目录。
              <br />爬虫完成前，以下为基于检索结果的参考期刊：
            </p>
          </div>
          {searchResult && (
            <div className="space-y-2">
              {searchResult.topJournals.slice(0, 5).map(j => (
                <div key={j.name} className="flex items-center justify-between border border-gray-100 rounded-lg px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{j.name}</p>
                    <p className="text-xs text-gray-400">在此检索样本中发表 {j.count} 篇相关文章</p>
                  </div>
                  <a
                    href={`https://www.letpub.com.cn/index.php?page=journalapp&view=query&journal_name=${encodeURIComponent(j.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary-600 hover:underline shrink-0 ml-2"
                  >
                    查 LetPub →
                  </a>
                </div>
              ))}
            </div>
          )}
          {step === 3 && (
            <button onClick={() => setStep(4)} className="btn-primary">
              进度规划 <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Step 4: Progress planning */}
      {step >= 4 && (
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
          {deadline && (
            <ProgressPlan deadline={deadline} type="review" />
          )}
        </div>
      )}
    </div>
  )
}

function ProgressPlan({ deadline, type }: { deadline: string; type: string }) {
  const end   = new Date(deadline)
  const today = new Date()
  const totalDays = Math.max(1, Math.floor((end.getTime() - today.getTime()) / 86400000))

  const milestones = [
    { label: '文献检索与筛选',   pct: 0.15 },
    { label: '文献阅读与笔记',   pct: 0.35 },
    { label: '初稿写作',         pct: 0.65 },
    { label: '修改润色',         pct: 0.85 },
    { label: '投稿准备',         pct: 1.00 },
  ]

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">距截止日期还有 <span className="font-medium text-gray-900">{totalDays}</span> 天，建议进度安排：</p>
      <div className="space-y-2">
        {milestones.map((m, i) => {
          const d = new Date(today.getTime() + m.pct * totalDays * 86400000)
          const dateStr = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
          return (
            <div key={i} className="flex items-center gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-primary-400 shrink-0" />
              <span className="text-gray-700 flex-1">{m.label}</span>
              <span className="text-gray-400 shrink-0">{dateStr}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
