export interface Draw {
  issue: string
  date: string
  reds: number[]
  blue: number
}

export interface ModelWeights {
  globalFrequency: number
  recentFrequency: number
  overdue: number
  trend: number
  balance: number
  exploration: number
}

export interface NumberFeatures {
  globalFrequency: number
  recentFrequency: number
  overdue: number
  trend: number
}

export interface PredictionLine {
  reds: number[]
  blue: number
  score: number
}

export interface PredictionSnapshot {
  issue: string
  createdAt: string
  lines: PredictionLine[]
  weights: ModelWeights
  evaluatedBy?: string
  bestRedHits?: number
  blueHit?: boolean
}

export interface BacktestResult {
  tested: number
  averageRedHits: number
  blueHitRate: number
  prizeRate: number
  bestRedHits: number
}
