'use client'

export type Provider = 'deepseek' | 'claude' | 'openai' | 'custom'

export interface ApiConfig {
  provider: Provider
  apiKey: string
  baseUrl?: string
  model?: string
}

export interface Project {
  id: string
  type: 'review' | 'meta' | 'clinical'
  title: string
  createdAt: string
  updatedAt: string
  currentStep: number
  data: Record<string, unknown>
  deadline?: string
}

const K = {
  PROVIDER:  'rp_provider',
  API_KEY:   'rp_api_key',
  BASE_URL:  'rp_base_url',
  MODEL:     'rp_model',
  PROJECTS:  'rp_projects',
}

export function getApiConfig(): ApiConfig | null {
  if (typeof window === 'undefined') return null
  const provider = localStorage.getItem(K.PROVIDER) as Provider
  const apiKey   = localStorage.getItem(K.API_KEY)
  if (!provider || !apiKey) return null
  return {
    provider,
    apiKey,
    baseUrl: localStorage.getItem(K.BASE_URL) || undefined,
    model:   localStorage.getItem(K.MODEL)    || undefined,
  }
}

export function saveApiConfig(cfg: ApiConfig) {
  localStorage.setItem(K.PROVIDER, cfg.provider)
  localStorage.setItem(K.API_KEY,  cfg.apiKey)
  if (cfg.baseUrl) localStorage.setItem(K.BASE_URL, cfg.baseUrl)
  else             localStorage.removeItem(K.BASE_URL)
  if (cfg.model)   localStorage.setItem(K.MODEL, cfg.model)
  else             localStorage.removeItem(K.MODEL)
}

export function clearApiConfig() {
  [K.PROVIDER, K.API_KEY, K.BASE_URL, K.MODEL].forEach(k => localStorage.removeItem(k))
}

export function getProjects(): Project[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(K.PROJECTS) || '[]')
  } catch { return [] }
}

export function saveProject(p: Project) {
  const projects = getProjects().filter(x => x.id !== p.id)
  projects.unshift({ ...p, updatedAt: new Date().toISOString() })
  localStorage.setItem(K.PROJECTS, JSON.stringify(projects))
}

export function deleteProject(id: string) {
  const projects = getProjects().filter(p => p.id !== id)
  localStorage.setItem(K.PROJECTS, JSON.stringify(projects))
}

export function newProject(type: Project['type'], title: string): Project {
  return {
    id:          crypto.randomUUID(),
    type,
    title,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    currentStep: 0,
    data:        {},
  }
}
