import { chatCompletion } from './ai'
import { getApiConfig } from './storage'

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

function hasChinese(text: string) {
  return /[一-鿿]/.test(text)
}

function sanitizeQuery(q: string): string {
  return q
    .replace(/[（）【】《》""''、。，；：！？]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// General translation (used by review page)
export async function translateToEnglish(query: string): Promise<string> {
  const cfg = getApiConfig()
  if (hasChinese(query)) {
    if (!cfg) return query
    try {
      const result = await chatCompletion([
        {
          role: 'system',
          content: `You are a PubMed search expert. Extract key medical terms from the research question and format as a PubMed Boolean search string.

Example input: 腹腔镜与开腹手术在结直肠癌中安全性的Meta分析
Example output: (laparoscopic OR laparoscopy) AND (colorectal cancer OR colon cancer) AND (safety OR complication OR morbidity)

Rules: use 3-5 concept groups, each group has 1-3 synonyms with OR, groups joined with AND. Return ONLY the search string, no explanation.`,
        },
        { role: 'user', content: query },
      ], { maxTokens: 120 })
      const cleaned = result.trim()
      return (cleaned && !hasChinese(cleaned)) ? cleaned : query
    } catch {
      return query
    }
  }
  return sanitizeQuery(query)
}

// PICOS-structured query builder — for Meta/NMA and observational searches
export async function buildSearchQuery(
  question: string,
  type: 'meta' | 'nma' | 'observational' = 'meta'
): Promise<string> {
  const cfg = getApiConfig()
  const fallback = sanitizeQuery(question)
  if (!cfg) return fallback

  const systemPrompts: Record<typeof type, string> = {
    meta: `You are a PubMed search expert for systematic reviews and pairwise meta-analyses. Build a PubMed Boolean search string using PICOS structure.

Structure: (Population terms) AND (Intervention/Comparator terms) AND (randomized OR randomised OR placebo OR "clinical trial"[pt])

Rules:
- P block: disease/condition + MeSH term + abbreviation if common (2-3 terms)
- I/C block: ALL interventions being compared + key synonyms (most important block)
- NEVER include outcome terms — they are too restrictive and miss RCTs
- Always end with the RCT filter shown above
- Return ONLY the search string, no explanation`,

    nma: `You are a PubMed search expert for network meta-analyses. Build a PubMed Boolean search string using PICOS structure.

Structure: (Population terms) AND (Intervention1 OR Intervention2 OR Intervention3 OR ...) AND (randomized OR randomised OR placebo OR "clinical trial"[pt])

Rules:
- P block: disease/condition name + MeSH synonym (keep concise, 2-3 terms max)
- I block: list ALL interventions in the comparison network + 1-2 synonyms each — this is the critical block for NMA coverage
- NEVER include outcome terms
- The RCT filter is mandatory
- Return ONLY the search string, no explanation`,

    observational: `You are a PubMed search expert for real-world and observational studies. Build a PubMed Boolean search string.

Structure: (Disease/Condition terms) AND (Exposure/Treatment terms OR outcome terms)

Rules:
- Extract the main clinical condition + key exposure or outcome
- Do NOT add an RCT filter — this is for observational/real-world data studies
- Keep to 2 concept blocks maximum to avoid over-restriction
- Return ONLY the search string, no explanation`,
  }

  try {
    const result = await chatCompletion([
      { role: 'system', content: systemPrompts[type] },
      { role: 'user', content: question },
    ], { maxTokens: 160 })
    const cleaned = result.trim()
    return (cleaned && !hasChinese(cleaned)) ? cleaned : fallback
  } catch {
    return fallback
  }
}

export interface Article {
  pmid:     string
  title:    string
  authors:  string[]
  journal:  string
  year:     number
  pubdate:  string
}

export interface SearchResult {
  totalCount:       number
  yearDistribution: Record<string, number>
  topJournals:      { name: string; count: number }[]
  articles:         Article[]
  query:            string
}

function qs(params: Record<string, string | undefined>) {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v != null) p.set(k, v) })
  return p.toString()
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`PubMed API 返回 ${res.status}`)
  const text = await res.text()
  if (!text.trim()) throw new Error('PubMed API 返回了空响应，请稍后重试')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('PubMed API 响应解析失败，请稍后重试')
  }
}

async function runEsearch(term: string, years: number) {
  const minYear = new Date().getFullYear() - years
  const fullQuery = `${term} AND ("${minYear}"[PDAT]:"3000"[PDAT])`
  const data = await fetchJson(
    `${BASE}/esearch.fcgi?${qs({
      db: 'pubmed', term: fullQuery, retmax: '100', usehistory: 'y', retmode: 'json',
    })}`
  ) as { esearchresult: { count: string; webenv?: string; query_key?: string } }
  return { ...data.esearchresult, fullQuery }
}

export async function searchPubMed(
  query: string,
  years = 10,
  skipTranslate = false
): Promise<SearchResult & { translatedQuery?: string }> {
  let searchQuery = skipTranslate ? query : await translateToEnglish(query)
  const didTranslate = searchQuery !== query
  let translatedQuery: string | undefined = didTranslate ? searchQuery : undefined

  let esearch = await runEsearch(searchQuery, years)

  // Retry with simplified keywords if 0 results and query is complex
  if (parseInt(esearch.count) === 0 && searchQuery.split(/\s+/).length > 6) {
    const shorter = searchQuery
      .replace(/\(|\)/g, '')
      .split(/\s+(?:AND|OR)\s+/i)
      .flatMap(s => s.trim().split(/\s+/).slice(0, 2))
      .filter(Boolean)
      .slice(0, 6)
      .join(' ')
    const retry = await runEsearch(shorter, years)
    if (parseInt(retry.count) > 0) {
      esearch = retry
      searchQuery = shorter
      translatedQuery = shorter
    }
  }

  const { count, webenv, query_key, fullQuery } = esearch
  const totalCount = parseInt(count) || 0

  if (!webenv || !query_key || totalCount === 0) {
    return { totalCount, yearDistribution: {}, topJournals: [], articles: [], query: fullQuery, translatedQuery }
  }

  const summaryData = await fetchJson(
    `${BASE}/esummary.fcgi?${qs({
      db: 'pubmed', query_key, WebEnv: webenv, retmax: '50', retstart: '0', retmode: 'json',
    })}`
  ) as { result?: Record<string, unknown> & { uids?: string[] } }

  const articles:   Article[]              = []
  const yearDist:   Record<string, number> = {}
  const journalMap: Record<string, number> = {}

  const uids: string[] = summaryData.result?.uids || []
  for (const uid of uids) {
    const doc = summaryData.result?.[uid] as {
      pubdate?: string; title?: string; source?: string
      authors?: { name: string }[]
    } | undefined
    if (!doc || typeof doc !== 'object' || !doc.title) continue
    const yearStr = doc.pubdate?.split(' ')[0] || '未知'
    yearDist[yearStr]                   = (yearDist[yearStr]      || 0) + 1
    journalMap[doc.source ?? '']        = (journalMap[doc.source ?? ''] || 0) + 1
    articles.push({
      pmid:    uid,
      title:   doc.title   || '',
      authors: (doc.authors || []).slice(0, 3).map(a => a.name),
      journal: doc.source  || '',
      year:    parseInt(yearStr) || 0,
      pubdate: doc.pubdate || '',
    })
  }

  const topJournals = Object.entries(journalMap)
    .filter(([name]) => name.trim())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }))

  return { totalCount, yearDistribution: yearDist, topJournals, articles, query: fullQuery, translatedQuery }
}

// RCT-specific search — accepts pre-built query via skipTranslate
export async function searchPubMedRCT(
  query: string,
  years = 10,
  skipTranslate = false
): Promise<{ rctCount: number; ctCount: number }> {
  const minYear = new Date().getFullYear() - years
  const searchQuery = skipTranslate ? query : await translateToEnglish(query)

  const rctQuery = `(${searchQuery}) AND ("${minYear}"[PDAT]:"3000"[PDAT]) AND (randomized controlled trial[pt] OR randomised controlled trial[pt] OR randomized[tiab] OR randomised[tiab] OR placebo[tiab])`

  const [rctData, ctData] = await Promise.allSettled([
    fetchJson(`${BASE}/esearch.fcgi?${qs({ db: 'pubmed', term: rctQuery, retmax: '0', retmode: 'json' })}`),
    fetch(`https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(searchQuery)}&filter.overallStatus=COMPLETED&pageSize=1&format=json`)
      .then(r => r.ok ? r.json() : { totalCount: 0 }),
  ])

  const rctCount = rctData.status === 'fulfilled'
    ? parseInt((rctData.value as { esearchresult: { count: string } }).esearchresult?.count || '0')
    : 0

  const ctCount = ctData.status === 'fulfilled'
    ? ((ctData.value as { totalCount?: number }).totalCount ?? 0)
    : 0

  return { rctCount, ctCount }
}

export async function searchClinicalTrials(query: string) {
  const res = await fetch(
    `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(query)}&pageSize=5&format=json`
  )
  if (!res.ok) throw new Error('ClinicalTrials.gov 请求失败')
  return res.json()
}
