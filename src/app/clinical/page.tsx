'use client'

import { useState } from 'react'
import { Database, Loader2, ChevronRight, AlertCircle, Code2, Calendar } from 'lucide-react'
import { chatCompletion } from '@/lib/ai'
import ApiKeyBanner from '@/components/ApiKeyBanner'
import StepWizard from '@/components/StepWizard'

const STEPS = [
  { label: '选数据库' },
  { label: '研究问题' },
  { label: '统计方法' },
  { label: '代码模板' },
  { label: '期刊匹配' },
  { label: '进度规划' },
]

const DATABASES = [
  {
    id:         'mimic',
    name:       'MIMIC-IV',
    fullName:   'Medical Information Mart for Intensive Care IV',
    source:     '美国 Beth Israel Deaconess 医学中心',
    type:       'ICU 重症',
    size:       '~76,000 次 ICU 入院',
    access:     '需完成 CITI 培训（约 2-4 小时），免费',
    best_for:   ['重症监护', '机械通气', 'AKI/脓毒症', '实验室值预测'],
    difficulty: 3,
    variables:  ['生命体征', '实验室检查', '用药记录', '诊断编码', '死亡率'],
    url:        'https://physionet.org/content/mimiciv/',
  },
  {
    id:         'nhanes',
    name:       'NHANES',
    fullName:   'National Health and Nutrition Examination Survey',
    source:     '美国 CDC',
    type:       '全国横断面',
    size:       '约每2年5000人',
    access:     '完全公开，无需申请',
    best_for:   ['营养与慢病', '代谢综合征', '体检指标关联', '环境暴露'],
    difficulty: 1,
    variables:  ['体格检查', '膳食调查', '实验室检查', '问卷调查'],
    url:        'https://www.cdc.gov/nchs/nhanes/',
  },
  {
    id:         'seer',
    name:       'SEER',
    fullName:   'Surveillance, Epidemiology, and End Results',
    source:     '美国国家癌症研究所（NCI）',
    type:       '肿瘤登记',
    size:       '覆盖美国约 48% 人口',
    access:     '需签署协议，免费，约1周审批',
    best_for:   ['肿瘤流行病学', '生存分析', '外科手术方式比较', '种族差异'],
    difficulty: 2,
    variables:  ['肿瘤分期', '治疗方案', '生存时间', '死因', '人口学'],
    url:        'https://seer.cancer.gov/data/',
  },
  {
    id:         'ukbiobank',
    name:       'UK Biobank',
    fullName:   'UK Biobank',
    source:     '英国',
    type:       '前瞻性队列',
    size:       '~50万人，随访 10 年以上',
    access:     '需项目申请审批（约3-6月），可能收费',
    best_for:   ['基因-表型关联', '生活方式与慢病', '多组学分析', '影像学表型'],
    difficulty: 5,
    variables:  ['基因组', '蛋白质组', '影像', '电子病历', '可穿戴设备'],
    url:        'https://www.ukbiobank.ac.uk/',
  },
  {
    id:         'gbd',
    name:       'GBD',
    fullName:   'Global Burden of Disease',
    source:     '华盛顿大学健康指标与评估研究所（IHME）',
    type:       '全球疾病负担',
    size:       '204个国家/地区，1990-2021',
    access:     '完全公开，工具在线可用',
    best_for:   ['疾病负担趋势', '死亡率分析', '危险因素归因', '国际比较'],
    difficulty: 1,
    variables:  ['DALY', '发病率', '患病率', '死亡率', '危险因素'],
    url:        'https://www.healthdata.org/gbd',
  },
  {
    id:         'charls',
    name:       'CHARLS',
    fullName:   '中国健康与养老追踪调查',
    source:     '北京大学',
    type:       '中国老年队列',
    size:       '~1.7万人，多波随访',
    access:     '注册申请，免费，约1-2周',
    best_for:   ['老年慢病', '认知功能', '社会经济因素', '中国特色问题'],
    difficulty: 2,
    variables:  ['认知评估', '慢病自报', '功能状态', '经济状况', '生活方式'],
    url:        'https://charls.pku.edu.cn/',
  },
]

const STAT_METHODS: Record<string, { method: string; tools: string[] }[]> = {
  binary:    [
    { method: 'Logistic 回归',               tools: ['R: glm()', 'STATA: logistic', 'Python: sklearn'] },
    { method: 'Multivariable logistic',      tools: ['R: glm + car', 'STATA: logistic, adjust'] },
    { method: '倾向性评分（PSM）',             tools: ['R: MatchIt', 'STATA: teffects psmatch'] },
  ],
  survival:  [
    { method: 'Kaplan-Meier 生存曲线',        tools: ['R: survfit()', 'STATA: sts graph'] },
    { method: 'Cox 比例风险模型',              tools: ['R: coxph()', 'STATA: stcox'] },
    { method: '竞争风险模型（Fine-Gray）',     tools: ['R: cmprsk', 'STATA: stcrreg'] },
  ],
  continuous: [
    { method: '线性回归',                      tools: ['R: lm()', 'STATA: regress'] },
    { method: '限制性立方样条（RCS）',          tools: ['R: rcs() in rms', 'STATA: mkspline'] },
    { method: '广义加性模型（GAM）',            tools: ['R: mgcv::gam()', 'Python: pyGAM'] },
  ],
  mediation: [
    { method: '中介分析',                      tools: ['R: mediation包', 'STATA: medeff'] },
    { method: '机器学习特征重要性',             tools: ['R: randomForest', 'Python: xgboost'] },
  ],
}

export default function ClinicalPage() {
  const [step,       setStep]       = useState(0)
  const [dbId,       setDbId]       = useState('')
  const [question,   setQuestion]   = useState('')
  const [outcome,    setOutcome]    = useState<'binary' | 'survival' | 'continuous' | 'mediation'>('binary')
  const [analyzing,  setAnalyzing]  = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState('')
  const [codeOutput, setCodeOutput] = useState('')
  const [genCode,    setGenCode]    = useState(false)
  const [deadline,   setDeadline]   = useState('')
  const [error,      setError]      = useState('')

  const selectedDb = DATABASES.find(d => d.id === dbId)

  async function handleAnalyze() {
    if (!question.trim() || !dbId) return
    setAnalyzing(true)
    setError('')
    try {
      const text = await chatCompletion([
        {
          role: 'system',
          content: '你是一位临床研究方法学专家，擅长真实世界数据分析。回复使用中文，具体实用。',
        },
        {
          role: 'user',
          content: `我打算用 ${selectedDb?.name}（${selectedDb?.fullName}）做一个真实世界数据分析。

研究问题：${question}
结局变量类型：${outcome === 'binary' ? '二分类' : outcome === 'survival' ? '生存/时间事件' : outcome === 'continuous' ? '连续变量' : '中介/机器学习'}

数据库特点：
- 数据类型：${selectedDb?.type}
- 主要变量：${selectedDb?.variables.join('、')}
- 样本量：${selectedDb?.size}

请分析：

## 研究设计建议
什么研究设计最适合（横断面/队列/病例对照/倾向性评分）？

## 变量选择建议
主要暴露变量、结局变量、混杂变量各应如何选择？

## 统计分析流程
具体的分析步骤是什么？需要做哪些亚组分析和敏感性分析？

## 数据清洗要点
使用${selectedDb?.name}时有哪些常见的数据质量问题需要注意？

## 发表潜力评估
这个研究问题在该数据库上的新颖性如何？竞争是否激烈？`,
        },
      ], { maxTokens: 1200 })
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
      const methods = STAT_METHODS[outcome]
      const text = await chatCompletion([
        {
          role: 'system',
          content: '你是一位生物统计学家，擅长 R 和 STATA。请生成可直接运行的代码框架，加入必要注释。',
        },
        {
          role: 'user',
          content: `为以下分析生成 R 语言代码框架：

数据库：${selectedDb?.name}
研究问题：${question}
主要统计方法：${methods.map(m => m.method).join('、')}

要求：
1. 数据读入和基本清洗
2. 描述性统计（Table 1）
3. 主要分析（含模型代码）
4. 敏感性分析框架
5. 结果可视化基础代码

请用 R 语言，注释使用中文，代码用 \`\`\`r 包裹。`,
        },
      ], { maxTokens: 1500 })
      setCodeOutput(text)
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : '代码生成失败')
    } finally {
      setGenCode(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
          <Database className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">临床数据分析选题向导</h1>
          <p className="text-sm text-gray-500">真实世界数据 · 公开数据库 · 统计方法推荐</p>
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
                      <div
                        key={i}
                        className={`w-1.5 h-4 rounded-sm ${i < db.difficulty ? 'bg-amber-400' : 'bg-gray-100'}`}
                      />
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

          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
            <p className="font-medium text-gray-700 mb-1">该数据库可用变量：</p>
            <div className="flex flex-wrap gap-1">
              {selectedDb.variables.map(v => (
                <span key={v} className="badge bg-white border border-gray-200 text-gray-500">{v}</span>
              ))}
            </div>
          </div>

          <div>
            <label className="label">研究问题描述</label>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder={`例如（${selectedDb.name}）：\n${
                selectedDb.id === 'mimic' ? '• ICU 患者早期 AKI 是否影响住院死亡率？\n• 脓毒症患者血乳酸清除率与预后的关系' :
                selectedDb.id === 'nhanes' ? '• 膳食纤维摄入与代谢综合征的关联\n• 睡眠时长与血糖控制的相关性' :
                selectedDb.id === 'seer' ? '• 结直肠癌手术方式对5年生存率的影响\n• 不同种族间乳腺癌预后差异分析' :
                selectedDb.id === 'gbd' ? '• 1990-2021年全球脑卒中疾病负担趋势\n• 可改变危险因素对心血管疾病负担的贡献' :
                '描述你想研究的问题：暴露/干预 → 结局'
              }`}
              rows={4}
              className="input resize-none"
            />
          </div>

          <div>
            <label className="label">结局变量类型</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'binary',     label: '二分类',   desc: '是/否，死亡/存活' },
                { id: 'survival',   label: '生存分析', desc: '时间-事件数据' },
                { id: 'continuous', label: '连续变量', desc: '数值、评分' },
                { id: 'mediation',  label: '中介/ML',  desc: '机制探索' },
              ].map(o => (
                <button
                  key={o.id}
                  onClick={() => setOutcome(o.id as typeof outcome)}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                    outcome === o.id
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <p className="font-medium">{o.label}</p>
                  <p className="text-gray-400">{o.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {step === 1 && (
            <button
              onClick={handleAnalyze}
              disabled={!question.trim() || analyzing}
              className="btn-primary"
            >
              {analyzing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> AI 分析中…</>
                : 'AI 分析研究设计'
              }
            </button>
          )}
        </div>
      )}

      {/* Step 2: AI analysis + stat methods */}
      {step >= 2 && aiAnalysis && (
        <div className="card p-6 space-y-5">
          <h2 className="section-title">研究设计建议</h2>
          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{aiAnalysis}</div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">推荐统计方法（基于结局类型）</p>
            <div className="space-y-2">
              {STAT_METHODS[outcome].map(m => (
                <div key={m.method} className="flex items-start justify-between border border-gray-100 rounded-lg px-3 py-2.5">
                  <span className="text-sm text-gray-800 font-medium">{m.method}</span>
                  <div className="flex flex-wrap gap-1 max-w-xs justify-end">
                    {m.tools.map(t => (
                      <code key={t} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t}</code>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {step === 2 && (
            <button
              onClick={handleGenCode}
              disabled={genCode}
              className="btn-primary"
            >
              {genCode
                ? <><Loader2 className="w-4 h-4 animate-spin" /> 生成代码中…</>
                : <><Code2 className="w-4 h-4" /> 生成 R 代码框架</>
              }
            </button>
          )}
        </div>
      )}

      {/* Step 3: Code scaffold */}
      {step >= 3 && codeOutput && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title flex items-center gap-2">
            <Code2 className="w-4 h-4" /> R 代码框架
          </h2>
          <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <pre className="text-xs text-gray-100 whitespace-pre-wrap">{codeOutput}</pre>
          </div>
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
            <p className="text-xs mt-1">爬虫完成后自动接入。当前推荐常见真实世界数据分析期刊：</p>
          </div>
          <div className="space-y-2">
            {['Journal of Critical Care', 'Critical Care Medicine', 'PLOS ONE',
              'Frontiers in Medicine', 'BMC Medicine'].map(name => (
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
          {deadline && <ClinicalProgressPlan deadline={deadline} />}
        </div>
      )}
    </div>
  )
}

function ClinicalProgressPlan({ deadline }: { deadline: string }) {
  const end       = new Date(deadline)
  const today     = new Date()
  const totalDays = Math.max(1, Math.floor((end.getTime() - today.getTime()) / 86400000))

  const milestones = [
    { label: '数据库申请 & 访问权限',   pct: 0.10 },
    { label: '数据提取 & 清洗',          pct: 0.25 },
    { label: 'Table 1 描述性统计',       pct: 0.38 },
    { label: '主要分析 & 亚组分析',      pct: 0.58 },
    { label: '敏感性分析 & 可视化',      pct: 0.72 },
    { label: '论文初稿（STROBE）',       pct: 0.88 },
    { label: '修改润色 & 投稿',          pct: 1.00 },
  ]

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500">距截止还有 <span className="font-medium text-gray-900">{totalDays}</span> 天</p>
      {milestones.map((m, i) => {
        const d = new Date(today.getTime() + m.pct * totalDays * 86400000)
        return (
          <div key={i} className="flex items-center gap-3 text-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
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
