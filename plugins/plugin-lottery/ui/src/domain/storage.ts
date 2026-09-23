import { BUILTIN_DRAWS } from './history'
import { DEFAULT_WEIGHTS } from './predictor'
import type { Draw, ModelWeights, PredictionSnapshot } from './types'

const STORAGE_KEY = 'halo-plugin-lottery:ssq:v1'

export interface StoredState {
  draws: Draw[]
  weights: ModelWeights
  predictions: PredictionSnapshot[]
  learningRate: number
}

export function defaultState(): StoredState {
  return {
    draws: structuredClone(BUILTIN_DRAWS),
    weights: { ...DEFAULT_WEIGHTS },
    predictions: [],
    learningRate: 0.25,
  }
}

export function loadState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as Partial<StoredState>
    const mergedDraws = new Map(BUILTIN_DRAWS.map((draw) => [draw.issue, structuredClone(draw)]))
    if (Array.isArray(parsed.draws)) {
      parsed.draws.forEach((draw) => mergedDraws.set(draw.issue, draw))
    }
    return {
      draws: [...mergedDraws.values()].sort((a, b) => b.issue.localeCompare(a.issue)),
      weights: { ...DEFAULT_WEIGHTS, ...parsed.weights },
      predictions: Array.isArray(parsed.predictions) ? parsed.predictions : [],
      learningRate:
        typeof parsed.learningRate === 'number' &&
        parsed.learningRate >= 0.01 &&
        parsed.learningRate <= 1
          ? parsed.learningRate
          : 0.25,
    }
  } catch {
    return defaultState()
  }
}

export function saveState(state: StoredState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function exportState(state: StoredState) {
  return JSON.stringify(
    { format: 'halo-plugin-lottery/ssq-v1', exportedAt: new Date().toISOString(), ...state },
    null,
    2,
  )
}

export function importState(text: string): StoredState {
  const parsed = JSON.parse(text) as StoredState & { format?: string }
  if (parsed.format !== 'halo-plugin-lottery/ssq-v1' || !Array.isArray(parsed.draws)) {
    throw new Error('不是双色球实验室导出的 JSON 文件')
  }
  return {
    draws: parsed.draws,
    weights: { ...DEFAULT_WEIGHTS, ...parsed.weights },
    predictions: Array.isArray(parsed.predictions) ? parsed.predictions : [],
    learningRate: parsed.learningRate ?? 0.25,
  }
}
