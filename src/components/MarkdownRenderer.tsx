'use client'

import React from 'react'

interface Props {
  content: string
  className?: string
}

function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-gray-700">$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-gray-700">$1</code>')
}

export default function MarkdownRenderer({ content, className = '' }: Props) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: { text: string; ordered: boolean; index?: number }[] = []
  let key = 0

  function flushList() {
    if (!listItems.length) return
    const ordered = listItems[0].ordered
    elements.push(
      ordered
        ? <ol key={key++} className="space-y-1.5 my-2 pl-1">
            {listItems.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-gray-700 leading-relaxed">
                <span className="text-primary-500 font-semibold shrink-0 w-4">{(item.index ?? i) + 1}.</span>
                <span dangerouslySetInnerHTML={{ __html: formatInline(item.text) }} />
              </li>
            ))}
          </ol>
        : <ul key={key++} className="space-y-1.5 my-2">
            {listItems.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700 leading-relaxed">
                <span className="text-primary-400 shrink-0 mt-1.5 w-1 h-1 rounded-full bg-primary-400 block" />
                <span dangerouslySetInnerHTML={{ __html: formatInline(item.text) }} />
              </li>
            ))}
          </ul>
    )
    listItems = []
  }

  for (const line of lines) {
    const t = line.trim()

    if (t.startsWith('## ')) {
      flushList()
      elements.push(
        <div key={key++} className="flex items-center gap-2 mt-5 mb-2">
          <div className="w-1 h-5 rounded-full bg-primary-500" />
          <h2 className="text-sm font-bold text-gray-900">{t.slice(3)}</h2>
        </div>
      )
    } else if (t.startsWith('### ')) {
      flushList()
      elements.push(
        <h3 key={key++} className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-1">
          {t.slice(4)}
        </h3>
      )
    } else if (t.startsWith('- ') || t.startsWith('• ')) {
      listItems.push({ text: t.slice(2), ordered: false })
    } else if (/^(\d+)\.\s/.test(t)) {
      const match = t.match(/^(\d+)\.\s(.*)/)!
      listItems.push({ text: match[2], ordered: true, index: parseInt(match[1]) - 1 })
    } else if (t === '') {
      flushList()
    } else {
      flushList()
      elements.push(
        <p key={key++} className="text-sm text-gray-700 leading-relaxed my-1.5"
           dangerouslySetInnerHTML={{ __html: formatInline(t) }} />
      )
    }
  }
  flushList()

  return <div className={`${className}`}>{elements}</div>
}
