const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

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

export interface ProsperoResult {
  registered: boolean
  count:      number
  url:        string
}

function qs(params: Record<string, string>) {
  return new URLSearchParams(params).toString()
}

export async function searchPubMed(
  query: string,
  years = 10
): Promise<SearchResult> {
  const minYear  = new Date().getFullYear() - years
  const fullQuery = `${query} AND ("${minYear}"[PDAT]:"3000"[PDAT])`

  const searchRes = await fetch(
    `${BASE}/esearch.fcgi?${qs({
      db:          'pubmed',
      term:        fullQuery,
      retmax:      '100',
      usehistory:  'y',
      retmode:     'json',
    })}`
  )
  const searchData = await searchRes.json()
  const { count, webenv, query_key } = searchData.esearchresult

  const summaryRes = await fetch(
    `${BASE}/esummary.fcgi?${qs({
      db:          'pubmed',
      query_key,
      WebEnv:      webenv,
      retmax:      '50',
      retstart:    '0',
      retmode:     'json',
    })}`
  )
  const summaryData = await summaryRes.json()

  const articles:    Article[]               = []
  const yearDist:    Record<string, number>  = {}
  const journalMap:  Record<string, number>  = {}

  const uids: string[] = summaryData.result?.uids || []
  for (const uid of uids) {
    const doc = summaryData.result[uid]
    if (!doc) continue
    const yearStr = doc.pubdate?.split(' ')[0] || '未知'
    yearDist[yearStr]  = (yearDist[yearStr]  || 0) + 1
    journalMap[doc.source] = (journalMap[doc.source] || 0) + 1
    articles.push({
      pmid:    uid,
      title:   doc.title   || '',
      authors: (doc.authors || []).slice(0, 3).map((a: { name: string }) => a.name),
      journal: doc.source  || '',
      year:    parseInt(yearStr) || 0,
      pubdate: doc.pubdate || '',
    })
  }

  const topJournals = Object.entries(journalMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }))

  return {
    totalCount:       parseInt(count) || 0,
    yearDistribution: yearDist,
    topJournals,
    articles,
    query:            fullQuery,
  }
}

export async function searchOpenAlex(query: string) {
  const res = await fetch(
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=5&filter=from_publication_date:2020-01-01`,
    { headers: { 'User-Agent': 'ResearchPlatform/1.0 (mailto:research@example.com)' } }
  )
  if (!res.ok) throw new Error('OpenAlex 请求失败')
  return res.json()
}

export async function checkProspero(query: string): Promise<ProsperoResult> {
  const url = `https://www.crd.york.ac.uk/prospero/#searchadvanced?query=${encodeURIComponent(query)}`
  return {
    registered: false,
    count:      0,
    url,
  }
}

export async function searchClinicalTrials(query: string) {
  const res = await fetch(
    `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(query)}&pageSize=5&format=json`
  )
  if (!res.ok) throw new Error('ClinicalTrials.gov 请求失败')
  return res.json()
}
