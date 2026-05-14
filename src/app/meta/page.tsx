'use client'

import { useState } from 'react'
import {
  Search, Loader2, BarChart2, ChevronRight,
  Network, GitMerge, Calendar, Lightbulb, ArrowRight, CheckCircle2,
} from 'lucide-react'
import { searchPubMed, searchPubMedRCT, type SearchResult } from '@/lib/pubmed'
import { chatCompletion } from '@/lib/ai'
import ApiKeyBanner from '@/components/ApiKeyBanner'
import StepWizard from '@/components/StepWizard'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import ErrorBox from '@/components/ErrorBox'
import NMANetwork, { type NMANode, type NMAEdge } from '@/components/NMANetwork'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const STEPS = [
  { label: '研究问题' },
  { label: '类型推荐' },
  { label: '检索背调' },
  { label: '可行性' },
  { label: '期刊匹配' },
  { label: '进度规划' },
]

type MetaType = 'pairwise' | 'nma' | 'unknown'
type Mode = 'choose' | 'suggest' | 'direct'

interface TopicSuggestion {
  title:     string
  type:      'PAIRWISE' | 'NMA'
  rationale: string
}

function parseNetwork(text: string): { nodes: NMANode[]; edges: NMAEdge[]; verdict: 'RECOMMEND' | 'CAUTION' | 'AVOID' | null } {
  const section = text.match(/===NETWORK===([\s\S]*?)===END===/)?.[1] ?? ''
  const nodesLine   = section.match(/NODES:\s*(.+)/)?.[1] ?? ''
  const edgesLine   = section.match(/EDGES:\s*(.+)/)?.[1] ?? ''
  const verdictLine = (section.match(/VERDICT:\s*(\w+)/)?.[1] ?? '') as string

  const nodeLabels = nodesLine.split(',').map(s => s.trim()).filter(Boolean)
  const nodes: NMANode[] = nodeLabels.map((label, i) => ({ id: String(i), label, studies: 0 }))
  const nodeIndex: Record<string, string> = {}
  nodes.forEach(n => { nodeIndex[n.label.toLowerCase()] = n.id })

  const edges: NMAEdge[] = []
  edgesLine.split(',').forEach(pair => {
    const m = pair.trim().match(/^(.+?)-(.+?):(\d+)$/)
    if (!m) return
    const [, a, b, n] = m
    const fromId = nodeIndex[a.trim().toLowerCase()]
    const toId   = nodeIndex[b.trim().toLowerCase()]
    if (fromId != null && toId != null) {
      edges.push({ from: fromId, to: toId, studies: parseInt(n) })
      nodes[parseInt(fromId)].studies += parseInt(n)
      nodes[parseInt(toId)].studies   += parseInt(n)
    }
  })

  const verdict = (['RECOMMEND', 'CAUTION', 'AVOID'].includes(verdictLine)
    ? verdictLine : null) as 'RECOMMEND' | 'CAUTION' | 'AVOID' | null

  return { nodes, edges, verdict }
}

function parseTopics(text: string): TopicSuggestion[] {
  const results: TopicSuggestion[] = []
  const blocks = text.split(/---TOPIC\s*\d+---/).filter(Boolean)
  for (const block of blocks) {
    const type      = block.match(/Type:\s*(PAIRWISE|NMA)/i)?.[1]?.toUpperCase() as 'PAIRWISE' | 'NMA'
    const title     = block.match(/Title:\s*(.+)/)?.[1]?.trim()
    const rationale = block.match(/Rationale:\s*(.+)/)?.[1]?.trim()
    if (type && title && rationale) results.push({ type, title, rationale })
  }
  return results
}

export default function MetaPage() {
  const [mode,           setMode]           = useState<Mode>('choose')
  const [step,           setStep]           = useState(0)
  const [direction,      setDirection]      = useState('')
  const [suggesting,     setSuggesting]     = useState(false)
  const [suggestions,    setSuggestions]    = useState<TopicSuggestion[]>([])
  const [question,       setQuestion]       = useState('')
  const [depth,          setDepth]          = useState('medium')
  const [recommending,   setRecommending]   = useState(false)
  const [metaType,       setMetaType]       = useState<MetaType>('unknown')
  const [typeRationale,  setTypeRationale]  = useState('')
  const [searching,      setSearching]      = useState(false)
  const [searchResult,   setSearchResult]   = useState<SearchResult | null>(null)
  const [searchedQuery,  setSearchedQuery]  = useState('')
  const [rctCount,       setRctCount]       = useState<number | null>(null)
  const [ctCount,        setCtCount]        = useState<number | null>(null)
  const [assessing,      setAssessing]      = useState(false)
  const [feasibility,    setFeasibility]    = useState('')
  const [nmaNodes,       setNmaNodes]       = useState<NMANode[]>([])
  const [nmaEdges,       setNmaEdges]       = useState<NMAEdge[]>([])
  const [nmaVerdict,     setNmaVerdict]     = useState<'RECOMMEND' | 'CAUTION' | 'AVOID' | null>(null)
  const [deadline,       setDeadline]       = useState('')
  const [error,          setError]          = useState('')

  const years = depth === 'light' ? 5 : depth === 'medium' ? 10 : 20

  // ── 帮我想选题 ───────────────────────────────────────────────────────────────
  async function handleSuggest() {
    if (!direction.trim()) return
    setSuggesting(true)
    setError('')
    try {
      const res = await searchPubMed(direction, 10)
      const topJournals = res.topJournals.slice(0, 5).map(j => j.name).join('、')
      const total = res.totalCount

      const text = await chatCompletion([
        { role: 'system', content: '你是一位循证医学专家，帮助医学生找到高质量、可发表的Meta分析选题。' },
        { role: 'user', content: `研究方向：${direction}
PubMed 相关文献量（近10年）：${total} 篇
主要发表期刊：${topJournals}

请根据该方向的文献基础，推荐 4 个具体可行的 Meta 分析选题。格式严格如下：

---TOPIC 1---
Type: PAIRWISE 或 NMA
Title: （具体完整的研究题目，中文）
Rationale: （1-2句说明为什么可做、为什么有价值）

---TOPIC 2---
Type: ...
Title: ...
Rationale: ...

---TOPIC 3---
Type: ...
Title: ...
Rationale: ...

---TOPIC 4---
Type: ...
Title: ...
Rationale: ...

注意：选题要具体（有明确的人群、干预和结局），不要过于宽泛。优先推荐近3-5年内热点但尚有空白的方向。` },
      ], { maxTokens: 1200 })

      const parsed = parseTopics(text)
      setSuggestions(parsed.length ? parsed : [])
      if (!parsed.length) setError('AI 未能生成结构化选题，请尝试换一个研究方向重试。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setSuggesting(false)
    }
  }

  function selectSuggestion(s: TopicSuggestion) {
    setQuestion(s.title)
    setMode('direct')
  }

  // ── AI 推荐 Meta 类型 ────────────────────────────────────────────────────────
  async function handleRecommendType() {
    if (!question.trim()) return
    setRecommending(true)
    setError('')
    try {
      const text = await chatCompletion([
        { role: 'system', content: '你是一位生物统计学和循证医学专家。请简洁专业地分析，回复使用中文，用 ## 分隔各部分。' },
        { role: 'user', content: `研究问题：${question}

请分析：

## 推荐类型
明确说明推荐 Pairwise Meta 分析还是网状 Meta（NMA），并说明核心理由。

## 判断依据
从三个角度说明：①比较的干预措施数量 ②是否需要间接比较 ③是否需要排名

## PICO 框架
P（人群）、I（干预/暴露）、C（对照）、O（结局）各一行说明。

## 注意事项
该选题在方法学上需要特别注意哪两点？

请在回复第一行写 [PAIRWISE] 或 [NMA]。` },
      ], { maxTokens: 800 })

      setMetaType(text.includes('[NMA]') ? 'nma' : 'pairwise')
      setTypeRationale(text.replace(/^\[(PAIRWISE|NMA)\]\s*/m, '').trim())
      setStep(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 分析失败')
    } finally {
      setRecommending(false)
    }
  }

  // ── PubMed 检索 ───────────────────────────────────────────────────────────────
  async function handleSearch() {
    setSearching(true)
    setError('')
    setRctCount(null)
    setCtCount(null)
    try {
      // 主检索 + RCT 专项检索并行
      const [result, rct] = await Promise.all([
        searchPubMed(question, years),
        searchPubMedRCT(question, years).catch(() => ({ rctCount: null, ctCount: null })),
      ])
      setSearchResult(result)
      setSearchedQuery(result.translatedQuery ?? question)
      setRctCount(rct.rctCount ?? null)
      setCtCount(rct.ctCount ?? null)
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : '检索失败')
    } finally {
      setSearching(false)
    }
  }

  // ── 可行性评估（含 NMA 网络解析）────────────────────────────────────────────
  async function handleFeasibility() {
    if (!searchResult) return
    setAssessing(true)
    setError('')
    try {
      const isNMA    = metaType === 'nma'
      const topJournals = searchResult.topJournals.slice(0, 5).map(j => j.name).join('、')

      const networkSection = isNMA ? `

最后在回复末尾附上网络图数据（严格按格式）：
===NETWORK===
NODES: 干预A, 干预B, 干预C, 安慰剂（列出你识别到的所有干预节点）
EDGES: 干预A-干预B:12, 干预A-安慰剂:20（格式：节点A-节点B:预估直接比较研究数）
VERDICT: RECOMMEND 或 CAUTION 或 AVOID
===END===` : ''

      const text = await chatCompletion([
        { role: 'system', content: '你是一位循证医学专家，评估 Meta 分析的可行性。回复使用中文，结构清晰，语言简洁专业。' },
        { role: 'user', content: `研究问题：${question}
分析类型：${isNMA ? '网状 Meta 分析（NMA）' : '普通 Pairwise Meta 分析'}
PubMed 文献量（近${years}年，全类型）：${searchResult.totalCount} 篇
PubMed RCT 专项检索量：${rctCount !== null ? rctCount + ' 篇' : '未能获取'}
ClinicalTrials.gov 已完成试验：${ctCount !== null ? ctCount + ' 项' : '未能获取'}
主要期刊：${topJournals}

请评估：

## 文献量解读
实际可纳入 RCT 约为 ${rctCount !== null ? rctCount : '未知'} 篇（PubMed 专项检索），做 ${isNMA ? 'NMA' : 'Meta'} 是否足够？预计全库筛选后可纳入多少篇？

${isNMA ? `## 干预节点识别
根据该研究问题，识别主要的干预措施节点（≥3个才能做NMA），以及已知的直接比较关系。

## 网络结构评估
网络是否连通？是否存在孤立节点？一致性假设是否有可能满足？` : `## 异质性预判
该领域研究方案（人群、干预方式、结局定义）是否容易产生高度异质性？`}

## PROSPERO 注册
是否建议注册？注册时的关键注意事项？

## 综合建议
2-3句话的综合评价，可行性打分（1-10分）。${networkSection}` },
      ], { maxTokens: 1500 })

      if (isNMA) {
        const { nodes, edges, verdict } = parseNetwork(text)
        if (nodes.length >= 2) {
          setNmaNodes(nodes)
          setNmaEdges(edges)
          setNmaVerdict(verdict)
        }
        setFeasibility(text.replace(/===NETWORK===[\s\S]*?===END===/g, '').trim())
      } else {
        setFeasibility(text)
      }
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

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
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

      {step > 0 && <StepWizard steps={STEPS} currentStep={step} onChange={setStep} />}

      <ErrorBox error={error} onClose={() => setError('')} />

      {/* ── 模式选择 ── */}
      {mode === 'choose' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => setMode('suggest')}
            className="card p-6 text-left hover:shadow-md hover:border-violet-200 transition-all group border"
          >
            <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center mb-3">
              <Lightbulb className="w-5 h-5 text-violet-500" />
            </div>
            <p className="font-semibold text-gray-900">帮我想选题</p>
            <p className="text-sm text-gray-500 mt-1">只知道大方向，让 AI 检索文献、推荐具体题目</p>
            <div className="flex items-center gap-1 text-xs text-violet-600 mt-3 font-medium">
              适合选题阶段 <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>
          <button
            onClick={() => setMode('direct')}
            className="card p-6 text-left hover:shadow-md hover:border-primary-200 transition-all group border"
          >
            <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center mb-3">
              <GitMerge className="w-5 h-5 text-primary-500" />
            </div>
            <p className="font-semibold text-gray-900">我有具体选题</p>
            <p className="text-sm text-gray-500 mt-1">已有明确研究问题，直接进行可行性分析</p>
            <div className="flex items-center gap-1 text-xs text-primary-600 mt-3 font-medium">
              适合已有方向 <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>
        </div>
      )}

      {/* ── 帮我想选题 ── */}
      {mode === 'suggest' && !suggestions.length && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-violet-500" />
            <h2 className="section-title">输入研究大方向</h2>
          </div>
          <p className="text-sm text-gray-500">
            不需要具体题目，只需告诉我你感兴趣的领域，系统会检索 PubMed 并为你推荐 4 个可行的 Meta 分析选题。
          </p>
          <div>
            <label className="label">研究大方向</label>
            <input
              type="text"
              value={direction}
              onChange={e => setDirection(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSuggest()}
              placeholder="例如：生殖医学 / 老年骨质疏松 / 儿童哮喘治疗 / 糖尿病血糖控制"
              className="input"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSuggest} disabled={!direction.trim() || suggesting} className="btn-primary">
              {suggesting ? <><Loader2 className="w-4 h-4 animate-spin" /> AI 检索推荐中…</> : <><Search className="w-4 h-4" /> 检索并推荐选题</>}
            </button>
            <button onClick={() => setMode('choose')} className="btn-secondary">返回</button>
          </div>
        </div>
      )}

      {/* ── 选题推荐结果 ── */}
      {mode === 'suggest' && suggestions.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">为你推荐的 Meta 分析选题</h2>
            <span className="text-xs text-gray-400">基于「{direction}」方向检索</span>
          </div>
          <div className="grid gap-3">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => selectSuggestion(s)}
                className="card p-5 text-left hover:shadow-md hover:border-violet-200 transition-all group border"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl font-bold text-gray-100 shrink-0">0{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {s.type === 'NMA'
                        ? <span className="badge bg-blue-50 text-blue-600 flex items-center gap-1"><Network className="w-3 h-3" /> 网状 NMA</span>
                        : <span className="badge bg-violet-50 text-violet-600 flex items-center gap-1"><GitMerge className="w-3 h-3" /> 普通 Meta</span>
                      }
                    </div>
                    <p className="text-sm font-semibold text-gray-900 leading-snug">{s.title}</p>
                    <p className="text-xs text-gray-500 mt-1.5">{s.rationale}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-violet-400 shrink-0 mt-1 transition-colors" />
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => { setSuggestions([]); }} className="btn-secondary text-xs">
            换一批推荐
          </button>
        </div>
      )}

      {/* ── Step 0：直接输入问题 ── */}
      {mode === 'direct' && step === 0 && (
        <div className="card p-6 space-y-5">
          <div className="flex items-center gap-2">
            <h2 className="section-title">描述你的研究问题</h2>
            {question && <span className="badge bg-violet-50 text-violet-600 text-xs">已从推荐填入</span>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: GitMerge, color: 'violet', title: '普通 Meta', desc: '比较两种干预（A vs B），方法成熟，入门友好' },
              { icon: Network,  color: 'blue',   title: '网状 NMA', desc: '同时比较 3 种+干预，可排名，发表影响力更高' },
            ].map(card => {
              const Icon = card.icon
              return (
                <div key={card.title} className={`border rounded-lg p-3 bg-${card.color}-50 border-${card.color}-100`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className={`w-3.5 h-3.5 text-${card.color}-500`} />
                    <span className={`text-xs font-semibold text-${card.color}-700`}>{card.title}</span>
                  </div>
                  <p className="text-xs text-gray-500">{card.desc}</p>
                </div>
              )
            })}
          </div>

          <div>
            <label className="label">研究问题</label>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder={`例如：\n• 不同降糖药物（二甲双胍/GLP-1/SGLT2）对2型糖尿病患者心血管结局的比较\n• 腹腔镜 vs 开腹手术在结直肠癌中的安全性\n• 促排卵方案对 IVF 结局影响的网状 Meta 分析`}
              rows={4}
              className="input resize-none"
            />
          </div>

          <div className="flex gap-2">
            <button onClick={handleRecommendType} disabled={!question.trim() || recommending} className="btn-primary">
              {recommending ? <><Loader2 className="w-4 h-4 animate-spin" /> AI 分析中…</> : 'AI 推荐 Meta 类型'}
            </button>
            <button onClick={() => { setMode('choose'); setQuestion(''); }} className="btn-secondary">返回</button>
          </div>
        </div>
      )}

      {/* ── Step 1：类型推荐 ── */}
      {step >= 1 && typeRationale && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="section-title">推荐分析类型</h2>
            {metaType === 'nma'
              ? <span className="badge bg-blue-100 text-blue-700 flex items-center gap-1 px-2.5 py-1">
                  <Network className="w-3.5 h-3.5" /> 网状 Meta（NMA）
                </span>
              : <span className="badge bg-violet-100 text-violet-700 flex items-center gap-1 px-2.5 py-1">
                  <GitMerge className="w-3.5 h-3.5" /> 普通 Meta 分析
                </span>
            }
          </div>

          <MarkdownRenderer content={typeRationale} />

          <div className="flex items-center gap-3 pt-1">
            <label className="label mb-0 shrink-0">检索深度</label>
            <div className="flex gap-2">
              {[
                { id: 'light', label: '轻量（近5年）' },
                { id: 'medium', label: '中量（近10年）' },
                { id: 'heavy', label: '深度（近20年）' },
              ].map(d => (
                <button key={d.id} onClick={() => setDepth(d.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                    depth === d.id ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {step === 1 && (
            <button onClick={handleSearch} disabled={searching} className="btn-primary">
              {searching ? <><Loader2 className="w-4 h-4 animate-spin" /> 检索中…</> : <><Search className="w-4 h-4" /> PubMed 检索背调</>}
            </button>
          )}
        </div>
      )}

      {/* ── Step 2：检索结果 ── */}
      {step >= 2 && searchResult && (
        <div className="card p-6 space-y-5">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <h2 className="section-title">文献检索结果</h2>
            {searchedQuery && searchedQuery !== question && (
              <div className="flex flex-col items-end gap-0.5">
                <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full max-w-xs truncate">
                  <Search className="w-3 h-3 shrink-0" />
                  检索式：{searchedQuery}
                </span>
                <span className="text-xs text-gray-400">原始输入：{question}</span>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'PubMed 文献量', value: searchResult.totalCount.toLocaleString() + ' 篇', sub: `近 ${years} 年`, color: '' },
              { label: '可纳入 RCT', value: rctCount !== null ? rctCount.toLocaleString() + ' 篇' : '检索中…', sub: 'PubMed RCT 专项', color: rctCount !== null && rctCount < 5 ? 'amber' : '' },
              { label: '已完成临床试验', value: ctCount !== null ? ctCount.toLocaleString() + ' 项' : '检索中…', sub: 'ClinicalTrials.gov', color: '' },
              { label: '覆盖期刊（样本）', value: searchResult.topJournals.length + ' 本', sub: 'Top 期刊分布', color: '' },
              { label: '分析类型', value: metaType === 'nma' ? '网状 NMA' : '普通 Meta', sub: 'AI 推荐', color: '' },
            ].map(s => (
              <div key={s.label} className={`rounded-xl p-3 ${s.color === 'amber' ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <p className="text-xs text-gray-400">{s.label}</p>
                <p className={`text-lg font-bold mt-0.5 ${s.color === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{s.value}</p>
                <p className="text-xs text-gray-400">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Trend chart */}
          {yearData.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">发表趋势</p>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={yearData} barSize={14}>
                  <XAxis dataKey="year" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Bar dataKey="count" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top journals */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">主要发表期刊（样本）</p>
            <div className="space-y-1.5">
              {searchResult.topJournals.map((j, i) => {
                const pct = Math.round((j.count / searchResult.topJournals[0].count) * 100)
                return (
                  <div key={j.name} className="flex items-center gap-2">
                    <span className="text-xs text-gray-300 w-4 shrink-0">{i + 1}</span>
                    <span className="text-xs text-gray-700 truncate flex-1">{j.name}</span>
                    <div className="w-24 h-1.5 bg-gray-100 rounded-full shrink-0">
                      <div className="h-1.5 bg-violet-300 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 w-8 text-right shrink-0">{j.count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* PROSPERO */}
          <div className="bg-gray-50 rounded-lg px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">PROSPERO 查重</p>
              <p className="text-xs text-gray-400">建议在开始前手动检索，避免与已注册 protocol 重复</p>
            </div>
            <a
              href={`https://www.crd.york.ac.uk/prospero/#searchadvanced?query=${encodeURIComponent(question)}`}
              target="_blank" rel="noopener noreferrer"
              className="btn-secondary text-xs shrink-0"
            >
              前往 PROSPERO →
            </a>
          </div>

          {step === 2 && (
            <button onClick={handleFeasibility} disabled={assessing} className="btn-primary">
              {assessing ? <><Loader2 className="w-4 h-4 animate-spin" /> AI 评估中…</> : 'AI 可行性评估'}
            </button>
          )}
        </div>
      )}

      {/* ── Step 3：可行性 + NMA 网络图 ── */}
      {step >= 3 && (feasibility || nmaNodes.length > 0) && (
        <div className="card p-6 space-y-5">
          <h2 className="section-title">可行性评估</h2>

          {/* NMA Network */}
          {metaType === 'nma' && nmaNodes.length >= 2 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">干预网络图（基于 AI 估算）</p>
              <NMANetwork nodes={nmaNodes} edges={nmaEdges} verdict={nmaVerdict} />
            </div>
          )}

          {feasibility && <MarkdownRenderer content={feasibility} />}

          {step === 3 && (
            <button onClick={() => setStep(4)} className="btn-primary">
              期刊匹配 <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* ── Step 4：期刊匹配 ── */}
      {step >= 4 && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">期刊匹配推荐</h2>
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
            <p className="text-sm font-medium text-amber-800">完整期刊数据库准备中</p>
            <p className="text-xs text-amber-600 mt-1">
              Codex 爬虫完成后自动接入中科院分区、IF、版面费、审稿周期数据。
              目前推荐参考期刊：
            </p>
          </div>
          <div className="space-y-2">
            {(metaType === 'nma'
              ? [
                  { name: 'BMJ',                              note: 'NMA 高影响力期刊，接受大型网状分析' },
                  { name: 'JAMA Network Open',                note: '开放获取，Meta/NMA 友好' },
                  { name: 'Annals of Internal Medicine',      note: '综合临床，高质量系统评价' },
                  { name: 'Journal of Clinical Medicine',     note: '中等 IF，NMA 发表率高' },
                  { name: 'Systematic Reviews',               note: '专门发表方法学和系统评价' },
                ]
              : [
                  { name: 'Systematic Reviews',               note: '专注系统评价，无 IF 门槛限制' },
                  { name: 'PLOS ONE',                         note: '开放获取，Meta 分析接受率高' },
                  { name: 'BMC Medical Research Methodology', note: '方法学期刊，适合普通 Meta' },
                  { name: 'Frontiers in Medicine',            note: '快审，开放获取，中等 IF' },
                  { name: 'European Journal of Clinical Investigation', note: '临床 Meta 友好' },
                ]
            ).map(({ name, note }) => (
              <div key={name} className="flex items-center justify-between border border-gray-100 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{name}</p>
                  <p className="text-xs text-gray-400">{note}</p>
                </div>
                <a
                  href={`https://www.letpub.com.cn/index.php?page=journalapp&view=query&journal_name=${encodeURIComponent(name)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary-600 hover:underline shrink-0 ml-3"
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

      {/* ── Step 5：进度规划 ── */}
      {step >= 5 && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title flex items-center gap-2">
            <Calendar className="w-4 h-4" /> 进度规划
          </h2>
          <div>
            <label className="label">目标投稿日期</label>
            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="input max-w-xs" />
          </div>
          {deadline && <MetaProgress deadline={deadline} type={metaType} />}
        </div>
      )}
    </div>
  )
}

function MetaProgress({ deadline, type }: { deadline: string; type: MetaType }) {
  const end       = new Date(deadline)
  const today     = new Date()
  const totalDays = Math.max(1, Math.floor((end.getTime() - today.getTime()) / 86400000))

  const milestones = type === 'nma'
    ? [
        { label: 'PROSPERO 注册 Protocol',     pct: 0.08 },
        { label: '系统检索 + 去重',              pct: 0.20 },
        { label: '独立筛选 + 纳排',              pct: 0.38 },
        { label: '数据提取 + RoB 2.0 评估',     pct: 0.55 },
        { label: 'STATA/R 网状 Meta 统计分析',  pct: 0.72 },
        { label: '论文写作（PRISMA-NMA）',       pct: 0.88 },
        { label: '修改润色 + 投稿',              pct: 1.00 },
      ]
    : [
        { label: 'PROSPERO 注册 Protocol',     pct: 0.08 },
        { label: '系统检索 + 去重',              pct: 0.22 },
        { label: '独立筛选 + 纳排',              pct: 0.40 },
        { label: '数据提取 + RoB 2.0 评估',     pct: 0.58 },
        { label: 'RevMan/R 统计分析',           pct: 0.75 },
        { label: '论文写作（PRISMA）',           pct: 0.90 },
        { label: '修改润色 + 投稿',              pct: 1.00 },
      ]

  return (
    <div className="space-y-2.5">
      <p className="text-sm text-gray-500">距截止还有 <span className="font-semibold text-gray-900">{totalDays}</span> 天，建议节点：</p>
      <div className="relative">
        <div className="absolute left-[5px] top-2 bottom-2 w-px bg-gray-100" />
        <div className="space-y-3 pl-6">
          {milestones.map((m, i) => {
            const d = new Date(today.getTime() + m.pct * totalDays * 86400000)
            const isPast = d < today
            return (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="absolute left-0 w-3 h-3 rounded-full border-2 border-violet-300 bg-white" style={{ marginTop: 2 }} />
                <span className={`text-sm flex-1 ${isPast ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{m.label}</span>
                <span className="text-xs text-gray-400 shrink-0">
                  {d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </span>
                {i === milestones.findIndex(ms => new Date(today.getTime() + ms.pct * totalDays * 86400000) >= today) && (
                  <span className="badge bg-violet-50 text-violet-600 text-xs shrink-0">当前阶段</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
