import { describe, expect, it } from 'vitest'
import { BUILTIN_DRAWS } from './history'
import {
  DEFAULT_WEIGHTS,
  PRIZE_ODDS,
  TOTAL_COMBINATIONS,
  backtest,
  fineTune,
  parseDraws,
  predict,
} from './predictor'

describe('双色球预测模型', () => {
  it('contains the complete draw history since the first issue', () => {
    expect(BUILTIN_DRAWS.length).toBeGreaterThanOrEqual(3507)
    expect(BUILTIN_DRAWS.at(-1)).toEqual({
      issue: '2003001',
      date: '2003-02-23',
      reds: [10, 11, 12, 13, 26, 28],
      blue: 11,
    })
    expect(new Set(BUILTIN_DRAWS.map((draw) => draw.issue)).size).toBe(BUILTIN_DRAWS.length)
    expect(
      BUILTIN_DRAWS.every(
        (draw) =>
          draw.reds.length === 6 &&
          new Set(draw.reds).size === 6 &&
          draw.reds.every((number) => number >= 1 && number <= 33) &&
          draw.blue >= 1 &&
          draw.blue <= 16,
      ),
    ).toBe(true)
  })

  it('uses the official combination space and prize counts', () => {
    expect(TOTAL_COMBINATIONS).toBe(17_721_088)
    expect(PRIZE_ODDS.reduce((sum, prize) => sum + prize.combinations, 0)).toBe(1_188_988)
  })

  it('produces distinct valid lines from history', () => {
    const lines = predict(BUILTIN_DRAWS, DEFAULT_WEIGHTS, 5, 'fixed-seed')
    expect(lines).toHaveLength(5)
    expect(new Set(lines.map((line) => `${line.reds.join('-')}|${line.blue}`)).size).toBe(5)
    for (const line of lines) {
      expect(line.reds).toHaveLength(6)
      expect(new Set(line.reds).size).toBe(6)
      expect(line.reds.every((number) => number >= 1 && number <= 33)).toBe(true)
      expect(line.blue).toBeGreaterThanOrEqual(1)
      expect(line.blue).toBeLessThanOrEqual(16)
    }
  })

  it('validates imported draw lines', () => {
    const result = parseDraws(
      ['2026110,2026-09-22,01,05,09,16,22,31,08', 'bad,2026-09-22,01,01,09,16,22,31,20'].join('\n'),
    )
    expect(result.draws).toEqual([
      { issue: '2026110', date: '2026-09-22', reds: [1, 5, 9, 16, 22, 31], blue: 8 },
    ])
    expect(result.errors).toHaveLength(1)
  })

  it('keeps online tuning parameters inside safe bounds', () => {
    const history = BUILTIN_DRAWS.slice(1)
    const lines = predict(history, DEFAULT_WEIGHTS, 5, '2026109')
    const tuned = fineTune(DEFAULT_WEIGHTS, history, lines, BUILTIN_DRAWS[0]!, 1)
    for (const value of Object.values(tuned)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(2.5)
    }
  })

  it('runs a chronological rolling backtest', () => {
    const result = backtest(BUILTIN_DRAWS, DEFAULT_WEIGHTS, 12)
    expect(result.tested).toBe(12)
    expect(result.averageRedHits).toBeGreaterThanOrEqual(0)
    expect(result.blueHitRate).toBeGreaterThanOrEqual(0)
    expect(result.blueHitRate).toBeLessThanOrEqual(1)
  })
})
