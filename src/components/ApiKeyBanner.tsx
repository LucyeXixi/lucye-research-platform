'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { getApiConfig } from '@/lib/storage'

export default function ApiKeyBanner() {
  const [configured, setConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    setConfigured(!!getApiConfig())
  }, [])

  if (configured === null) return null
  if (configured) return (
    <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 flex items-center gap-2 text-sm text-green-700">
      <CheckCircle2 className="w-4 h-4 shrink-0" />
      API 已配置，可以开始使用 AI 功能。
    </div>
  )

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-center justify-between gap-2 text-sm text-amber-700">
      <span className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        尚未配置 API Key，AI 分析功能暂不可用。
      </span>
      <Link href="/config" className="font-medium underline underline-offset-2 shrink-0">
        立即配置 →
      </Link>
    </div>
  )
}
