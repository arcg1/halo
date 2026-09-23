import type { BacktestResult, Draw, ModelWeights, NumberFeatures, PredictionLine } from './types'

export const DEFAULT_WEIGHTS: ModelWeights = {
  globalFrequency: 0.8,
  recentFrequency: 1.15,
  overdue: 0.72,
  trend: 0.65,
  balance: 1.05,
  exploration: 0.3,
}

export const TOTAL_COMBINATIONS = 17_721_088

export const PRIZE_ODDS = [
  { level: '一等奖', condition: '6 红 + 蓝', combinations: 1 },
  { level: '二等奖', condition: '6 红', combinations: 15 },
  { level: '三等奖', condition: '5 红 + 蓝', combinations: 162 },
  { level: '四等奖', condition: '5 红或 4 红 + 蓝', combinations: 7_695 },
  { level: '五等奖', condition: '4 红或 3 红 + 蓝', combinations: 137_475 },
  { level: '六等奖', condition: '蓝球且不超过 2 红', combinations: 1_043_640 },
] as const

const range = (length: number) => Array.from({ length }, (_, index) => index + 1)

function normalize(values: number[]) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return values.map(() => 0.5)
  return values.map((value) => (value - min) / (max - min))
}

export function buildFeatures(draws: Draw[], color: 'red' | 'blue') {
  const limit = color === 'red' ? 33 : 16
  const recentSize = Math.min(20, draws.length)
  const globalCounts = range(limit).map(
    (number) =>
      draws.filter((draw) => (color === 'red' ? draw.reds.includes(number) : draw.blue === number))
        .length,
  )
  const recentCounts = range(limit).map(
    (number) =>
      draws
        .slice(0, recentSize)
        .filter((draw) => (color === 'red' ? draw.reds.includes(number) : draw.blue === number))
        .length,
  )
  const gaps = range(limit).map((number) => {
    const index = draws.findIndex((draw) =>
      color === 'red' ? draw.reds.includes(number) : draw.blue === number,
    )
    return index < 0 ? draws.length : index
  })
  const globalNormalized = normalize(globalCounts)
  const recentNormalized = normalize(recentCounts)
  const gapNormalized = normalize(gaps)

  return range(limit).map<NumberFeatures>((_, index) => ({
    globalFrequency: globalNormalized[index] ?? 0,
    recentFrequency: recentNormalized[index] ?? 0,
    overdue: gapNormalized[index] ?? 0,
    trend: Math.max(
      0,
      Math.min(1, 0.5 + (recentNormalized[index] ?? 0) - (globalNormalized[index] ?? 0)),
    ),
  }))
}

function hashSeed(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function randomFactory(seedText: string) {
  let seed = hashSeed(seedText) || 1
  return () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4_294_967_296
  }
}

function featureScore(feature: NumberFeatures, weights: ModelWeights) {
  return (
    feature.globalFrequency * weights.globalFrequency +
    feature.recentFrequency * weights.recentFrequency +
    feature.overdue * weights.overdue +
    feature.trend * weights.trend
  )
}

interface BalanceReference {
  lower: number
  upper: number
}

function buildBalanceReference(draws: Draw[]): BalanceReference {
  const sortedSums = draws
    .map((draw) => draw.reds.reduce((sum, number) => sum + number, 0))
    .sort((a, b) => a - b)
  return {
    lower: sortedSums[Math.floor(sortedSums.length * 0.15)] ?? 70,
    upper: sortedSums[Math.floor(sortedSums.length * 0.85)] ?? 140,
  }
}

function balanceScore(reds: number[], reference: BalanceReference) {
  const odds = reds.filter((number) => number % 2 === 1).length
  const lows = reds.filter((number) => number <= 16).length
  const sum = reds.reduce((total, number) => total + number, 0)
  const structure = 1 - (Math.abs(odds - 3) + Math.abs(lows - 3)) / 6
  const sumFit = sum >= reference.lower && sum <= reference.upper ? 1 : 0.25
  const consecutivePairs = reds
    .slice(1)
    .filter((number, index) => number - (reds[index] ?? 0) === 1).length
  return structure * 0.55 + sumFit * 0.35 + Math.max(0, 1 - consecutivePairs / 3) * 0.1
}

function weightedSample(weights: number[], count: number, random: () => number) {
  const available = weights.map((weight, index) => ({
    number: index + 1,
    weight: Math.max(0.01, weight),
  }))
  const selected: number[] = []
  while (selected.length < count) {
    const total = available.reduce((sum, item) => sum + item.weight, 0)
    let cursor = random() * total
    let selectedIndex = 0
    for (let index = 0; index < available.length; index += 1) {
      cursor -= available[index]?.weight ?? 0
      if (cursor <= 0) {
        selectedIndex = index
        break
      }
    }
    const picked = available[selectedIndex]
    if (!picked) break
    selected.push(picked.number)
    available.splice(selectedIndex, 1)
  }
  return selected.sort((a, b) => a - b)
}

export function predict(
  draws: Draw[],
  weights: ModelWeights,
  lineCount = 5,
  seedText = draws[0]?.issue ?? 'ssq',
) {
  if (draws.length < 10) return []
  const redFeatures = buildFeatures(draws, 'red')
  const blueFeatures = buildFeatures(draws, 'blue')
  const redScores = redFeatures.map((feature) => featureScore(feature, weights) + 0.15)
  const blueScores = blueFeatures.map((feature) => featureScore(feature, weights) + 0.15)
  const balanceReference = buildBalanceReference(draws)
  const random = randomFactory(seedText)
  const candidates: PredictionLine[] = []

  for (let index = 0; index < 800; index += 1) {
    const jitteredRedScores = redScores.map(
      (score) => score * (1 + (random() - 0.5) * weights.exploration),
    )
    const reds = weightedSample(jitteredRedScores, 6, random)
    const blue = weightedSample(blueScores, 1, random)[0] ?? 1
    const signalScore = reds.reduce((sum, number) => sum + (redScores[number - 1] ?? 0), 0) / 6
    const score = signalScore + balanceScore(reds, balanceReference) * weights.balance
    candidates.push({ reds, blue, score })
  }

  const selected: PredictionLine[] = []
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const duplicate = selected.some((line) =>
      line.reds.every((number) => candidate.reds.includes(number)),
    )
    const tooSimilar = selected.some(
      (line) => line.reds.filter((number) => candidate.reds.includes(number)).length >= 5,
    )
    if (!duplicate && !tooSimilar) selected.push(candidate)
    if (selected.length === lineCount) break
  }
  return selected
}

export function evaluate(lines: PredictionLine[], actual: Draw) {
  const results = lines.map((line) => ({
    redHits: line.reds.filter((number) => actual.reds.includes(number)).length,
    blueHit: line.blue === actual.blue,
  }))
  return {
    bestRedHits: Math.max(0, ...results.map((result) => result.redHits)),
    blueHit: results.some((result) => result.blueHit),
    won: results.some((result) => result.blueHit || result.redHits >= 4),
  }
}

function averageFeature(numbers: number[], features: NumberFeatures[], key: keyof NumberFeatures) {
  return (
    numbers.reduce((sum, number) => sum + (features[number - 1]?.[key] ?? 0), 0) / numbers.length
  )
}

export function fineTune(
  weights: ModelWeights,
  historyBeforeActual: Draw[],
  predicted: PredictionLine[],
  actual: Draw,
  learningRate: number,
) {
  if (!predicted.length) return { ...weights }
  const features = buildFeatures(historyBeforeActual, 'red')
  const chosen = [...new Set(predicted.flatMap((line) => line.reds))]
  const keys: (keyof NumberFeatures)[] = ['globalFrequency', 'recentFrequency', 'overdue', 'trend']
  const next = { ...weights }
  for (const key of keys) {
    const signal =
      averageFeature(actual.reds, features, key) - averageFeature(chosen, features, key)
    next[key] = Math.max(0, Math.min(2.5, next[key] + signal * learningRate))
  }
  const balanceReference = buildBalanceReference(historyBeforeActual)
  const actualBalance = balanceScore(actual.reds, balanceReference)
  const predictedBalance = Math.max(
    ...predicted.map((line) => balanceScore(line.reds, balanceReference)),
  )
  next.balance = Math.max(
    0,
    Math.min(2.5, next.balance + (actualBalance - predictedBalance) * learningRate),
  )
  return next
}

export function backtest(draws: Draw[], weights: ModelWeights, periods = 24): BacktestResult {
  const chronological = [...draws].reverse()
  const start = Math.max(10, chronological.length - periods)
  let redHits = 0
  let blueHits = 0
  let prizes = 0
  let bestRedHits = 0
  let tested = 0
  for (let index = start; index < chronological.length; index += 1) {
    const history = chronological.slice(0, index).reverse()
    const actual = chronological[index]
    if (!actual) continue
    const result = evaluate(predict(history, weights, 1, actual.issue), actual)
    redHits += result.bestRedHits
    blueHits += result.blueHit ? 1 : 0
    prizes += result.won ? 1 : 0
    bestRedHits = Math.max(bestRedHits, result.bestRedHits)
    tested += 1
  }
  return {
    tested,
    averageRedHits: tested ? redHits / tested : 0,
    blueHitRate: tested ? blueHits / tested : 0,
    prizeRate: tested ? prizes / tested : 0,
    bestRedHits,
  }
}

export function nextIssue(issue: string) {
  const numeric = Number.parseInt(issue, 10)
  return Number.isFinite(numeric) ? String(numeric + 1) : '下一期'
}

export function parseDraws(text: string) {
  const draws: Draw[] = []
  const errors: string[] = []
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const columns = line.split(/[\s,|]+/).filter(Boolean)
      const [issue, date, ...numbers] = columns
      const parsed = numbers.map(Number)
      const reds = parsed.slice(0, 6).sort((a, b) => a - b)
      const blue = parsed[6]
      const valid =
        /^\d{7}$/.test(issue ?? '') &&
        /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') &&
        reds.length === 6 &&
        new Set(reds).size === 6 &&
        reds.every((number) => Number.isInteger(number) && number >= 1 && number <= 33) &&
        Number.isInteger(blue) &&
        (blue ?? 0) >= 1 &&
        (blue ?? 17) <= 16
      if (valid) draws.push({ issue: issue!, date: date!, reds, blue: blue! })
      else errors.push(`第 ${index + 1} 行格式不正确`)
    })
  return { draws, errors }
}
