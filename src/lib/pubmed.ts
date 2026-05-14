import { chatCompletion } from './ai'
import { getApiConfig } from './storage'

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

function hasChinese(text: string) {
  return /[一-鿿]/.test(text)
}

// Strip Chinese punctuation and non-PubMed special chars from English queries
function sanitizeQuery(q: string): string {
  return q
    .replace(/[（）【】《》""''、。，；：！？]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export async function translateToEnglish(query: string): Promise<string> {
  const cfg = getApiConfig()
  if (hasChinese(query)) {
    if (!cfg) return query // no key, cannot translate
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
      // Verify result looks like English, not a fallback Chinese string
      return (cleaned && !hasChinese(cleaned)) ? cleaned : query
    } catch {
      return query
    }
  }
  // English query: sanitize but don't over-process
  return sanitizeQuery(query)
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
  // Build optimized PubMed query (translate + sanitize)
  let searchQuery = skipTranslate ? query : await translateToEnglish(query)
  const didTranslate = searchQuery !== query
  let translatedQuery: string | undefined = didTranslate ? searchQuery : undefined

  let esearch = await runEsearch(searchQuery, years)

  // Retry with first 3 words if 0 results and query is complex
  if (parseInt(esearch.count) === 0 && searchQuery.split(/\s+/).length > 6) {
    const shorter = searchQuery
      .replace(/\(|\)/g, '')            // strip parens
      .split(/\s+(?:AND|OR)\s+/i)       // split on AND/OR
      .flatMap(s => s.trim().split(/\s+/).slice(0, 2)) // first 2 words per group
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

  // Guard: if no webenv/query_key, return count only
  if (!webenv || !query_key || totalCount === 0) {
    return { totalCount, yearDistribution: {}, topJournals: [], articles: [], query: fullQuery, translatedQuery }
  }

  const summaryData = await fetchJson(
    `${BASE}/esummary.fcgi?${qs({
      db:       'pubmed',
      query_key,
      WebEnv:   webenv,
      retmax:   '50',
      retstart: '0',
      retmode:  'json',
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
    yearDist[yearStr]      = (yearDist[yearStr]      || 0) + 1
    journalMap[doc.source ?? ''] = (journalMap[doc.source ?? ''] || 0) + 1
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

// RCT-specific search
export async function searchPubMedRCT(
  query: string,
  years = 10
): Promise<{ rctCount: number; ctCount: number }> {
  const minYear = new Date().getFullYear() - years
  const searchQuery = await translateToEnglish(query)

  const rctQuery = `(${searchQuery}) AND ("${minYear}"[PDAT]:"3000"[PDAT]) AND (randomized controlled trial[pt] OR randomised controlled trial[pt] OR RCT[ti])`

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
