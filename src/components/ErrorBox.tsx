'use client'

import { AlertTriangle, X } from 'lucide-react'
import { parseApiError } from '@/lib/errors'

interface Props {
  error:    string
  onClose?: () => void
}

export default function ErrorBox({ error, onClose }: Props) {
  if (!error) return null
  const { title, reason, solution } = parseApiError(error)

  return (
    <div className="rounded-xl border border-red-100 bg-red-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div className="space-y-1.5 min-w-0">
            <p className="text-sm font-semibold text-red-700">{title}</p>
            <div className="space-y-1">
              <p className="text-xs text-red-600">
                <span className="font-medium">原因：</span>{reason}
              </p>
              <p className="text-xs text-red-600">
                <span className="font-medium">解决：</span>{solution}
              </p>
            </div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-red-300 hover:text-red-500 shrink-0">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
