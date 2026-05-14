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
  const connectedIds = new Set(edges.flatMap(e => [e.from, e.to]))
  const isolatedNodes = nodes.filter(n => !connectedIds.has(n.id))
  const componentCount = countComponents(nodes, edges)
  const hasClosedLoop = edges.length >= nodes.length && componentCount === 1
  const structureLabel = componentCount === 1
    ? hasClosedLoop ? '连通网络 · 存在闭合环' : '连通星状/链状网络'
    : `不连通网络 · ${componentCount} 个子网`

  return (
    <div className="space-y-3">
      {vc && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${vc.bg} ${vc.border}`}>
          <span className={`w-2 h-2 rounded-full`} style={{ background: vc.dot }} />
          <span className={`text-sm font-medium ${vc.text}`}>NMA 可行性评估：{vc.label}</span>
          <span className={`ml-auto text-xs ${vc.text} opacity-70`}>{nodes.length} 个节点 · {edges.length} 条边</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {[
          { label: '网络结构', value: structureLabel },
          { label: '孤立节点', value: isolatedNodes.length ? isolatedNodes.map(n => n.label).join('、') : '无' },
          { label: '不一致性检验', value: hasClosedLoop ? '可考虑局部检验' : '闭合环不足' },
        ].map(item => (
          <div key={item.label} className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 min-w-0">
            <p className="text-[10px] text-gray-400">{item.label}</p>
            <p className="text-xs font-medium text-gray-700 truncate mt-0.5" title={item.value}>{item.value}</p>
          </div>
        ))}
      </div>

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
            const isIsolated = !connectedIds.has(node.id)
            const fill   = isIsolated ? '#fef2f2' : '#eff6ff'
            const stroke = isIsolated ? '#ef4444' : '#3b82f6'
            const textC  = isIsolated ? '#991b1b' : '#1e40af'
            const subC   = isIsolated ? '#fca5a5' : '#60a5fa'
            return (
              <g key={node.id}>
                <circle cx={p.x} cy={p.y} r={nodeR} fill={fill} stroke={stroke} strokeWidth={isIsolated ? 2 : 1.5}
                  strokeDasharray={isIsolated ? '4 2' : undefined} />
                <text x={p.x} y={p.y - 5} textAnchor="middle" dominantBaseline="middle"
                  fontSize="10" fill={textC} fontWeight="600">{short}</text>
                {node.studies > 0 && (
                  <text x={p.x} y={p.y + 10} textAnchor="middle" dominantBaseline="middle"
                    fontSize="8" fill={subC}>{node.studies} 篇</text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400 px-1">
        <span className="flex items-center gap-1">
          <span className="w-6 inline-block bg-blue-200 rounded" style={{ height: 2 }} />
          线条粗细 = 预估直接比较数量
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-blue-100 border border-blue-400 inline-block" />
          节点大小 = 节点证据量
        </span>
        {isolatedNodes.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-red-50 border-2 border-red-400 border-dashed inline-block" />
            红色虚线 = 孤立节点（无直接比较）
          </span>
        )}
      </div>

      {/* NMAskill verdict criteria */}
      {vc && (
        <div className={`rounded-lg border px-3 py-2.5 text-xs space-y-1 ${vc.bg} ${vc.border}`}>
          <p className={`font-semibold ${vc.text}`}>判断依据（NMA 可行性标准）</p>
          <ul className={`space-y-0.5 ${vc.text} opacity-80 list-none`}>
            <li>✓ <span className="text-emerald-700 font-medium">推荐进行</span>：网络连通 + 存在闭合环 + ≥3 个节点各有 ≥2 条边（可检验不一致性）</li>
            <li>△ <span className="text-amber-700 font-medium">需谨慎评估</span>：网络连通但为纯星状结构（仅一个中枢节点），间接比较精度有限</li>
            <li>✗ <span className="text-red-700 font-medium">不建议进行</span>：网络不连通 / 存在孤立节点 / 节点数 &lt; 3，无法进行有效 NMA</li>
          </ul>
        </div>
      )}
    </div>
  )
}

function countComponents(nodes: NMANode[], edges: NMAEdge[]) {
  if (!nodes.length) return 0
  const seen = new Set<string>()
  const graph: Record<string, string[]> = {}
  nodes.forEach(n => { graph[n.id] = [] })
  edges.forEach(e => {
    graph[e.from]?.push(e.to)
    graph[e.to]?.push(e.from)
  })

  let components = 0
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    components += 1
    const stack = [node.id]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      graph[id]?.forEach(next => {
        if (!seen.has(next)) stack.push(next)
      })
    }
  }
  return components
}
