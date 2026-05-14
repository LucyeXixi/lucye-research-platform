'use client'

export interface NMANode {
  id:      string
  label:   string
  studies: number
}
export interface NMAEdge {
  from:    string
  to:      string
  studies: number
}

interface Props {
  nodes:   NMANode[]
  edges:   NMAEdge[]
  verdict: 'RECOMMEND' | 'CAUTION' | 'AVOID' | null
}

const VERDICT_CONFIG = {
  RECOMMEND: { label: '推荐进行',   bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: '#10b981' },
  CAUTION:   { label: '需谨慎评估', bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   dot: '#f59e0b' },
  AVOID:     { label: '不建议进行', bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     dot: '#ef4444' },
}

export default function NMANetwork({ nodes, edges, verdict }: Props) {
  if (!nodes.length) return null

  const W = 560, H = 340
  const cx = W / 2, cy = H / 2
  const r  = Math.min(cx, cy) - 60

  // Place nodes in a circle
  const pos: Record<string, { x: number; y: number }> = {}
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2
    pos[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  })

  const maxStudies = Math.max(...edges.map(e => e.studies), 1)
  const maxNodeStudies = Math.max(...nodes.map(n => n.studies), 1)

  const vc = verdict ? VERDICT_CONFIG[verdict] : null

  return (
    <div className="space-y-3">
      {vc && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${vc.bg} ${vc.border}`}>
          <span className={`w-2 h-2 rounded-full`} style={{ background: vc.dot }} />
          <span className={`text-sm font-medium ${vc.text}`}>NMA 可行性评估：{vc.label}</span>
          <span className={`ml-auto text-xs ${vc.text} opacity-70`}>{nodes.length} 个节点 · {edges.length} 条边</span>
        </div>
      )}

      <div className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {/* Edges */}
          {edges.map((edge, i) => {
            const from = pos[edge.from], to = pos[edge.to]
            if (!from || !to) return null
            const strokeW = 1.5 + (edge.studies / maxStudies) * 4
            const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2
            return (
              <g key={i}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke="#bfdbfe" strokeWidth={strokeW} strokeLinecap="round" />
                {edge.studies > 0 && (
                  <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fill="#94a3b8" fontWeight="500">
                    n={edge.studies}
                  </text>
                )}
              </g>
            )
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const p = pos[node.id]
            if (!p) return null
            const nodeR = 26 + (node.studies / maxNodeStudies) * 10
            const short = node.label.length > 8 ? node.label.slice(0, 7) + '…' : node.label
            return (
              <g key={node.id}>
                <circle cx={p.x} cy={p.y} r={nodeR} fill="#eff6ff" stroke="#3b82f6" strokeWidth={1.5} />
                <text x={p.x} y={p.y - 5} textAnchor="middle" dominantBaseline="middle"
                  fontSize="10" fill="#1e40af" fontWeight="600">{short}</text>
                {node.studies > 0 && (
                  <text x={p.x} y={p.y + 10} textAnchor="middle" dominantBaseline="middle"
                    fontSize="8" fill="#60a5fa">{node.studies} 篇</text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-400 px-1">
        <span className="flex items-center gap-1">
          <span className="w-6 h-0.5 bg-blue-200 inline-block" style={{ height: 2 }} />
          线条粗细 = 研究数量
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-blue-100 border border-blue-400 inline-block" />
          节点大小 = 相关文献量
        </span>
      </div>
    </div>
  )
}
