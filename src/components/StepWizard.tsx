'use client'

import clsx from 'clsx'
import { Check } from 'lucide-react'

interface Step {
  label: string
}

interface Props {
  steps:       Step[]
  currentStep: number
  onChange?:   (step: number) => void
}

export default function StepWizard({ steps, currentStep, onChange }: Props) {
  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const done    = i < currentStep
        const active  = i === currentStep
        const last    = i === steps.length - 1

        return (
          <div key={i} className="flex items-center">
            <button
              onClick={() => onChange?.(i)}
              disabled={i > currentStep}
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                done   && 'bg-primary-600 text-white cursor-pointer hover:bg-primary-700',
                active && 'bg-primary-100 text-primary-700 ring-2 ring-primary-400',
                !done && !active && 'bg-gray-100 text-gray-400 cursor-not-allowed'
              )}
            >
              {done
                ? <Check className="w-3 h-3" />
                : <span className="w-4 h-4 flex items-center justify-center rounded-full border border-current text-[10px]">{i + 1}</span>
              }
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {!last && (
              <div className={clsx('h-px w-4 mx-1', i < currentStep ? 'bg-primary-400' : 'bg-gray-200')} />
            )}
          </div>
        )
      })}
    </div>
  )
}
