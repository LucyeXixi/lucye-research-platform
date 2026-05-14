'use client'

import { useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import {
  Database, Loader2, ChevronRight, Code2, Calendar,
  FileSpreadsheet, Search, BarChart2, BookOpen, ArrowRight,
  FlaskConical, Microscope, Upload, X, CheckCircle2,
} from 'lucide-react'
import { searchPubMed, buildSearchQuery, type SearchResult } from '@/lib/pubmed'
import { chatCompletion } from '@/lib/ai'
import ApiKeyBanner from '@/components/ApiKeyBanner'
import StepWizard from '@/components/StepWizard'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import ErrorBox from '@/components/ErrorBox'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ─── Databases ────────────────────────────────────────────────────────────────
const DATABASES = [
  {
    id: 'mimic', name: 'MIMIC-IV',
    fullName: 'Medical Information Mart for Intensive Care IV',
    source: '美国 Beth Israel Deaconess 医学中心', type: 'ICU 重症',
    size: '~76,000 次 ICU 入院', access: '需完成 CITI 培训（约2-4小时），免费',
    best_for: ['重症监护', '机械通气', 'AKI/脓毒症', '实验室值预测'],
    difficulty: 3,
    variables: ['生命体征', '实验室检查', '用药记录', '诊断编码', '死亡率'],
    url: 'https://physionet.org/content/mimiciv/',
    example: 'ICU 患者早期 AKI 是否影响住院死亡率？\n脓毒症患者血乳酸清除率与预后的关系',
  },
  {
    id: 'nhanes', name: 'NHANES',
    fullName: 'National Health and Nutrition Examination Survey',
    source: '美国 CDC', type: '全国横断面',
    size: '约每2年5000人', access: '完全公开，无需申请',
    best_for: ['营养与慢病', '代谢综合征', '体检指标关联', '环境暴露'],
    difficulty: 1,
    variables: ['体格检查', '膳食调查', '实验室检查', '问卷调查'],
    url: 'https://www.cdc.gov/nchs/nhanes/',
    example: '膳食纤维摄入与代谢综合征的关联\n睡眠时长与血糖控制的相关性',
  },
  {
    id: 'seer', name: 'SEER',
    fullName: 'Surveillance, Epidemiology, and End Results',
    source: '美国国家癌症研究所（NCI）', type: '肿瘤登记',
    size: '覆盖美国约 48% 人口', access: '需签署协议，免费，约1周审批',
    best_for: ['肿瘤流行病学', '生存分析', '手术方式比较', '种族差异'],
    difficulty: 2,
    variables: ['肿瘤分期', '治疗方案', '生存时间', '死因', '人口学'],
    url: 'https://seer.cancer.gov/data/',
    example: '结直肠癌手术方式对5年生存率的影响\n不同种族间乳腺癌预后差异分析',
  },
  {
    id: 'ukbiobank', name: 'UK Biobank', fullName: 'UK Biobank',
    source: '英国', type: '前瞻性队列',
    size: '~50万人，随访 10 年以上', access: '需项目申请审批（约3-6月），可能收费',
    best_for: ['基因-表型关联', '生活方式与慢病', '多组学分析', '影像学表型'],
    difficulty: 5,
    variables: ['基因组', '蛋白质组', '影像', '电子病历', '可穿戴设备'],
    url: 'https://www.ukbiobank.ac.uk/',
    example: '基因多态性与2型糖尿病风险\n体力活动与心血管事件的前瞻性关联',
  },
  {
    id: 'gbd', name: 'GBD', fullName: 'Global Burden of Disease',
    source: '华盛顿大学 IHME', type: '全球疾病负担',
    size: '204个国家/地区，1990-2021', access: '完全公开，工具在线可用',
    best_for: ['疾病负担趋势', '死亡率分析', '危险因素归因', '国际比较'],
    difficulty: 1,
    variables: ['DALY', '发病率', '患病率', '死亡率', '危险因素'],
    url: 'https://www.healthdata.org/gbd',
    example: '1990-2021年全球脑卒中疾病负担趋势\n可改变危险因素对心血管疾病负担的贡献',
  },
  {
    id: 'charls', name: 'CHARLS', fullName: '中国健康与养老追踪调查',
    source: '北京大学', type: '中国老年队列',
    size: '~1.7万人，多波随访', access: '注册申请，免费，约1-2周',
    best_for: ['老年慢病', '认知功能', '社会经济因素', '中国特色问题'],
    difficulty: 2,
    variables: ['认知评估', '慢病自报', '功能状态', '经济状况', '生活方式'],
    url: 'https://charls.pku.edu.cn/',
    example: '社会参与度与老年认知衰退的纵向关联\n慢性疼痛与抑郁症状的中介机制',
  },
]

// ─── Types ────────────────────────────────────────────────────────────────────
type PageMode   = 'choose' | 'existing' | 'database'
type OutcomeType = 'binary' | 'survival' | 'continuous' | 'mediation'

interface UploadedDataProfile {
  columns:    string[]
  rowCount:   number | null
  sheetName?: string
  warnings:   string[]
}

const EXISTING_STEPS = [
  { label: '描述数据' },
  { label: '文献背调' },
  { label: '方法推荐' },
  { label: '文章框架' },
  { label: 'R 代码' },
]

const DATABASE_STEPS = [
  { label: '选数据库' },
  { label: '研究问题' },
  { label: '统计方法' },
  { label: '代码模板' },
  { label: '进度规划' },
]

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && next === '"') {
      current += '"'
      i += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

function normalizeColumns(rawColumns: unknown[]): { columns: string[]; warnings: string[] } {
  const warnings: string[] = []
  const seen = new Map<string, number>()
  const columns = rawColumns.map((value, index) => {
    const cleaned = String(value ?? '')
      .replace(/^\uFEFF/, '')
      .replace(/^"|"$/g, '')
      .trim()
    let name = cleaned || `未命名列${index + 1}`
    if (!cleaned) warnings.push(`第 ${index + 1} 列没有列名，已临时命名为「${name}」。`)

    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    if (count > 0) {
      warnings.push(`列名「${name}」重复，已临时命名为「${name}_${count + 1}」。`)
      name = `${name}_${count + 1}`
    }
    return name
  }).filter(Boolean)

  if (columns.length > 120) warnings.push(`列数较多（${columns.length} 列），页面仅优先展示前 120 列，AI 分析会按列名摘要处理。`)
  return { columns, warnings }
}

function inferDelimitedProfile(text: string): UploadedDataProfile {
  const normalized = text.replace(/^\uFEFF/, '')
  const lines = normalized.split(/\r?\n/).filter(line => line.trim().length > 0)
  if (!lines.length) return { columns: [], rowCount: null, warnings: ['文件为空，未读取到列名。'] }

  const delimiters = ['\t', ',', ';', '|']
  const delimiter = delimiters
    .map(d => ({
      delimiter: d,
      score: lines.slice(0, 10).reduce((sum, line) => sum + parseDelimitedLine(line, d).length, 0),
    }))
    .sort((a, b) => b.score - a.score)[0].delimiter

  const sampledRows = lines.slice(0, 20).map(line => parseDelimitedLine(line, delimiter))
  const headerIndex = sampledRows
    .map((row, index) => ({ index, nonEmpty: row.filter(Boolean).length }))
    .sort((a, b) => b.nonEmpty - a.nonEmpty)[0]?.index ?? 0

  const { columns, warnings } = normalizeColumns(sampledRows[headerIndex] ?? [])
  if (headerIndex > 0) warnings.push(`前 ${headerIndex} 行看起来像说明文字，已自动从第 ${headerIndex + 1} 行识别列名。`)
  if (columns.length <= 1) warnings.push('只识别到 1 列，可能是分隔符或文件编码不规范。你仍可手动描述数据后继续。')

  return {
    columns,
    rowCount: Math.max(lines.length - headerIndex - 1, 0),
    warnings,
  }
}

function readFile(file: File, mode: 'text'): Promise<string>
function readFile(file: File, mode: 'arrayBuffer'): Promise<ArrayBuffer>
function readFile(file: File, mode: 'text' | 'arrayBuffer') {
  return new Promise<string | ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string | ArrayBuffer)
    reader.onerror = () => reject(new Error('文件读取失败，请检查文件是否损坏。'))
    if (mode === 'arrayBuffer') reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
  })
}

async function extractDataProfile(file: File): Promise<UploadedDataProfile> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['xlsx', 'xls'].includes(ext)) {
    const data = await readFile(file, 'arrayBuffer')
    const wb = XLSX.read(data, { type: 'array' })
    const sheetName = wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
    const headerIndex = rows
      .slice(0, 20)
      .map((row, index) => ({ index, nonEmpty: row.filter(cell => String(cell ?? '').trim()).length }))
      .sort((a, b) => b.nonEmpty - a.nonEmpty)[0]?.index ?? 0
    const { columns, warnings } = normalizeColumns(rows[headerIndex] ?? [])
    if (headerIndex > 0) warnings.push(`前 ${headerIndex} 行看起来像说明文字，已自动从第 ${headerIndex + 1} 行识别列名。`)
    return {
      columns,
      rowCount: Math.max(rows.length - headerIndex - 1, 0),
      sheetName,
      warnings,
    }
  }

  const text = await readFile(file, 'text')
  return inferDelimitedProfile(text)
}

function extractSuggestedDescription(text: string): string {
  const match = text.match(/##\s*可粘贴的数据描述\s*([\s\S]*?)(?=\n##\s|$)/)
  return (match?.[1] ?? text).replace(/^\s*[-:：]\s*/, '').trim()
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ClinicalPage() {
  const [mode, setMode] = useState<PageMode>('choose')

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
          <Database className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">临床数据分析</h1>
          <p className="text-sm text-gray-500">已有数据分析 · 公共数据库选题</p>
        </div>
      </div>

      <ApiKeyBanner />

      {mode === 'choose' && <ModeSelector onSelect={setMode} />}
      {mode === 'existing'  && <ExistingDataFlow  onBack={() => setMode('choose')} />}
      {mode === 'database'  && <DatabaseFlow      onBack={() => setMode('choose')} />}
    </div>
  )
}

// ─── Mode Selector ────────────────────────────────────────────────────────────
function ModeSelector({ onSelect }: { onSelect: (m: PageMode) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <button
        onClick={() => onSelect('existing')}
        className="card p-6 text-left hover:shadow-md hover:border-emerald-200 transition-all group border"
      >
        <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mb-3">
          <Microscope className="w-5 h-5 text-emerald-500" />
        </div>
        <p className="font-semibold text-gray-900">已有数据分析</p>
        <p className="text-sm text-gray-500 mt-1">
          我已收集数据（医院回顾性、问卷、随访等），需要分析方法、文章框架和代码
        </p>
        <div className="flex items-center gap-1 text-xs text-emerald-600 mt-3 font-medium">
          适合已有数据 <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </button>
      <button
        onClick={() => onSelect('database')}
        className="card p-6 text-left hover:shadow-md hover:border-primary-200 transition-all group border"
      >
        <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center mb-3">
          <FlaskConical className="w-5 h-5 text-primary-500" />
        </div>
        <p className="font-semibold text-gray-900">公共数据库选题</p>
        <p className="text-sm text-gray-500 mt-1">
          从 MIMIC-IV、NHANES、SEER、UK Biobank、GBD、CHARLS 中选库并设计研究
        </p>
        <div className="flex items-center gap-1 text-xs text-primary-600 mt-3 font-medium">
          适合开放数据 <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </button>
    </div>
  )
}

// ─── Existing Data Flow ───────────────────────────────────────────────────────
function ExistingDataFlow({ onBack }: { onBack: () => void }) {
  const [step,         setStep]         = useState(0)
  const [description,  setDescription]  = useState('')
  const [outcome,      setOutcome]      = useState<OutcomeType>('binary')
  const [csvColumns,   setCsvColumns]   = useState<string[]>([])
  const [csvRowCount,  setCsvRowCount]  = useState<number | null>(null)
  const [csvFileName,  setCsvFileName]  = useState('')
  const [csvSheetName, setCsvSheetName] = useState('')
  const [csvWarnings,  setCsvWarnings]  = useState<string[]>([])
  const [fileInsight,  setFileInsight]  = useState('')
  const [autoDetecting,   setAutoDetecting]   = useState(false)
  const [detectedOutcome, setDetectedOutcome] = useState<{
    outcomeCol: string
    outcomeType: OutcomeType
    exposureCols: string[]
    confounders: string[]
    reasoning: string
  } | null>(null)
  const [parsingFile,  setParsingFile]  = useState(false)
  const [profilingFile,setProfilingFile]= useState(false)
  const [isDragging,   setIsDragging]   = useState(false)
  const [searching,    setSearching]    = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [searchedQ,    setSearchedQ]    = useState('')
  const [analyzing,    setAnalyzing]    = useState(false)
  const [methods,      setMethods]      = useState('')
  const [framework,    setFramework]    = useState('')
  const [genCode,      setGenCode]      = useState(false)
  const [code,         setCode]         = useState('')
  const [error,        setError]        = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function resetFile() {
    setCsvColumns([])
    setCsvRowCount(null)
    setCsvFileName('')
    setCsvSheetName('')
    setCsvWarnings([])
    setFileInsight('')
    setDetectedOutcome(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const processFile = useCallback(async (file: File) => {
    setParsingFile(true)
    setError('')
    setCsvFileName(file.name)
    setFileInsight('')
    setDetectedOutcome(null)
    try {
      const profile = await extractDataProfile(file)
      setCsvColumns(profile.columns)
      setCsvRowCount(profile.rowCount)
      setCsvSheetName(profile.sheetName ?? '')
      setCsvWarnings(profile.warnings)
      if (!profile.columns.length) setError('未能自动识别列名。你可以继续手动填写数据描述，或整理表头后重新上传。')
    } catch (e) {
      setCsvColumns([])
      setCsvRowCount(null)
      setCsvSheetName('')
      setCsvWarnings([e instanceof Error ? e.message : '文件解析失败。'])
      setError(e instanceof Error ? e.message : '文件解析失败。你仍可手动填写数据描述后继续。')
    } finally {
      setParsingFile(false)
    }
  }, [])

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  async function handleSearch() {
    if (!description.trim()) return
    setSearching(true)
    setError('')
    try {
      const q = await buildSearchQuery(description, 'observational')
      const result = await searchPubMed(q, 10, true)
      setSearchResult(result)
      setSearchedQ(q)
      setStep(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : '检索失败')
    } finally {
      setSearching(false)
    }
  }

  async function handleProfileFileWithAI() {
    if (!csvColumns.length) return
    setProfilingFile(true)
    setError('')
    try {
      const columnText = csvColumns.slice(0, 160).join('、')
      const text = await chatCompletion([
        {
          role: 'system',
          content: '你是一位临床数据管理和医学统计顾问。只根据用户提供的列名做结构识别，不要假装已经看过原始数据内容。回复中文，简洁、可直接粘贴到研究描述中。',
        },
        {
          role: 'user',
          content: `请根据以下数据文件结构，帮助我识别变量含义、可能的研究设计和需要补充的信息。

文件名：${csvFileName}
工作表：${csvSheetName || '未提供'}
行数：${csvRowCount ?? '未识别'}
列数：${csvColumns.length}
解析提示：${csvWarnings.length ? csvWarnings.join('；') : '无'}
列名（最多前160列）：${columnText}

请按以下格式输出：

## 数据结构摘要
用 3-5 句话说明这份数据大概是什么类型、可能的人群/调查对象、主要变量模块。

## 变量类型初判
列出可能的结局变量、暴露变量、协变量/混杂因素、ID/时间变量。不能确定时写“可能”。

## 建议补充的信息
列出继续做临床数据分析前，用户还应该补充的 5 个关键信息。

## 可粘贴的数据描述
给出一段 120-180 字的中文数据描述草稿。`,
        },
      ], { maxTokens: 1200, temperature: 0.3 })

      setFileInsight(text)
      const prefix = `数据文件：${csvFileName}，${csvRowCount !== null ? `约 ${csvRowCount} 行，` : ''}共 ${csvColumns.length} 列。`
      const suggestedDescription = extractSuggestedDescription(text)
      setDescription(prev => {
        const trimmed = prev.trim()
        if (trimmed.includes(prefix)) return trimmed
        return `${trimmed ? `${trimmed}\n\n` : ''}${prefix}\n${suggestedDescription}`.trim()
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 识别失败，请检查 API 配置')
    } finally {
      setProfilingFile(false)
    }
  }

  async function handleAutoDetect() {
    if (!csvColumns.length) return
    setAutoDetecting(true)
    setError('')
    try {
      const text = await chatCompletion([
        {
          role: 'system',
          content: `你是临床数据分析专家。根据列名分析数据集结构，识别最可能的结局变量、
暴露/干预变量、主要混杂变量，以及结局类型。
严格按 JSON 返回，不要任何额外文字：
{"outcomeCol":"列名","outcomeType":"binary|survival|continuous|mediation",
"exposureCols":["列名1","列名2"],"confounders":["列名1","列名2","列名3"],
"reasoning":"一句话判断依据"}`,
        },
        {
          role: 'user',
          content: `数据文件：${csvFileName}
用户描述：${description || '（未填写）'}
列名（共${csvColumns.length}列）：${csvColumns.slice(0, 200).join(', ')}
${csvColumns.length > 200 ? `...另有${csvColumns.length - 200}列` : ''}`,
        },
      ], { maxTokens: 300 })

      const jsonText = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(jsonText) as {
        outcomeCol?: string
        outcomeType?: OutcomeType
        exposureCols?: string[]
        confounders?: string[]
        reasoning?: string
      }
      if (!parsed.outcomeCol || !['binary', 'survival', 'continuous', 'mediation'].includes(parsed.outcomeType || '')) {
        throw new Error('AI 返回的变量识别结果格式不完整，请重试。')
      }
      const outcomeType = parsed.outcomeType as OutcomeType
      const normalized = {
        outcomeCol:   parsed.outcomeCol,
        outcomeType,
        exposureCols: Array.isArray(parsed.exposureCols) ? parsed.exposureCols : [],
        confounders:  Array.isArray(parsed.confounders) ? parsed.confounders : [],
        reasoning:    parsed.reasoning || '根据列名结构自动判断。',
      }
      setDetectedOutcome(normalized)
      setOutcome(outcomeType)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 智能识别失败，请检查 API 配置后重试。')
    } finally {
      setAutoDetecting(false)
    }
  }

  async function handleAnalyze() {
    if (!searchResult) return
    setAnalyzing(true)
    setError('')
    try {
      const topJournals = searchResult.topJournals.slice(0, 5).map(j => j.name).join('、')
      const sampleArticles = searchResult.articles.slice(0, 5)
        .map(a => `- ${a.title} (${a.journal}, ${a.year})`).join('\n')
      const colsHint = csvColumns.length
        ? `\n已识别数据文件：${csvFileName}，${csvRowCount !== null ? `约${csvRowCount}行，` : ''}${csvColumns.length}列。列名：${csvColumns.slice(0, 180).join('、')}${fileInsight ? `\nAI文件结构识别：${fileInsight}` : ''}`
        : ''

      const text = await chatCompletion([
        { role: 'system', content: '你是一位临床研究方法学专家，擅长真实世界数据分析。回复使用中文，结构清晰，用 ## 分隔各部分，语言简洁专业。' },
        { role: 'user', content: `我有如下临床数据需要分析发表：

${description}
结局变量类型：${{ binary: '二分类（是/否、死亡/存活等）', survival: '生存/时间-事件数据', continuous: '连续变量', mediation: '中介分析或机器学习' }[outcome]}${colsHint}

PubMed 检索到的类似研究（近10年 ${searchResult.totalCount} 篇）：
主要发表期刊：${topJournals}
代表性文章：
${sampleArticles || '（无样本文章）'}

请根据类似文献的发表惯例和我的数据特点，给出：

## 推荐统计方法
最适合的主要分析方法（1-2种），说明选择理由，以及类似已发表研究是否常用此法。

## 方法学要点
关键注意事项（如混杂因素控制、缺失值处理、敏感性分析建议）。

## 文章框架建议
基于类似文献的结构，给出各部分要写什么（Introduction 3段逻辑、Methods 各节、Results 顺序、Discussion 4段结构）。

## 期刊选择建议
基于检索到的发表期刊，推荐3本投稿目标。` },
      ], { maxTokens: 1800 })

      // Split methods section and framework for display
      const frameworkMatch = text.match(/## 文章框架建议([\s\S]*)/)
      setFramework(frameworkMatch ? text : '')
      setMethods(text)
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 分析失败')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleGenCode() {
    setGenCode(true)
    setError('')
    try {
      const colsHint = csvColumns.length
        ? `数据集文件：${csvFileName}\n数据规模：${csvRowCount !== null ? `约${csvRowCount}行，` : ''}${csvColumns.length}列\n数据集列名（变量）：${csvColumns.slice(0, 180).join(', ')}\n${fileInsight ? `AI文件结构识别：${fileInsight}\n` : ''}`
        : ''
      const text = await chatCompletion([
        { role: 'system', content: '你是一位生物统计学家，擅长 R 语言医学数据分析。请生成可直接运行的 R 代码框架，注释使用中文，代码用 ```r 包裹。' },
        { role: 'user', content: `为以下分析生成完整 R 代码框架：

研究描述：${description}
结局类型：${{ binary: '二分类', survival: '生存分析', continuous: '连续变量', mediation: '中介/机器学习' }[outcome]}
${colsHint}
要求包含：
1. 数据读入与基础清洗（处理缺失值、异常值）
2. 描述性统计 Table 1（tableone 包）
3. 主要统计分析（含完整模型代码）
4. 敏感性分析框架
5. 主要结果可视化（ggplot2）
6. 简要注释说明每步目的` },
      ], { maxTokens: 2000 })
      setCode(text)
      setStep(4)
    } catch (e) {
      setError(e instanceof Error ? e.message : '代码生成失败')
    } finally {
      setGenCode(false)
    }
  }

  const yearData = searchResult
    ? Object.entries(searchResult.yearDistribution)
        .filter(([y]) => /^\d{4}$/.test(y))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([year, count]) => ({ year, count }))
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <StepWizard steps={EXISTING_STEPS} currentStep={step} onChange={setStep} />
        <button onClick={onBack} className="btn-secondary text-xs shrink-0 ml-4">← 返回</button>
      </div>

      <ErrorBox error={error} onClose={() => setError('')} />

      {/* Step 0: Describe data */}
      {step === 0 && (
        <div className="card p-6 space-y-5">
          <h2 className="section-title">描述你的数据</h2>

          <div>
            <label className="label">数据描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={`描述你已有的临床数据，例如：\n• 我有300例结直肠癌术后患者的回顾性数据，随访2年，主要变量包括手术方式、TNM分期、术后并发症、复发时间\n• 我有一个横断面调查数据，纳入500名2型糖尿病患者，测量了空腹血糖、HbA1c、体重指数、睡眠质量\n• 我有单中心ICU数据，200例脓毒症患者，关注SOFA评分与28天死亡的关系`}
              rows={5}
              className="input resize-none"
            />
          </div>

          <div>
            <label className="label">上传数据文件（可选）</label>
            <div
              onClick={() => !csvColumns.length && !parsingFile && fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragEnter={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl transition-all cursor-pointer select-none ${
                csvColumns.length
                  ? 'border-emerald-300 bg-emerald-50 cursor-default'
                  : isDragging
                  ? 'border-emerald-400 bg-emerald-50 scale-[1.01]'
                  : 'border-gray-200 hover:border-emerald-300 hover:bg-gray-50'
              }`}
            >
              {parsingFile ? (
                <div className="p-6 text-center">
                  <Loader2 className="w-7 h-7 mx-auto mb-2 text-emerald-400 animate-spin" />
                  <p className="text-sm font-medium text-gray-600">正在读取文件结构…</p>
                  <p className="text-xs text-gray-400 mt-1">会自动识别表头行、空列名和重复列名</p>
                </div>
              ) : csvColumns.length > 0 ? (
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm font-medium text-emerald-700">{csvFileName}</span>
                      <span className="text-xs text-emerald-500">
                        {csvRowCount !== null ? `约 ${csvRowCount} 行 · ` : ''}已读取 {csvColumns.length} 列
                      </span>
                      {csvSheetName && <span className="text-xs text-emerald-500">工作表：{csvSheetName}</span>}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); resetFile() }}
                      className="text-gray-400 hover:text-gray-600 p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {csvColumns.slice(0, 120).map(col => (
                      <span key={col} className="badge bg-white border border-emerald-200 text-emerald-700 text-xs">{col}</span>
                    ))}
                    {csvColumns.length > 120 && (
                      <span className="badge bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs">
                        还有 {csvColumns.length - 120} 列未显示
                      </span>
                    )}
                  </div>
                  {csvWarnings.length > 0 && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 space-y-1">
                      {csvWarnings.slice(0, 3).map(warning => <p key={warning}>{warning}</p>)}
                      {csvWarnings.length > 3 && <p>另有 {csvWarnings.length - 3} 条格式提示，AI 分析会一并参考。</p>}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleProfileFileWithAI() }}
                      disabled={profilingFile}
                      className="btn-secondary text-xs"
                    >
                      {profilingFile
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> AI 识别中…</>
                        : <><CheckCircle2 className="w-3.5 h-3.5" /> AI 识别并补全描述</>
                      }
                    </button>
                    <span className="text-xs text-gray-400">仅发送列名和结构摘要，不发送原始数据行。</span>
                  </div>
                  {fileInsight && (
                    <div className="mt-3 rounded-lg border border-emerald-100 bg-white p-3 text-sm">
                      <MarkdownRenderer content={fileInsight} />
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-center">
                  <Upload className={`w-7 h-7 mx-auto mb-2 transition-colors ${isDragging ? 'text-emerald-400' : 'text-gray-300'}`} />
                  <p className="text-sm font-medium text-gray-600">
                    {isDragging ? '松开以上传文件' : '拖拽文件到此处，或点击选择'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">支持 CSV · Excel (.xlsx/.xls) · TSV</p>
                  <p className="text-xs text-gray-300 mt-0.5">仅读取列名，数据不离开你的浏览器</p>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.tsv,.txt" onChange={handleFileInput} className="hidden" />
          </div>

          <div>
            {csvColumns.length > 0 && (
              <div className="mb-4">
                {detectedOutcome ? (
                  <div className="relative rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <button
                      type="button"
                      onClick={() => { setDetectedOutcome(null); handleAutoDetect() }}
                      disabled={autoDetecting}
                      className="absolute right-3 top-3 text-xs text-emerald-700 hover:text-emerald-800 disabled:opacity-50"
                    >
                      {autoDetecting ? '识别中…' : '重新识别'}
                    </button>
                    <div className="space-y-1.5 pr-16">
                      <p className="text-sm font-medium text-emerald-800">
                        结局变量 <span className="badge bg-white border border-emerald-300 text-emerald-700 mx-1">{detectedOutcome.outcomeCol}</span>
                        <span className="text-xs font-normal text-emerald-600">
                          已自动选中 {{
                            binary: '二分类',
                            survival: '生存分析',
                            continuous: '连续变量',
                            mediation: '中介/ML',
                          }[detectedOutcome.outcomeType]}
                        </span>
                      </p>
                      <p className="text-xs text-emerald-700">
                        暴露/干预：{detectedOutcome.exposureCols.length ? detectedOutcome.exposureCols.join('、') : '未明确识别'}
                      </p>
                      <p className="text-xs text-emerald-700">
                        主要混杂：{detectedOutcome.confounders.length ? detectedOutcome.confounders.join('、') : '未明确识别'}
                      </p>
                      <p className="text-xs text-gray-500">{detectedOutcome.reasoning}</p>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleAutoDetect}
                    disabled={autoDetecting}
                    className="btn-secondary text-xs"
                  >
                    {autoDetecting
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> AI 智能识别中…</>
                      : '✨ AI 智能识别结局变量'
                    }
                  </button>
                )}
              </div>
            )}
            <label className="label">结局变量类型</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                { id: 'binary',     label: '二分类',   desc: '死亡/存活、是/否' },
                { id: 'survival',   label: '生存分析', desc: '时间-事件数据' },
                { id: 'continuous', label: '连续变量', desc: '数值、评分、指标' },
                { id: 'mediation',  label: '中介/ML',  desc: '机制探索' },
              ] as const).map(o => (
                <button
                  key={o.id}
                  onClick={() => setOutcome(o.id)}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                    outcome === o.id
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <p className="font-medium">{o.label}</p>
                  <p className="text-gray-400 mt-0.5">{o.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSearch}
            disabled={!description.trim() || searching}
            className="btn-primary"
          >
            {searching
              ? <><Loader2 className="w-4 h-4 animate-spin" /> 检索类似研究中…</>
              : <><Search className="w-4 h-4" /> 检索类似已发表研究</>
            }
          </button>
        </div>
      )}

      {/* Step 1: PubMed results */}
      {step >= 1 && searchResult && (
        <div className="card p-6 space-y-5">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <h2 className="section-title">类似研究检索结果</h2>
            {searchedQ && (
              <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full max-w-xs truncate">
                <Search className="w-3 h-3 shrink-0" /> {searchedQ}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: '类似文献量', value: searchResult.totalCount.toLocaleString() + ' 篇', sub: 'PubMed 近10年' },
              { label: '覆盖期刊', value: searchResult.topJournals.length + ' 本', sub: '样本分布' },
              { label: '检索策略', value: '观察性研究', sub: '无 RCT 过滤' },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{s.label}</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">{s.value}</p>
                <p className="text-xs text-gray-400">{s.sub}</p>
              </div>
            ))}
          </div>

          {yearData.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">发表趋势</p>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={yearData} barSize={12}>
                  <XAxis dataKey="year" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">主要发表期刊（样本）</p>
            <div className="space-y-1.5">
              {searchResult.topJournals.slice(0, 6).map((j, i) => {
                const pct = Math.round((j.count / (searchResult.topJournals[0]?.count || 1)) * 100)
                return (
                  <div key={j.name} className="flex items-center gap-2">
                    <span className="text-xs text-gray-300 w-4 shrink-0">{i + 1}</span>
                    <span className="text-xs text-gray-700 truncate flex-1">{j.name}</span>
                    <div className="w-20 h-1.5 bg-gray-100 rounded-full shrink-0">
                      <div className="h-1.5 bg-emerald-300 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 w-6 text-right shrink-0">{j.count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {searchResult.articles.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">代表性文章（前8篇）</p>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {searchResult.articles.slice(0, 8).map(a => (
                  <div key={a.pmid} className="border border-gray-100 rounded-lg p-2.5">
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary-600 hover:underline font-medium line-clamp-2"
                    >
                      {a.title}
                    </a>
                    <p className="text-xs text-gray-400 mt-1">{a.authors.join(', ')} · {a.journal} · {a.year}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <button onClick={handleAnalyze} disabled={analyzing} className="btn-primary">
              {analyzing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> AI 分析中…</>
                : <><BarChart2 className="w-4 h-4" /> AI 分析方法与框架</>
              }
            </button>
          )}
        </div>
      )}

      {/* Step 2+3: Methods + Framework */}
      {step >= 2 && methods && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">分析方法与文章框架</h2>
          <MarkdownRenderer content={methods} />
          {step === 2 && (
            <button onClick={() => setStep(3)} className="btn-primary">
              查看文章框架 <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Step 3→4 button */}
      {step === 3 && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> 准备生成 R 代码
          </h2>
          <p className="text-sm text-gray-500">
            将根据上方推荐的统计方法{csvColumns.length > 0 ? `和你的变量名（${csvColumns.slice(0,4).join('、')}等）` : ''}生成完整可运行的 R 代码框架。
          </p>
          <button onClick={handleGenCode} disabled={genCode} className="btn-primary">
            {genCode
              ? <><Loader2 className="w-4 h-4 animate-spin" /> 生成代码中…</>
              : <><Code2 className="w-4 h-4" /> 生成 R 代码框架</>
            }
          </button>
        </div>
      )}

      {/* Step 4: R code */}
      {step >= 4 && code && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title flex items-center gap-2">
            <Code2 className="w-4 h-4" /> R 代码框架
          </h2>
          <MarkdownRenderer content={code} />
        </div>
      )}
    </div>
  )
}

// ─── Database Flow ────────────────────────────────────────────────────────────
function DatabaseFlow({ onBack }: { onBack: () => void }) {
  const [step,       setStep]       = useState(0)
  const [dbId,       setDbId]       = useState('')
  const [question,   setQuestion]   = useState('')
  const [outcome,    setOutcome]    = useState<OutcomeType>('binary')
  const [analyzing,  setAnalyzing]  = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState('')
  const [genCode,    setGenCode]    = useState(false)
  const [codeOutput, setCodeOutput] = useState('')
  const [deadline,   setDeadline]   = useState('')
  const [error,      setError]      = useState('')

  const selectedDb = DATABASES.find(d => d.id === dbId)

  async function handleAnalyze() {
    if (!question.trim() || !dbId) return
    setAnalyzing(true)
    setError('')
    try {
      const text = await chatCompletion([
        { role: 'system', content: '你是一位临床研究方法学专家，擅长真实世界数据分析。回复使用中文，结构清晰，用 ## 分隔各部分，语言简洁专业。' },
        { role: 'user', content: `我打算用 ${selectedDb?.name}（${selectedDb?.fullName}）做一个真实世界数据分析。

研究问题：${question}
结局变量类型：${{ binary: '二分类', survival: '生存/时间事件', continuous: '连续变量', mediation: '中介/机器学习' }[outcome]}

数据库特点：
- 类型：${selectedDb?.type}，样本量：${selectedDb?.size}
- 主要变量：${selectedDb?.variables.join('、')}

请分析：

## 研究设计建议
最适合的研究设计（横断面/队列/病例对照/倾向性评分），理由是什么？

## 变量选择建议
主要暴露、结局、混杂变量各如何选择？

## 统计分析流程
具体的分析步骤？必须包含哪些敏感性分析？

## 数据质量要点
使用${selectedDb?.name}时有哪些常见陷阱和数据质量问题？

## 发表潜力
这个问题在该数据库上的创新性如何？推荐目标期刊？` },
      ], { maxTokens: 1400 })
      setAiAnalysis(text)
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 分析失败')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleGenCode() {
    setGenCode(true)
    setError('')
    try {
      const outcomeLabel = { binary: '二分类', survival: '生存分析', continuous: '连续变量', mediation: '中介/机器学习' }[outcome]
      const text = await chatCompletion([
        { role: 'system', content: '你是一位生物统计学家，擅长 R 语言医学数据分析。请生成可直接运行的 R 代码框架，注释使用中文，代码用 ```r 包裹。' },
        { role: 'user', content: `为以下分析生成完整 R 代码框架：

数据库：${selectedDb?.name}
研究问题：${question}
结局类型：${outcomeLabel}

要求包含：
1. 数据读入与基础清洗（处理缺失值、${selectedDb?.id === 'mimic' ? 'ICD编码提取' : selectedDb?.id === 'seer' ? 'SEER*Stat导出处理' : '数据合并'}）
2. 描述性统计 Table 1（tableone 包）
3. 主要分析模型（含完整代码）
4. 亚组分析框架
5. 敏感性分析
6. 主要结果可视化（ggplot2）` },
      ], { maxTokens: 2000 })
      setCodeOutput(text)
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : '代码生成失败')
    } finally {
      setGenCode(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <StepWizard steps={DATABASE_STEPS} currentStep={step} onChange={setStep} />
        <button onClick={onBack} className="btn-secondary text-xs shrink-0 ml-4">← 返回</button>
      </div>

      <ErrorBox error={error} onClose={() => setError('')} />

      {/* Step 0: Database selection */}
      {step === 0 && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">选择数据库</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DATABASES.map(db => (
              <button
                key={db.id}
                onClick={() => setDbId(db.id)}
                className={`text-left p-4 rounded-xl border transition-colors ${
                  dbId === db.id
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-sm font-semibold text-gray-900">{db.name}</span>
                    <span className="ml-2 badge bg-gray-100 text-gray-500 text-xs">{db.type}</span>
                  </div>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className={`w-1.5 h-4 rounded-sm ${i < db.difficulty ? 'bg-amber-400' : 'bg-gray-100'}`} />
                    ))}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">{db.source} · {db.size}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {db.best_for.slice(0, 3).map(t => (
                    <span key={t} className="badge bg-emerald-50 text-emerald-600 text-xs">{t}</span>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">🔑 {db.access}</p>
              </button>
            ))}
          </div>
          {selectedDb && (
            <button onClick={() => setStep(1)} className="btn-primary">
              选择 {selectedDb.name} <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Step 1: Research question */}
      {step >= 1 && selectedDb && (
        <div className="card p-6 space-y-5">
          <div className="flex items-center gap-2">
            <h2 className="section-title">构建研究问题</h2>
            <span className="badge bg-emerald-100 text-emerald-700">{selectedDb.name}</span>
          </div>

          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-600 mb-1.5">该数据库可用变量：</p>
            <div className="flex flex-wrap gap-1">
              {selectedDb.variables.map(v => (
                <span key={v} className="badge bg-white border border-gray-200 text-gray-500 text-xs">{v}</span>
              ))}
            </div>
          </div>

          <div>
            <label className="label">研究问题</label>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder={`例如（${selectedDb.name}）：\n${selectedDb.example}`}
              rows={4}
              className="input resize-none"
            />
          </div>

          <div>
            <label className="label">结局变量类型</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                { id: 'binary',     label: '二分类',   desc: '是/否，死亡/存活' },
                { id: 'survival',   label: '生存分析', desc: '时间-事件数据' },
                { id: 'continuous', label: '连续变量', desc: '数值、评分' },
                { id: 'mediation',  label: '中介/ML',  desc: '机制探索' },
              ] as const).map(o => (
                <button
                  key={o.id}
                  onClick={() => setOutcome(o.id)}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                    outcome === o.id
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <p className="font-medium">{o.label}</p>
                  <p className="text-gray-400 mt-0.5">{o.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {step === 1 && (
            <button onClick={handleAnalyze} disabled={!question.trim() || analyzing} className="btn-primary">
              {analyzing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> AI 分析中…</>
                : 'AI 分析研究设计'
              }
            </button>
          )}
        </div>
      )}

      {/* Step 2: AI analysis */}
      {step >= 2 && aiAnalysis && (
        <div className="card p-6 space-y-5">
          <h2 className="section-title">研究设计建议</h2>
          <MarkdownRenderer content={aiAnalysis} />
          {step === 2 && (
            <button onClick={handleGenCode} disabled={genCode} className="btn-primary">
              {genCode
                ? <><Loader2 className="w-4 h-4 animate-spin" /> 生成代码中…</>
                : <><Code2 className="w-4 h-4" /> 生成 R 代码框架</>
              }
            </button>
          )}
        </div>
      )}

      {/* Step 3: R code */}
      {step >= 3 && codeOutput && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title flex items-center gap-2">
            <Code2 className="w-4 h-4" /> R 代码框架
          </h2>
          <MarkdownRenderer content={codeOutput} />
          {step === 3 && (
            <button onClick={() => setStep(4)} className="btn-primary">
              进度规划 <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Step 4: Progress */}
      {step >= 4 && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title flex items-center gap-2">
            <Calendar className="w-4 h-4" /> 进度规划
          </h2>
          <div>
            <label className="label">目标完成/投稿日期</label>
            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="input max-w-xs" />
          </div>
          {deadline && <ClinicalProgressPlan deadline={deadline} />}
        </div>
      )}
    </div>
  )
}

// ─── Progress Plan ─────────────────────────────────────────────────────────────
function ClinicalProgressPlan({ deadline }: { deadline: string }) {
  const end       = new Date(deadline)
  const today     = new Date()
  const totalDays = Math.max(1, Math.floor((end.getTime() - today.getTime()) / 86400000))

  const milestones = [
    { label: '数据库申请 & 访问权限', pct: 0.10 },
    { label: '数据提取 & 清洗',        pct: 0.25 },
    { label: 'Table 1 描述性统计',     pct: 0.38 },
    { label: '主要分析 & 亚组分析',    pct: 0.58 },
    { label: '敏感性分析 & 可视化',    pct: 0.72 },
    { label: '论文初稿（STROBE）',     pct: 0.88 },
    { label: '修改润色 & 投稿',        pct: 1.00 },
  ]

  return (
    <div className="space-y-2.5">
      <p className="text-sm text-gray-500">距截止还有 <span className="font-semibold text-gray-900">{totalDays}</span> 天</p>
      <div className="relative">
        <div className="absolute left-[5px] top-2 bottom-2 w-px bg-gray-100" />
        <div className="space-y-3 pl-6">
          {milestones.map((m, i) => {
            const d = new Date(today.getTime() + m.pct * totalDays * 86400000)
            return (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="absolute left-0 w-3 h-3 rounded-full border-2 border-emerald-300 bg-white" />
                <span className="text-sm text-gray-700 flex-1">{m.label}</span>
                <span className="text-xs text-gray-400 shrink-0">
                  {d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
