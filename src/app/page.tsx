import Link from 'next/link'
import { BookOpen, BarChart2, Database, ArrowRight, Zap, Shield, Globe } from 'lucide-react'
import ApiKeyBanner from '@/components/ApiKeyBanner'

const modules = [
  {
    href:        '/review',
    icon:        BookOpen,
    color:       'blue',
    title:       '综述选题',
    subtitle:    'Narrative / Scoping Review',
    desc:        '从模糊兴趣到可执行选题。识别研究空白、PICO 拆解、同类综述对比，以及精准期刊匹配。',
    tags:        ['PubMed 检索', 'AI 空白分析', 'PICO 建议', '期刊推荐'],
  },
  {
    href:        '/meta',
    icon:        BarChart2,
    color:       'violet',
    title:       'Meta 分析选题',
    subtitle:    'Meta-analysis & NMA',
    desc:        '智能推荐普通 Meta vs 网状 Meta，PROSPERO 查重，文献可行性预判，工作量估算。',
    tags:        ['普通 Meta', '网状 NMA', 'PROSPERO', '可行性评估'],
  },
  {
    href:        '/clinical',
    icon:        Database,
    color:       'emerald',
    title:       '临床数据分析',
    subtitle:    'Real-world Data Analysis',
    desc:        '导航 MIMIC、NHANES、SEER 等公开数据库，变量匹配研究问题，统计方法推荐与代码脚手架。',
    tags:        ['数据库导航', '变量匹配', '统计方法', '代码模板'],
  },
]

const colorMap: Record<string, string> = {
  blue:    'bg-blue-50 text-blue-700 border-blue-100',
  violet:  'bg-violet-50 text-violet-700 border-violet-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
}

const iconBgMap: Record<string, string> = {
  blue:    'bg-blue-100 text-blue-600',
  violet:  'bg-violet-100 text-violet-600',
  emerald: 'bg-emerald-100 text-emerald-600',
}

const tagColorMap: Record<string, string> = {
  blue:    'bg-blue-50 text-blue-600',
  violet:  'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600',
}

const features = [
  { icon: Zap,    title: '纯浏览器运行', desc: '无需后端服务器，所有数据存在本地，零隐私风险。' },
  { icon: Shield, title: '自带 API Key', desc: '支持 DeepSeek / Claude / OpenAI，成本由你掌控，推荐 DeepSeek（注册即送额度）。' },
  { icon: Globe,  title: '真实数据库检索', desc: 'PubMed、OpenAlex、ClinicalTrials.gov 实时检索，结果客观可信。' },
]

export default function HomePage() {
  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="text-center space-y-4 py-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-xs font-medium border border-primary-100">
          面向临床医学生 · 免费开源
        </div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
          Lucye的临床科研选题助手
        </h1>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto">
          从模糊想法到可执行选题，涵盖综述、Meta 分析、临床数据三大方向。
          <br />基于真实文献数据库检索 + AI 辅助分析，给你客观的选题建议。
        </p>
        <ApiKeyBanner />
      </div>

      {/* Module cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {modules.map(mod => {
          const Icon = mod.icon
          return (
            <Link
              key={mod.href}
              href={mod.href}
              className={`card p-6 hover:shadow-md transition-shadow border ${colorMap[mod.color]} group`}
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconBgMap[mod.color]}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">{mod.subtitle}</p>
                  <h2 className="text-lg font-semibold text-gray-900">{mod.title}</h2>
                  <p className="text-sm text-gray-500 mt-2 leading-relaxed">{mod.desc}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {mod.tags.map(tag => (
                    <span key={tag} className={`badge ${tagColorMap[mod.color]}`}>{tag}</span>
                  ))}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {features.map(f => {
          const Icon = f.icon
          return (
            <div key={f.title} className="flex gap-3 p-4 bg-white rounded-xl border border-gray-100">
              <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-gray-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{f.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{f.desc}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Quick start */}
      <div className="card p-6 bg-gradient-to-br from-primary-50 to-blue-50 border-primary-100">
        <h3 className="font-semibold text-gray-900 mb-3">快速开始（3 步）</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          {[
            { step: '01', title: '配置 API Key', desc: '前往「API 配置」页，选择 DeepSeek（推荐）或 Claude，填入 Key。' },
            { step: '02', title: '选择研究类型', desc: '选择综述、Meta 分析或临床数据分析，输入你的研究方向关键词。' },
            { step: '03', title: '跟随向导', desc: '系统自动检索文献数据库，AI 分析空白，推荐期刊，生成进度计划。' },
          ].map(item => (
            <div key={item.step} className="flex gap-3">
              <span className="text-2xl font-bold text-primary-200 shrink-0">{item.step}</span>
              <div>
                <p className="font-medium text-gray-900">{item.title}</p>
                <p className="text-gray-500 text-xs mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Link href="/config" className="btn-primary text-sm">
            开始配置 API Key →
          </Link>
        </div>
      </div>
    </div>
  )
}
