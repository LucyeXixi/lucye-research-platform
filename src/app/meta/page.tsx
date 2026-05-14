'use client'

import { useEffect, useState } from 'react'
import {
  Search, Loader2, BarChart2, ChevronRight,
  Network, GitMerge, Calendar, Lightbulb, ArrowRight,
} from 'lucide-react'
import { searchPubMed, searchPubMedRCT, buildSearchQuery, type SearchResult } from '@/lib/pubmed'
import { loadJournals, type Journal } from '@/lib/journals'
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

interface JournalRecommendation {
  name: string
  note: string
}

type TopJournal = SearchResult['topJournals'][number]

const NMA_JOURNAL_RECOMMENDATIONS: JournalRecommendation[] = [
  { name: 'BMJ',                         note: '适合大型、方法学严谨且临床意义强的 NMA' },
  { name: 'JAMA Network Open',           note: '开放获取，偏好临床问题明确、证据完整的 Meta/NMA' },
  { name: 'Annals of Internal Medicine', note: '综合临床高门槛，适合可改变实践的系统评价' },
  { name: 'Journal of Clinical Medicine', note: '中等难度，临床主题和 NMA 接受度较高' },
  { name: 'Systematic Reviews',          note: '专门发表系统评价、Meta 和方法学研究' },
]

const PAIRWISE_JOURNAL_RECOMMENDATIONS: JournalRecommendation[] = [
  { name: 'Systematic Reviews',                  note: '专注系统评价和 Meta 分析，方法学呈现空间较大' },
  { name: 'PLOS ONE',                            note: '开放获取，重视方法完整性和数据透明度' },
  { name: 'BMC Medical Research Methodology',    note: '适合方法学较强或统计处理有亮点的 Meta' },
  { name: 'Frontiers in Medicine',               note: '开放获取，临床主题覆盖宽' },
  { name: 'European Journal of Clinical Investigation', note: '适合临床问题清晰的普通 Meta' },
]

function normalizeJournalName(value?: string) {
  return (value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')
}

function normalizeIssn(value?: string) {
  return (value || '').toUpperCase().replace(/[^0-9X]/g, '')
}

function findJournalMeta(
  journals: Journal[],
  item: TopJournal | JournalRecommendation | string
): Journal | null {
  const names = typeof item === 'string'
    ? [item]
    : 'fullName' in item
      ? [item.name, item.fullName].filter(Boolean) as string[]
      : [item.name]

  const issns = typeof item === 'object' && 'issn' in item
    ? [item.issn, item.eissn].map(normalizeIssn).filter(Boolean)
    : []

  if (issns.length) {
    const byIssn = journals.find(j => {
      const localIds = [
        normalizeIssn(j.issn),
        normalizeIssn((j as Journal & { eissn?: string }).eissn),
      ].filter(Boolean)
      return localIds.some(id => issns.includes(id))
    })
    if (byIssn) return byIssn
  }

  const normalizedNames = names.map(normalizeJournalName).filter(Boolean)
  if (!normalizedNames.length) return null

  return journals.find(j => {
    const candidates = [j.name, j.abbr].map(normalizeJournalName).filter(Boolean)
    return candidates.some(candidate => normalizedNames.includes(candidate))
  }) || null
}

function formatIF(value: number | null | undefined) {
  return value == null ? 'IF 未收录' : `IF ${value.toFixed(1)}`
}

function formatCas(journal: Journal | null) {
  if (!journal?.cas_2025) return 'CAS 未收录'
  return `中科院 ${journal.cas_2025.tier} 区${journal.cas_2025.top ? ' Top' : ''}`
}

function parseNetwork(text: string): { nodes: NMANode[]; edges: NMAEdge[]; verdict: 'RECOMMEND' | 'CAUTION' | 'AVOID' | null } {
  const section = text.match(/===NETWORK===([\s\S]*?)===END===/)?.[1] ?? ''
  const nodesLine   = section.match(/NODES:\s*(.+)/)?.[1] ?? ''
  const edgesLine   = section.match(/EDGES:\s*(.+)/)?.[1] ?? ''
  const verdictLine = (section.match(/VERDICT:\s*(\w+)/)?.[1] ?? '') as string

  const nodeLabels = nodesLine.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  const nodes: NMANode[] = nodeLabels.map((label, i) => ({ id: String(i), label, studies: 0 }))
  const nodeIndex: Record<string, string> = {}
  nodes.forEach(n => { nodeIndex[n.label.toLowerCase()] = n.id })

  const edges: NMAEdge[] = []
  edgesLine.split(/[,，]/).forEach(pair => {
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
  const [broadRctCount,  setBroadRctCount]  = useState<number | null>(null)
  const [ctCount,        setCtCount]        = useState<number | null>(null)
  const [assessing,      setAssessing]      = useState(false)
  const [feasibility,    setFeasibility]    = useState('')
  const [nmaNodes,       setNmaNodes]       = useState<NMANode[]>([])
  const [nmaEdges,       setNmaEdges]       = useState<NMAEdge[]>([])
  const [nmaVerdict,     setNmaVerdict]     = useState<'RECOMMEND' | 'CAUTION' | 'AVOID' | null>(null)
  const [journalCatalog, setJournalCatalog] = useState<Journal[]>([])
  const [deadline,       setDeadline]       = useState('')
  const [error,          setError]          = useState('')

  const years = depth === 'light' ? 5 : depth === 'medium' ? 10 : 20

  useEffect(() => {
    loadJournals().then(setJournalCatalog).catch(() => setJournalCatalog([]))
  }, [])

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
    setBroadRctCount(null)
    setCtCount(null)
    setNmaNodes([])
    setNmaEdges([])
    setNmaVerdict(null)
    setFeasibility('')
    try {
      // Build PICOS-structured query first, then run searches in parallel
      const picosQuery = await buildSearchQuery(question, metaType === 'nma' ? 'nma' : 'meta')
      const [result, rct] = await Promise.all([
        searchPubMed(picosQuery, years, true),
        searchPubMedRCT(picosQuery, years, true).catch(() => ({ rctCount: null, broadRctCount: null, ctCount: null })),
      ])
      setSearchResult(result)
      setSearchedQuery(picosQuery !== question ? picosQuery : (result.translatedQuery ?? ''))
      setRctCount(rct.rctCount ?? null)
      setBroadRctCount(rct.broadRctCount ?? null)
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
      const topJournals = searchResult.topJournals.slice(0, 5).map(j => {
        const meta = findJournalMeta(journalCatalog, j)
        return `${j.fullName || j.name}${meta?.if_2024 != null ? `（IF ${meta.if_2024.toFixed(1)}）` : ''}`
      }).join('、')
      const articleSample = searchResult.articles.slice(0, 12)
        .map(a => `- ${a.title} (${a.journal}, ${a.year})`)
        .join('\n')

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
PubMed 严格 RCT 检索量（randomized controlled trial[pt]）：${rctCount !== null ? rctCount + ' 篇' : '未能获取'}
PubMed 宽泛 RCT 探索量（含 randomized/placebo 题摘词）：${broadRctCount !== null ? broadRctCount + ' 篇' : '未能获取'}
ClinicalTrials.gov 已完成试验：${ctCount !== null ? ctCount + ' 项' : '未能获取'}
主要期刊：${topJournals}
样本文献标题（用于辅助识别直接比较，不要把标题样本当作最终纳入研究）：
${articleSample || '无'}

请评估：

## 文献量解读
严格 RCT 记录为 ${rctCount !== null ? rctCount : '未知'} 篇，宽泛探索记录为 ${broadRctCount !== null ? broadRctCount : '未知'} 篇。请以严格 RCT 作为可行性主参考，并说明宽泛记录可能包含 protocol、非随机临床试验、综述或相关但非目标干预研究。做 ${isNMA ? 'NMA' : 'Meta'} 是否足够？预计全库筛选后可纳入多少篇？

${isNMA ? `## 干预节点识别
根据该研究问题，识别主要的干预措施节点（≥3个才能做NMA），以及已知的直接比较关系。

## 网络结构评估
网络是否连通？是否存在孤立节点或单研究边？是否形成闭合环？一致性假设是否有可能满足？` : `## 异质性预判
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
            {searchedQuery && (
              <details className="text-right group">
                <summary className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full cursor-pointer list-none flex items-center gap-1 hover:bg-blue-100">
                  <Search className="w-3 h-3 shrink-0" /> 查看检索式
                </summary>
                <div className="mt-1 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-2 text-left max-w-sm font-mono break-all">
                  {searchedQuery}
                </div>
              </details>
            )}
          </div>

          {/* Query too broad warning */}
          {searchResult.queryTooBoard && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <span className="text-amber-500 text-base shrink-0">⚠</span>
              <div>
                <p className="text-xs font-semibold text-amber-800">检索式可能过于宽泛</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  总文献量异常偏大，通常是检索式被截断或语法有误导致 PubMed 回退到仅日期过滤。
                  <strong>请以「可纳入 RCT」数为主要参考</strong>，或尝试修改问题描述后重新检索。
                </p>
              </div>
            </div>
          )}

          {/* ── Primary metric: RCT count ── */}
          <RctFeasibilityBadge rct={rctCount} broadRct={broadRctCount} ct={ctCount} type={metaType} />

          {/* Secondary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              {
                label: '全类型文献量',
                value: searchResult.queryTooBoard
                  ? '结果异常'
                  : searchResult.totalCount.toLocaleString() + ' 篇',
                sub: `近 ${years} 年（含综述等）`,
                warn: !!searchResult.queryTooBoard,
              },
              {
                label: '覆盖期刊（样本）',
                value: searchResult.queryTooBoard
                  ? '—'
                  : searchResult.topJournals.length
                    ? searchResult.topJournals.length + ' 本'
                    : '0 本',
                sub: searchResult.queryTooBoard ? '检索式宽泛，不可靠' : 'Top 期刊分布',
                warn: !!searchResult.queryTooBoard,
              },
              {
                label: '分析类型',
                value: metaType === 'nma' ? '网状 NMA' : '普通 Meta',
                sub: 'AI 推荐',
                warn: false,
              },
            ].map(s => (
              <div key={s.label} className={`rounded-xl p-3 ${s.warn ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <p className="text-xs text-gray-400">{s.label}</p>
                <p className={`text-lg font-bold mt-0.5 ${s.warn ? 'text-amber-600' : 'text-gray-900'}`}>{s.value}</p>
                <p className={`text-xs mt-0.5 ${s.warn ? 'text-amber-500' : 'text-gray-400'}`}>{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Trend chart — only show if data looks valid */}
          {yearData.length > 0 && !searchResult.queryTooBoard && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">发表趋势（全类型）</p>
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
          {searchResult.topJournals.length > 0 && !searchResult.queryTooBoard && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">主要发表期刊（样本）</p>
                <p className="text-[10px] text-gray-400">IF 来自本地期刊库，优先按 ISSN 匹配</p>
              </div>
              <div className="space-y-2">
                {searchResult.topJournals.map((j, i) => {
                  const pct = Math.round((j.count / searchResult.topJournals[0].count) * 100)
                  const meta = findJournalMeta(journalCatalog, j)
                  return (
                    <div key={j.name} className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-300 w-4 shrink-0">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-700 truncate">{j.fullName || j.name}</p>
                        {j.fullName && j.fullName !== j.name && (
                          <p className="text-[10px] text-gray-400 truncate">{j.name}</p>
                        )}
                      </div>
                      <div className="w-24 h-1.5 bg-gray-100 rounded-full shrink-0">
                        <div className="h-1.5 bg-violet-300 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-[10px] rounded-full px-2 py-0.5 shrink-0 ${
                        meta?.if_2024 != null ? 'bg-violet-50 text-violet-700' : 'bg-gray-50 text-gray-400'
                      }`}>
                        {formatIF(meta?.if_2024)}
                      </span>
                      <span className="hidden sm:inline text-[10px] text-gray-400 w-16 shrink-0 truncate">
                        {meta?.jcr || 'JCR —'}
                      </span>
                      <span className="text-xs text-gray-400 w-8 text-right shrink-0">{j.count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

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
          <div className="bg-violet-50 border border-violet-100 rounded-lg p-4">
            <p className="text-sm font-medium text-violet-800">期刊建议加入 IF/JCR/CAS 参考</p>
            <p className="text-xs text-violet-600 mt-1">
              IF 用于预判投稿目标层级；若本地库暂未按 ISSN 或标准刊名匹配，则显示“IF 未收录”，避免误填。
            </p>
          </div>
          <div className="space-y-2">
            {(metaType === 'nma'
              ? NMA_JOURNAL_RECOMMENDATIONS
              : PAIRWISE_JOURNAL_RECOMMENDATIONS
            ).map(({ name, note }) => {
              const meta = findJournalMeta(journalCatalog, name)
              return (
                <div key={name} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">{meta?.name || name}</p>
                      <span className={`text-[10px] rounded-full px-2 py-0.5 ${
                        meta?.if_2024 != null ? 'bg-violet-50 text-violet-700' : 'bg-gray-50 text-gray-400'
                      }`}>
                        {formatIF(meta?.if_2024)}
                      </span>
                      <span className="text-[10px] rounded-full px-2 py-0.5 bg-gray-50 text-gray-500">
                        {meta?.jcr || 'JCR 未收录'}
                      </span>
                      <span className="text-[10px] rounded-full px-2 py-0.5 bg-gray-50 text-gray-500">
                        {formatCas(meta)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{note}</p>
                  </div>
                  <a
                    href={`https://www.letpub.com.cn/index.php?page=journalapp&view=query&journal_name=${encodeURIComponent(name)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary-600 hover:underline shrink-0 ml-3"
                  >
                    查 LetPub →
                  </a>
                </div>
              )
            })}
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

// ── RCT 可行性指示器（NMAskill 阈值）────────────────────────────────────────
function RctFeasibilityBadge({
  rct, broadRct, ct, type,
}: { rct: number | null; broadRct: number | null; ct: number | null; type: MetaType }) {
  // Thresholds from NMAskill: NMA ≥20 RCTs = green, 10-19 = amber, <10 = red
  //                           Pairwise ≥10 = green, 5-9 = amber, <5 = red
  const minGreen  = type === 'nma' ? 20 : 10
  const minAmber  = type === 'nma' ? 10 : 5
  const rctLabel  = rct !== null ? rct.toLocaleString() + ' 篇' : '检索中…'
  const ctLabel   = ct  !== null ? ct.toLocaleString()  + ' 项' : '—'

  const verdict = rct === null ? 'pending'
    : rct >= minGreen ? 'green'
    : rct >= minAmber ? 'amber'
    : 'red'

  const verdictText: Record<string, string> = {
    pending: '检索中',
    green:   type === 'nma' ? `网络证据充足，可推进 NMA（≥${minGreen} RCT）` : `文献量充足，可推进 Meta（≥${minGreen} RCT）`,
    amber:   type === 'nma' ? `证据尚可，NMA 可谨慎推进（建议 ≥${minGreen} RCT）` : `文献量偏少，Meta 可做但功效有限`,
    red:     type === 'nma' ? `RCT 数量不足以支撑 NMA（需 ≥${minAmber} 篇）` : `RCT 数量不足，可行性存疑`,
  }

  const bg:   Record<string, string> = { pending: 'bg-gray-50', green: 'bg-emerald-50', amber: 'bg-amber-50', red: 'bg-red-50' }
  const text: Record<string, string> = { pending: 'text-gray-600', green: 'text-emerald-700', amber: 'text-amber-700', red: 'text-red-700' }
  const dot:  Record<string, string> = { pending: 'bg-gray-300', green: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-red-400' }

  return (
    <div className={`rounded-xl p-4 ${bg[verdict]} border border-opacity-30`}>
      <div className="flex items-start gap-3">
        <div className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${dot[verdict]}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <div>
              <span className="text-xs text-gray-500">严格 RCT 估计</span>
              <p className={`text-2xl font-bold leading-tight ${text[verdict]}`}>{rctLabel}</p>
              <span className="text-xs text-gray-400">randomized controlled trial[pt]</span>
            </div>
            {broadRct !== null && (
              <div className="border-l border-gray-200 pl-3">
                <span className="text-xs text-gray-500">宽泛探索</span>
                <p className="text-xl font-bold text-gray-700 leading-tight">{broadRct.toLocaleString()} 篇</p>
                <span className="text-xs text-gray-400">含 randomized/placebo 题摘词</span>
              </div>
            )}
            {ct !== null && ct > 0 && (
              <div className="border-l border-gray-200 pl-3">
                <span className="text-xs text-gray-500">已完成临床试验</span>
                <p className="text-xl font-bold text-gray-700 leading-tight">{ctLabel}</p>
                <span className="text-xs text-gray-400">ClinicalTrials.gov</span>
              </div>
            )}
          </div>
          {verdict !== 'pending' && (
            <p className={`text-xs mt-2 font-medium ${text[verdict]}`}>
              {verdictText[verdict]}；宽泛探索数仅用于补充筛查，不能直接视为可纳入 RCT。
            </p>
          )}
        </div>
      </div>
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
