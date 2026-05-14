export interface Journal {
  name:              string
  abbr:              string
  issn:              string
  eissn?:            string
  if_2024:           number | null
  if_5year?:         number | null
  cas_2025?: {
    tier:   number
    top:    boolean
    review: boolean
    major?:  string
  }
  jcr:               string | null
  review_weeks:      number | null
  acceptance_rate?:  number | null
  apc_usd:           number | null
  open_access:       'OA' | 'Hybrid' | 'Closed'
  articles_per_year: number | null
  chinese_ratio?:    number | null
  self_cite_rate?:   number | null
  subject_areas:     string[]
  letpub_url:        string
  scraped_at?:        string
}

export interface JournalCandidate {
  name:      string
  fullName?: string
  issn?:     string
  eissn?:    string
}

let _cache: Journal[] | null = null

export async function loadJournals(): Promise<Journal[]> {
  if (_cache) return _cache
  try {
    const res = await fetch('/data/journals_merged.json')
    if (!res.ok) throw new Error('not found')
    _cache = await res.json()
    return _cache!
  } catch {
    return []
  }
}

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

export function findJournalMeta(journals: Journal[], item: JournalCandidate | string): Journal | null {
  const names = typeof item === 'string'
    ? [item]
    : [item.name, item.fullName].filter(Boolean) as string[]

  const issns = typeof item === 'string'
    ? []
    : [item.issn, item.eissn].map(normalizeIssn).filter(Boolean)

  if (issns.length) {
    const byIssn = journals.find(j => {
      const localIds = [normalizeIssn(j.issn), normalizeIssn(j.eissn)].filter(Boolean)
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

export function formatIF(value: number | null | undefined) {
  return value == null ? 'IF 未收录' : `IF ${value.toFixed(1)}`
}

export function formatCas(journal: Journal | null) {
  if (!journal?.cas_2025) return 'CAS 未收录'
  return `中科院 ${journal.cas_2025.tier} 区${journal.cas_2025.top ? ' Top' : ''}`
}

export function matchJournals(
  journals: Journal[],
  opts: {
    subjectAreas?: string[]
    minIF?: number
    maxIF?: number
    casTier?: number[]
    oa?: boolean
    maxAPC?: number
  }
): Journal[] {
  return journals.filter(j => {
    if (opts.minIF != null && (j.if_2024 ?? 0) < opts.minIF) return false
    if (opts.maxIF != null && (j.if_2024 ?? 999) > opts.maxIF) return false
    if (opts.casTier?.length && j.cas_2025 && !opts.casTier.includes(j.cas_2025.tier)) return false
    if (opts.oa && j.open_access !== 'OA') return false
    if (opts.maxAPC != null && j.apc_usd != null && j.apc_usd > opts.maxAPC) return false
    if (opts.subjectAreas?.length) {
      const match = opts.subjectAreas.some(sa =>
        j.subject_areas.some(jsa => jsa.toLowerCase().includes(sa.toLowerCase()))
      )
      if (!match) return false
    }
    return true
  })
}
