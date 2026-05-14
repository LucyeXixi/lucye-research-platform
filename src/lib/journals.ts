export interface Journal {
  name:              string
  abbr:              string
  issn:              string
  if_2024:           number | null
  cas_2025?: {
    tier:   number
    top:    boolean
    review: boolean
  }
  jcr:               string | null
  review_weeks:      number | null
  apc_usd:           number | null
  open_access:       'OA' | 'Hybrid' | 'Closed'
  articles_per_year: number | null
  subject_areas:     string[]
  letpub_url:        string
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
    // journals not yet scraped — return empty
    return []
  }
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
