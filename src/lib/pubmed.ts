import { chatCompletion } from './ai'
import { getApiConfig } from './storage'

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

function hasChinese(text: string) {
  return /[一-鿿]/.test(text)
}

export async function translateToEnglish(query: string): Promise<string> {
  if (!hasChinese(query)) return query
  const cfg = getApiConfig()
  if (!cfg) return query // no key, return as-is
  try {
    const result = await chatCompletion([
      { role: 'system', content: 'You are a medical translator. Translate the Chinese medical query into concise English PubMed search terms. Return ONLY the translated terms, nothing else.' },
      { role: 'user', content: query },
    ], { maxTokens: 80 })
    return result.trim() || query
  } catch {
    return query
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

export async function searchPubMed(
  query: string,
  years = 10,
  skipTranslate = false
): Promise<SearchResult & { translatedQuery?: string }> {
  // Auto-translate Chinese to English for PubMed
  let searchQuery = query
  let translatedQuery: string | undefined
  if (!skipTranslate && hasChinese(query)) {
    const eng = await translateToEnglish(query)
    if (eng !== query) {
      searchQuery = eng
      translatedQuery = eng
    }
  }

  const minYear   = new Date().getFullYear() - years
  const fullQuery = `${searchQuery} AND ("${minYear}"[PDAT]:"3000"[PDAT])`

  const searchData = await fetchJson(
    `${BASE}/esearch.fcgi?${qs({
      db:         'pubmed',
      term:       fullQuery,
      retmax:     '100',
      usehistory: 'y',
      retmode:    'json',
    })}`
  ) as { esearchresult: { count: string; webenv?: string; query_key?: string } }

  const { count, webenv, query_key } = searchData.esearchresult
  const totalCount = parseInt(count) || 0

  // Guard: if no webenv/query_key, return count only
  if (!webenv || !query_key || totalCount === 0) {
    return { totalCount, yearDistribution: {}, topJournals: [], articles: [], query: fullQuery }
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

export async function searchClinicalTrials(query: string) {
  const res = await fetch(
    `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(query)}&pageSize=5&format=json`
  )
  if (!res.ok) throw new Error('ClinicalTrials.gov 请求失败')
  return res.json()
}
