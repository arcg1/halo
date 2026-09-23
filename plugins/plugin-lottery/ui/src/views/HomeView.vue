<script setup lang="ts">
import { VModal } from '@halo-dev/components'
import { computed, nextTick, ref } from 'vue'
import { BUILTIN_DRAWS } from '@/domain/history'
import {
  PRIZE_ODDS,
  TOTAL_COMBINATIONS,
  backtest,
  evaluate,
  fineTune,
  nextIssue,
  parseDraws,
  predict,
} from '@/domain/predictor'
import { defaultState, exportState, importState, loadState, saveState } from '@/domain/storage'
import type { Draw, ModelWeights, PredictionSnapshot } from '@/domain/types'

const initial = loadState()
const draws = ref(initial.draws)
const weights = ref(initial.weights)
const predictions = ref(initial.predictions)
const learningRate = ref(initial.learningRate)
const message = ref('')
const showDataPanel = ref(false)
const dataModal = ref<InstanceType<typeof VModal> | null>(null)
const dataButton = ref<HTMLButtonElement | null>(null)
const importText = ref('')
const historyQuery = ref('')
const historyYear = ref('')
const historyPage = ref(1)
const historyPageSize = 20
const selectedChartStartDate = ref('')
const selectedChartEndDate = ref('')
const visibleChartSeries = ref([true, true, true, true, true, true, true])
const hoveredChartIssue = ref<string | null>(null)

const currentIssue = computed(() => nextIssue(draws.value[0]?.issue ?? ''))
const currentSnapshot = computed(() =>
  predictions.value.find((item) => item.issue === currentIssue.value),
)
const backtestResult = computed(() => backtest(draws.value, weights.value, 24))
const totalWinningCombinations = PRIZE_ODDS.reduce((sum, prize) => sum + prize.combinations, 0)

const form = ref({
  issue: currentIssue.value,
  date: new Date().toISOString().slice(0, 10),
  reds: '',
  blue: '',
})

const tuningControls: { key: keyof ModelWeights; label: string; help: string }[] = [
  { key: 'globalFrequency', label: '长期频率', help: '全部样本中的出现频率' },
  { key: 'recentFrequency', label: '近期热度', help: '最近 20 期的出现频率' },
  { key: 'overdue', label: '遗漏补偿', help: '距离上次出现越久，得分越高' },
  { key: 'trend', label: '趋势动量', help: '近期频率相对长期频率的变化' },
  { key: 'balance', label: '结构均衡', help: '奇偶、大小、和值与连号结构' },
  { key: 'exploration', label: '探索强度', help: '候选之间保留多少随机差异' },
]

const chartStartDate = computed({
  get: () =>
    selectedChartStartDate.value || draws.value[Math.min(29, draws.value.length - 1)]?.date || '',
  set: (date: string) => {
    selectedChartStartDate.value = date
    hoveredChartIssue.value = null
  },
})
const chartEndDate = computed({
  get: () => selectedChartEndDate.value || draws.value[0]?.date || '',
  set: (date: string) => {
    selectedChartEndDate.value = date
    hoveredChartIssue.value = null
  },
})
const chartRangeInvalid = computed(() => chartStartDate.value > chartEndDate.value)
const chartDraws = computed(() =>
  chartRangeInvalid.value
    ? []
    : draws.value
        .filter((draw) => draw.date >= chartStartDate.value && draw.date <= chartEndDate.value)
        .reverse(),
)
const hoveredChartDraw = computed(() =>
  chartDraws.value.find((draw) => draw.issue === hoveredChartIssue.value),
)
const hoveredChartIndex = computed(() =>
  chartDraws.value.findIndex((draw) => draw.issue === hoveredChartIssue.value),
)
const historyYears = computed(() =>
  [...new Set(draws.value.map((draw) => draw.date.slice(0, 4)))].sort((a, b) => b.localeCompare(a)),
)
const filteredHistory = computed(() => {
  const query = historyQuery.value.trim()
  return draws.value.filter(
    (draw) =>
      (!historyYear.value || draw.date.startsWith(historyYear.value)) &&
      (!query || draw.issue.includes(query) || draw.date.includes(query)),
  )
})
const historyPageCount = computed(() =>
  Math.max(1, Math.ceil(filteredHistory.value.length / historyPageSize)),
)
const visibleHistoryPage = computed(() => Math.min(historyPage.value, historyPageCount.value))
const visibleHistory = computed(() =>
  filteredHistory.value.slice(
    (visibleHistoryPage.value - 1) * historyPageSize,
    visibleHistoryPage.value * historyPageSize,
  ),
)
const chartSeries = computed(() => {
  const colors = ['#ef4444', '#f97316', '#eab308', '#16a34a', '#8b5cf6', '#ec4899']
  const redSeries = colors.map((color, position) => ({
    color,
    label: `红球第 ${position + 1} 位`,
    values: chartDraws.value.map((draw) => draw.reds[position] ?? 1),
  }))
  return [
    ...redSeries,
    {
      color: '#2563eb',
      label: '蓝球',
      values: chartDraws.value.map((draw) => draw.blue),
    },
  ].map((series) => ({
    ...series,
    points: series.values
      .map((number, index) => chartPoint(index, number, chartDraws.value.length))
      .join(' '),
  }))
})

function chartX(index: number, length: number) {
  return length === 1 ? 450 : 42 + (index * 816) / Math.max(1, length - 1)
}

function chartY(number: number) {
  return 246 - ((number - 1) * 216) / 32
}

function chartPoint(index: number, number: number, length: number) {
  return `${chartX(index, length).toFixed(1)},${chartY(number).toFixed(1)}`
}

function showLatestChartDraws() {
  selectedChartStartDate.value = ''
  selectedChartEndDate.value = ''
  hoveredChartIssue.value = null
}

function toggleChartSeries(index: number) {
  visibleChartSeries.value = visibleChartSeries.value.map((visible, position) =>
    position === index ? !visible : visible,
  )
}

function handleChartPointer(event: MouseEvent) {
  const svg = (event.currentTarget as SVGRectElement).ownerSVGElement
  const bounds = svg?.getBoundingClientRect()
  if (!bounds?.width || !chartDraws.value.length) return
  const x = ((event.clientX - bounds.left) / bounds.width) * 900
  const index = Math.round(
    ((Math.max(42, Math.min(858, x)) - 42) / 816) * (chartDraws.value.length - 1),
  )
  hoveredChartIssue.value = chartDraws.value[index]?.issue ?? null
}

function stepChartHover(direction: number) {
  const last = chartDraws.value.length - 1
  if (last < 0) return
  const current = hoveredChartIndex.value < 0 ? last : hoveredChartIndex.value
  hoveredChartIssue.value =
    chartDraws.value[Math.max(0, Math.min(last, current + direction))]?.issue ?? null
}

function persist() {
  saveState({
    draws: draws.value,
    weights: weights.value,
    predictions: predictions.value,
    learningRate: learningRate.value,
  })
}

function generatePrediction(force = false) {
  if (currentSnapshot.value && !force) return
  const snapshot: PredictionSnapshot = {
    issue: currentIssue.value,
    createdAt: new Date().toISOString(),
    lines: predict(draws.value, weights.value, 5, `${currentIssue.value}-${Date.now()}`),
    weights: { ...weights.value },
  }
  predictions.value = [
    snapshot,
    ...predictions.value.filter((item) => item.issue !== snapshot.issue),
  ].slice(0, 30)
  persist()
  message.value = `已为第 ${snapshot.issue} 期生成 5 组候选`
}

function mergeDraws(incoming: Draw[]) {
  const merged = new Map(draws.value.map((draw) => [draw.issue, draw]))
  incoming.forEach((draw) => merged.set(draw.issue, draw))
  draws.value = [...merged.values()].sort((a, b) => b.issue.localeCompare(a.issue))
}

function addActualResult() {
  const parsed = parseDraws(
    `${form.value.issue},${form.value.date},${form.value.reds},${form.value.blue}`,
  )
  if (parsed.errors.length) {
    message.value = '号码格式有误：红球请输入 6 个不重复的 1–33，蓝球请输入 1–16。'
    return
  }
  const actual = parsed.draws[0]
  if (!actual) return
  const snapshot = predictions.value.find((item) => item.issue === actual.issue)
  const previousHistory = draws.value.filter((draw) => draw.issue < actual.issue)
  let tuningNote = '该期没有对应预测，仅保存开奖数据。'
  if (snapshot) {
    const result = evaluate(snapshot.lines, actual)
    snapshot.evaluatedBy = actual.issue
    snapshot.bestRedHits = result.bestRedHits
    snapshot.blueHit = result.blueHit
    const jackpot = snapshot.lines.some(
      (line) =>
        line.blue === actual.blue && line.reds.every((number) => actual.reds.includes(number)),
    )
    if (!jackpot && previousHistory.length >= 10) {
      weights.value = fineTune(
        snapshot.weights,
        previousHistory,
        snapshot.lines,
        actual,
        learningRate.value,
      )
      tuningNote = `未命中一等奖，已按特征差异微调参数；最佳命中 ${result.bestRedHits} 个红球${result.blueHit ? '，命中蓝球' : ''}。`
    } else {
      tuningNote = jackpot ? '命中一等奖组合，本次不调整参数。' : '历史样本不足，暂不自动调参。'
    }
  }
  mergeDraws([actual])
  form.value = {
    issue: nextIssue(actual.issue),
    date: new Date().toISOString().slice(0, 10),
    reds: '',
    blue: '',
  }
  persist()
  message.value = `第 ${actual.issue} 期已保存。${tuningNote}`
}

function importDrawLines() {
  const parsed = parseDraws(importText.value)
  if (!parsed.draws.length) {
    message.value = parsed.errors[0] ?? '没有可导入的数据'
    return
  }
  mergeDraws(parsed.draws)
  persist()
  message.value = `已导入 ${parsed.draws.length} 期${parsed.errors.length ? `，跳过 ${parsed.errors.length} 行` : ''}`
  importText.value = ''
}

function downloadBackup() {
  const blob = new Blob(
    [
      exportState({
        draws: draws.value,
        weights: weights.value,
        predictions: predictions.value,
        learningRate: learningRate.value,
      }),
    ],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `ssq-lab-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function restoreBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const restored = importState(await file.text())
    draws.value = restored.draws
    weights.value = restored.weights
    predictions.value = restored.predictions
    learningRate.value = restored.learningRate
    persist()
    message.value = '备份恢复成功'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '备份恢复失败'
  } finally {
    input.value = ''
  }
}

function resetAll() {
  const reset = defaultState()
  draws.value = reset.draws
  weights.value = reset.weights
  predictions.value = []
  learningRate.value = reset.learningRate
  form.value.issue = nextIssue(BUILTIN_DRAWS[0]?.issue ?? '')
  persist()
  message.value = `已恢复内置的 ${BUILTIN_DRAWS.length} 期样本和默认参数`
}

function formatOdds(combinations: number) {
  return `约 1 / ${Math.round(TOTAL_COMBINATIONS / combinations).toLocaleString('zh-CN')}`
}

function ball(number: number) {
  return String(number).padStart(2, '0')
}

function openDataModal() {
  message.value = ''
  showDataPanel.value = true
}

function handleDataModalClose() {
  showDataPanel.value = false
  nextTick(() => dataButton.value?.focus())
}

generatePrediction()
</script>

<template>
  <main class="lottery-page">
    <header class="hero">
      <div>
        <p class="eyebrow">DOUBLE COLOR BALL · CONSOLE ONLY</p>
        <h1>双色球实验室</h1>
        <p class="subtitle">用历史统计做可解释的候选排序、滚动回测和在线微调。</p>
      </div>
      <div class="hero-actions">
        <button
          ref="dataButton"
          class="button button-secondary"
          type="button"
          @click="openDataModal"
        >
          数据管理
        </button>
        <button class="button button-primary" type="button" @click="generatePrediction(true)">
          重新生成
        </button>
      </div>
    </header>

    <div class="notice">
      <strong>理性说明：</strong
      >双色球每次开奖相互独立，历史走势不能提高单注的理论中奖概率。这里的“模型分数”只用于候选排序，不是中奖概率，也不构成购彩建议。
    </div>

    <p v-if="message && !showDataPanel" class="message" role="status">{{ message }}</p>

    <section class="stats-grid">
      <article class="stat-card">
        <span>预测期号</span><strong>{{ currentIssue }}</strong
        ><small>基于最新第 {{ draws[0]?.issue }} 期</small>
      </article>
      <article class="stat-card">
        <span>历史样本</span><strong>{{ draws.length }} 期</strong
        ><small>{{ draws[draws.length - 1]?.date }} — {{ draws[0]?.date }}</small>
      </article>
      <article class="stat-card">
        <span>一等奖理论概率</span><strong>1 / 17,721,088</strong><small>任意一注都相同</small>
      </article>
      <article class="stat-card">
        <span>任意奖理论概率</span><strong>{{ formatOdds(totalWinningCombinations) }}</strong
        ><small>约 {{ ((totalWinningCombinations / TOTAL_COMBINATIONS) * 100).toFixed(2) }}%</small>
      </article>
    </section>

    <section class="panel prediction-panel">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">MODEL OUTPUT</p>
          <h2>第 {{ currentIssue }} 期候选</h2>
        </div>
        <span class="model-badge">统计排序 · 非必中</span>
      </div>
      <div class="prediction-list">
        <div
          v-for="(line, index) in currentSnapshot?.lines"
          :key="`${line.reds.join('-')}-${line.blue}`"
          class="prediction-row"
        >
          <span class="line-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="balls">
            <span v-for="number in line.reds" :key="number" class="ball red">{{
              ball(number)
            }}</span
            ><span class="separator">+</span><span class="ball blue">{{ ball(line.blue) }}</span>
          </div>
          <div class="score">
            <span>模型分数</span><strong>{{ line.score.toFixed(3) }}</strong>
          </div>
        </div>
      </div>
    </section>

    <section class="two-column">
      <article class="panel chart-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">DRAW DATE RANGE</p>
            <h2>历史号码折线图</h2>
          </div>
          <div class="chart-controls">
            <label class="chart-date-control">
              <span>开始日期</span>
              <input
                v-model="chartStartDate"
                type="date"
                aria-label="图表开始日期"
                :min="draws[draws.length - 1]?.date"
                :max="draws[0]?.date"
              />
            </label>
            <label class="chart-date-control">
              <span>截至日期</span>
              <input
                v-model="chartEndDate"
                type="date"
                aria-label="图表截止日期"
                :min="draws[draws.length - 1]?.date"
                :max="draws[0]?.date"
              />
            </label>
            <button
              class="button button-secondary"
              type="button"
              :disabled="!selectedChartStartDate && !selectedChartEndDate"
              @click="showLatestChartDraws"
            >
              最近 30 期
            </button>
          </div>
        </div>
        <div class="chart-legend" aria-label="号码折线显示设置">
          <button
            v-for="(series, index) in chartSeries"
            :key="series.label"
            class="chart-series-toggle"
            :class="{ 'is-hidden': !visibleChartSeries[index] }"
            type="button"
            :aria-pressed="visibleChartSeries[index] ?? false"
            @click="toggleChartSeries(index)"
          >
            <span
              class="chart-series-swatch"
              :style="{ backgroundColor: visibleChartSeries[index] ? series.color : '#cbd5e1' }"
            ></span>
            {{ series.label }}
          </button>
        </div>
        <p class="chart-hint">
          共 {{ chartDraws.length }} 期 · 红球线按号码从小到大排序 ·
          悬停查看，聚焦后可用左右方向键逐期切换
        </p>
        <div v-if="chartDraws.length" class="chart-plot" @mouseleave="hoveredChartIssue = null">
          <svg
            class="trend-chart"
            viewBox="0 0 900 280"
            role="group"
            :aria-label="`${chartStartDate} 至 ${chartEndDate} 的 ${chartDraws.length} 期双色球号码走势`"
          >
            <line
              v-for="tick in [1, 8, 16, 24, 33]"
              :key="tick"
              x1="42"
              x2="858"
              :y1="chartY(tick)"
              :y2="chartY(tick)"
              class="grid-line"
            />
            <text
              v-for="tick in [1, 8, 16, 24, 33]"
              :key="`label-${tick}`"
              x="8"
              :y="chartY(tick) + 4"
              class="axis-label"
            >
              {{ tick }}
            </text>
            <template v-for="(series, index) in chartSeries" :key="series.label">
              <polyline
                v-if="visibleChartSeries[index]"
                :points="series.points"
                :stroke="series.color"
                :class="['series', { 'blue-series': index === 6 }]"
              />
            </template>
            <template v-for="(series, seriesIndex) in chartSeries" :key="seriesIndex">
              <circle
                v-for="(number, drawIndex) in visibleChartSeries[seriesIndex] &&
                chartDraws.length <= 120
                  ? series.values
                  : []"
                :key="drawIndex"
                :cx="chartX(drawIndex, chartDraws.length)"
                :cy="chartY(number)"
                r="2.5"
                :fill="series.color"
                class="chart-dot"
              />
            </template>
            <line
              v-if="hoveredChartIndex >= 0"
              :x1="chartX(hoveredChartIndex, chartDraws.length)"
              :x2="chartX(hoveredChartIndex, chartDraws.length)"
              y1="26"
              y2="246"
              class="chart-hover-guide"
            />
            <rect
              x="42"
              y="24"
              width="816"
              height="224"
              class="chart-hit-area"
              role="slider"
              tabindex="0"
              aria-label="查看图表中的开奖期数，使用左右方向键切换"
              :aria-valuemin="1"
              :aria-valuemax="chartDraws.length"
              :aria-valuenow="hoveredChartIndex >= 0 ? hoveredChartIndex + 1 : chartDraws.length"
              :aria-valuetext="
                hoveredChartDraw
                  ? `第 ${hoveredChartDraw.issue} 期 ${hoveredChartDraw.date}`
                  : `第 ${chartDraws[chartDraws.length - 1]?.issue} 期`
              "
              @mouseenter="handleChartPointer"
              @mousemove="handleChartPointer"
              @click="handleChartPointer"
              @focus="hoveredChartIssue = chartDraws[chartDraws.length - 1]?.issue ?? null"
              @keydown.left.prevent="stepChartHover(-1)"
              @keydown.right.prevent="stepChartHover(1)"
            />
          </svg>
          <div v-if="hoveredChartDraw" class="chart-tooltip" aria-live="polite">
            <strong>第 {{ hoveredChartDraw.issue }} 期</strong>
            <time :datetime="hoveredChartDraw.date">{{ hoveredChartDraw.date }}</time>
            <div class="balls chart-tooltip-balls">
              <span v-for="number in hoveredChartDraw.reds" :key="number" class="ball red">{{
                ball(number)
              }}</span>
              <span class="separator">+</span>
              <span class="ball blue">{{ ball(hoveredChartDraw.blue) }}</span>
            </div>
          </div>
        </div>
        <p v-else class="chart-empty">
          {{ chartRangeInvalid ? '开始日期不能晚于截至日期。' : '所选日期范围内没有开奖记录。' }}
        </p>
        <div v-if="chartDraws.length" class="chart-footer">
          <span>第 {{ chartDraws[0]?.issue }} 期 · {{ chartDraws[0]?.date }}</span>
          <span
            >第 {{ chartDraws[chartDraws.length - 1]?.issue }} 期 ·
            {{ chartDraws[chartDraws.length - 1]?.date }}</span
          >
        </div>
      </article>

      <article class="panel backtest-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">ROLLING BACKTEST</p>
            <h2>最近 {{ backtestResult.tested }} 期回测</h2>
          </div>
        </div>
        <div class="backtest-score">
          <strong>{{ backtestResult.averageRedHits.toFixed(2) }}</strong
          ><span>平均命中红球 / 期（每期回测 1 注）</span>
        </div>
        <dl class="metric-list">
          <div>
            <dt>蓝球命中率</dt>
            <dd>{{ (backtestResult.blueHitRate * 100).toFixed(1) }}%</dd>
          </div>
          <div>
            <dt>任意奖命中率</dt>
            <dd>{{ (backtestResult.prizeRate * 100).toFixed(1) }}%</dd>
          </div>
          <div>
            <dt>单期最多红球</dt>
            <dd>{{ backtestResult.bestRedHits }} 个</dd>
          </div>
        </dl>
        <p class="fine-print">
          回测逐期只使用当时之前的数据，避免把未来开奖结果泄漏给模型；样本较小，不代表未来表现。
        </p>
      </article>
    </section>

    <section class="panel history-panel">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">DRAW HISTORY</p>
          <h2>历史开奖</h2>
        </div>
        <span class="model-badge">共 {{ filteredHistory.length }} 期</span>
      </div>
      <div class="history-filters">
        <label>
          <span>期号或开奖日期</span>
          <input
            v-model="historyQuery"
            aria-label="搜索历史开奖期号或日期"
            placeholder="例如：2003001、2026-09"
            @input="historyPage = 1"
          />
        </label>
        <label>
          <span>开奖年份</span>
          <select v-model="historyYear" aria-label="筛选开奖年份" @change="historyPage = 1">
            <option value="">全部年份</option>
            <option v-for="year in historyYears" :key="year" :value="year">{{ year }} 年</option>
          </select>
        </label>
      </div>
      <div v-if="visibleHistory.length" class="history-list">
        <div v-for="draw in visibleHistory" :key="draw.issue" class="history-row">
          <strong>第 {{ draw.issue }} 期</strong>
          <time :datetime="draw.date">{{ draw.date }}</time>
          <div class="balls history-balls" :aria-label="`第 ${draw.issue} 期开奖结果`">
            <span v-for="number in draw.reds" :key="number" class="ball red">{{
              ball(number)
            }}</span>
            <span class="separator">+</span>
            <span class="ball blue">{{ ball(draw.blue) }}</span>
          </div>
        </div>
      </div>
      <p v-else class="history-empty">没有符合条件的开奖记录。</p>
      <div v-if="filteredHistory.length > historyPageSize" class="history-pagination">
        <span>第 {{ visibleHistoryPage }} / {{ historyPageCount }} 页</span>
        <div>
          <button
            class="button button-secondary"
            type="button"
            :disabled="visibleHistoryPage === 1"
            @click="historyPage = visibleHistoryPage - 1"
          >
            上一页
          </button>
          <button
            class="button button-secondary"
            type="button"
            :disabled="visibleHistoryPage === historyPageCount"
            @click="historyPage = visibleHistoryPage + 1"
          >
            下一页
          </button>
        </div>
      </div>
    </section>

    <section class="two-column">
      <article class="panel tuning-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">TUNABLE MODEL</p>
            <h2>算法参数</h2>
          </div>
          <span class="model-badge">自动保存</span>
        </div>
        <label v-for="control in tuningControls" :key="control.key" class="slider-row">
          <span
            ><strong>{{ control.label }}</strong
            ><small>{{ control.help }}</small></span
          >
          <input
            v-model.number="weights[control.key]"
            type="range"
            min="0"
            max="2.5"
            step="0.05"
            @change="persist"
          />
          <output>{{ weights[control.key].toFixed(2) }}</output>
        </label>
        <label class="slider-row learning-rate"
          ><span
            ><strong>微调学习率</strong><small>录入未命中的真实开奖后，参数调整幅度</small></span
          ><input
            v-model.number="learningRate"
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            @change="persist"
          /><output>{{ learningRate.toFixed(2) }}</output></label
        >
      </article>

      <article class="panel result-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">FEEDBACK LOOP</p>
            <h2>录入真实开奖并微调</h2>
          </div>
        </div>
        <div class="form-grid">
          <label><span>期号</span><input v-model="form.issue" inputmode="numeric" /></label>
          <label><span>开奖日期</span><input v-model="form.date" type="date" /></label>
          <label class="wide"
            ><span>6 个红球</span><input v-model="form.reds" placeholder="例如：01 06 12 18 25 31"
          /></label>
          <label
            ><span>蓝球</span><input v-model="form.blue" inputmode="numeric" placeholder="例如：09"
          /></label>
        </div>
        <button class="button button-primary full-button" type="button" @click="addActualResult">
          保存开奖并评估
        </button>
        <p class="fine-print">
          若 5 组候选均未命中一等奖，模型会比较真实号码与候选号码的特征差异并小步更新权重。
        </p>
      </article>
    </section>

    <section class="panel odds-panel">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">COMBINATORIAL PROBABILITY</p>
          <h2>单注中奖概率</h2>
        </div>
        <span>总组合数 {{ TOTAL_COMBINATIONS.toLocaleString('zh-CN') }}</span>
      </div>
      <div class="odds-table">
        <div class="odds-head"><span>奖级</span><span>条件</span><span>理论概率</span></div>
        <div v-for="prize in PRIZE_ODDS" :key="prize.level" class="odds-row">
          <strong>{{ prize.level }}</strong
          ><span>{{ prize.condition }}</span
          ><span>{{ formatOdds(prize.combinations) }}</span>
        </div>
      </div>
    </section>

    <VModal
      v-if="showDataPanel"
      ref="dataModal"
      :width="720"
      :body-class="['!overflow-auto']"
      title="数据导入与备份"
      mount-to-body
      layer-closable
      @close="handleDataModalClose"
    >
      <p class="fine-print">
        每行格式：期号,日期,红1,红2,红3,红4,红5,红6,蓝球。数据与模型参数保存在当前浏览器；换设备前请导出备份。
      </p>
      <p v-if="message" class="message data-message" role="status">{{ message }}</p>
      <textarea
        v-model="importText"
        class="data-import-text"
        rows="6"
        placeholder="2026110,2026-09-22,01,05,09,16,22,31,08"
      ></textarea>
      <div class="data-actions">
        <button class="button button-primary" type="button" @click="importDrawLines">
          批量导入
        </button>
        <button class="button button-secondary" type="button" @click="downloadBackup">
          导出 JSON 备份
        </button>
        <label class="button button-secondary file-button"
          >恢复 JSON 备份<input type="file" accept="application/json" @change="restoreBackup"
        /></label>
        <button class="button button-danger" type="button" @click="resetAll">恢复内置数据</button>
      </div>
      <template #footer>
        <button class="button button-secondary" type="button" @click="dataModal?.close()">
          关闭
        </button>
      </template>
    </VModal>
  </main>
</template>

<style scoped>
:global(body) {
  background: #f5f6f8;
}
.lottery-page {
  min-height: 100vh;
  padding: 28px;
  color: #172033;
  background: radial-gradient(circle at 85% 0, rgb(37 99 235 / 8%), transparent 28rem), #f5f6f8;
}
.hero {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  max-width: 1440px;
  margin: 0 auto 20px;
}
.eyebrow,
.section-kicker {
  margin: 0 0 7px;
  color: #64748b;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
}
h1 {
  margin: 0;
  font-size: 32px;
  line-height: 1.15;
  letter-spacing: -0.04em;
}
h2 {
  margin: 0;
  font-size: 18px;
}
.subtitle {
  margin: 8px 0 0;
  color: #64748b;
}
.hero-actions,
.data-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.button {
  border: 1px solid transparent;
  border-radius: 9px;
  padding: 9px 15px;
  font-weight: 700;
  cursor: pointer;
  transition: 0.15s ease;
}
.button:hover {
  transform: translateY(-1px);
}
.button-primary {
  color: white;
  background: #1d4ed8;
  box-shadow: 0 6px 18px rgb(29 78 216 / 18%);
}
.button-secondary {
  border-color: #dbe1ea;
  color: #334155;
  background: white;
}
.button-danger {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fff7f7;
}
.notice,
.message {
  max-width: 1440px;
  box-sizing: border-box;
  margin: 0 auto 18px;
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 13px;
  line-height: 1.6;
}
.notice {
  border: 1px solid #fde68a;
  color: #854d0e;
  background: #fffbeb;
}
.message {
  border: 1px solid #bfdbfe;
  color: #1e40af;
  background: #eff6ff;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  max-width: 1440px;
  margin: 0 auto 14px;
}
.stat-card,
.panel {
  border: 1px solid #e3e7ee;
  border-radius: 14px;
  background: rgb(255 255 255 / 94%);
  box-shadow: 0 10px 30px rgb(15 23 42 / 4%);
}
.stat-card {
  display: flex;
  flex-direction: column;
  padding: 18px 20px;
}
.stat-card span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}
.stat-card strong {
  margin: 8px 0 3px;
  font-size: 23px;
  letter-spacing: -0.03em;
}
.stat-card small {
  color: #94a3b8;
}
.panel {
  padding: 20px;
}
.prediction-panel,
.odds-panel,
.history-panel {
  max-width: 1440px;
  box-sizing: border-box;
  margin: 0 auto 14px;
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  margin-bottom: 17px;
}
.model-badge {
  border-radius: 99px;
  padding: 5px 9px;
  color: #475569;
  background: #f1f5f9;
  font-size: 11px;
  font-weight: 700;
}
.prediction-list {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.prediction-row {
  position: relative;
  min-width: 0;
  border: 1px solid #edf0f4;
  border-radius: 11px;
  padding: 13px;
  background: #fafbfc;
}
.line-number {
  color: #94a3b8;
  font: 700 11px/1 monospace;
}
.balls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin: 11px 0 13px;
}
.ball {
  display: inline-grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  color: white;
  font: 700 11px/1 monospace;
  box-shadow: inset 0 -2px 4px rgb(0 0 0 / 12%);
}
.ball.red {
  background: linear-gradient(145deg, #fb7185, #dc2626);
}
.ball.blue {
  background: linear-gradient(145deg, #60a5fa, #1d4ed8);
}
.history-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.history-filters label {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 6px;
  max-width: 320px;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}
.history-filters select {
  width: 100%;
  border: 1px solid #dbe1ea;
  border-radius: 8px;
  padding: 9px 11px;
  color: #172033;
  background: white;
}
.history-filters select:focus {
  border-color: #60a5fa;
  outline: 3px solid rgb(96 165 250 / 15%);
}
.history-list {
  border: 1px solid #e8ecf1;
  border-radius: 10px;
  overflow: hidden;
}
.history-row {
  display: grid;
  grid-template-columns: 120px 120px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  font-size: 12px;
}
.history-row + .history-row {
  border-top: 1px solid #eef1f4;
}
.history-row:nth-child(even) {
  background: #f8fafc;
}
.history-row time {
  color: #64748b;
}
.history-balls {
  margin: 0;
}
.history-empty {
  padding: 24px;
  color: #64748b;
  text-align: center;
}
.history-pagination,
.history-pagination > div {
  display: flex;
  align-items: center;
  gap: 10px;
}
.history-pagination {
  justify-content: space-between;
  margin-top: 16px;
  color: #64748b;
  font-size: 12px;
}
.history-pagination .button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  transform: none;
}
.separator {
  color: #cbd5e1;
  font-weight: 800;
}
.score {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid #e9edf2;
  padding-top: 10px;
  color: #94a3b8;
  font-size: 11px;
}
.score strong {
  color: #475569;
}
.two-column {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 14px;
  max-width: 1440px;
  margin: 0 auto 14px;
}
.chart-controls {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 8px;
}
.chart-date-control {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 150px;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}
.chart-controls .button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  transform: none;
}
.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.chart-series-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid #dbe1ea;
  border-radius: 999px;
  padding: 5px 9px;
  color: #334155;
  background: white;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.chart-series-toggle.is-hidden {
  color: #94a3b8;
  background: #f8fafc;
  opacity: 0.65;
}
.chart-series-toggle:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
.chart-series-swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.chart-plot {
  position: relative;
}
.trend-chart {
  display: block;
  width: 100%;
  min-height: 250px;
}
.grid-line {
  stroke: #e9edf2;
  stroke-width: 1;
  stroke-dasharray: 4 5;
}
.axis-label {
  fill: #94a3b8;
  font-size: 10px;
}
.series {
  fill: none;
  stroke-width: 1.4;
  opacity: 0.52;
}
.blue-series {
  stroke-width: 2.4;
  opacity: 0.95;
}
.chart-dot,
.chart-hover-guide {
  pointer-events: none;
}
.chart-hover-guide {
  stroke: #334155;
  stroke-width: 1;
  stroke-dasharray: 4 4;
}
.chart-hit-area {
  fill: transparent;
  cursor: crosshair;
}
.chart-hit-area:focus-visible {
  outline: none;
  stroke: #2563eb;
  stroke-width: 2;
}
.chart-tooltip {
  position: absolute;
  z-index: 1;
  top: 8px;
  right: 8px;
  border: 1px solid #dbeafe;
  border-radius: 10px;
  padding: 10px 12px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
  pointer-events: none;
}
.chart-tooltip strong,
.chart-tooltip time {
  display: block;
}
.chart-tooltip strong {
  font-size: 12px;
}
.chart-tooltip time {
  margin-top: 3px;
  color: #64748b;
  font-size: 11px;
}
.chart-tooltip-balls {
  margin: 8px 0 0;
}
.chart-hint {
  margin: 0;
  color: #94a3b8;
  font-size: 11px;
}
.chart-empty {
  padding: 60px 12px;
  color: #64748b;
  text-align: center;
}
.chart-footer {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  padding-left: 38px;
  color: #94a3b8;
  font-size: 10px;
}
.backtest-score {
  border-radius: 12px;
  padding: 22px;
  text-align: center;
  background: linear-gradient(145deg, #eff6ff, #eef2ff);
}
.backtest-score strong {
  display: block;
  color: #1d4ed8;
  font-size: 42px;
  letter-spacing: -0.05em;
}
.backtest-score span {
  color: #64748b;
  font-size: 12px;
}
.metric-list {
  margin: 14px 0;
}
.metric-list div {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #eef1f4;
  padding: 10px 2px;
}
.metric-list dt {
  color: #64748b;
}
.metric-list dd {
  margin: 0;
  font-weight: 800;
}
.fine-print {
  color: #64748b;
  font-size: 11px;
  line-height: 1.6;
}
.slider-row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) 1.3fr 44px;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #eef1f4;
  padding: 9px 0;
}
.slider-row span {
  display: flex;
  flex-direction: column;
}
.slider-row small {
  margin-top: 2px;
  color: #94a3b8;
  font-size: 10px;
}
.slider-row input {
  width: 100%;
  accent-color: #2563eb;
}
.slider-row output {
  color: #334155;
  font: 700 12px/1 monospace;
  text-align: right;
}
.learning-rate {
  margin-top: 8px;
  border: 0;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}
.form-grid .wide {
  grid-column: span 2;
}
input,
textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #dbe1ea;
  border-radius: 8px;
  padding: 9px 11px;
  color: #172033;
  background: white;
  outline: none;
}
input:focus,
textarea:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 3px rgb(96 165 250 / 15%);
}
.full-button {
  width: 100%;
  margin-top: 14px;
}
.odds-table {
  overflow: hidden;
  border: 1px solid #e8ecf1;
  border-radius: 10px;
}
.odds-head,
.odds-row {
  display: grid;
  grid-template-columns: 0.7fr 1.5fr 1fr;
  gap: 12px;
  padding: 11px 14px;
}
.odds-head {
  color: #64748b;
  background: #f8fafc;
  font-size: 11px;
  font-weight: 800;
}
.odds-row {
  border-top: 1px solid #eef1f4;
  font-size: 12px;
}
.data-import-text {
  width: 100%;
  resize: vertical;
  font-family: ui-monospace, monospace;
}
.data-message {
  margin: 10px 0;
}
.data-actions {
  margin-top: 12px;
}
.file-button {
  display: inline-block;
}
.file-button input {
  display: none;
}
@media (max-width: 1100px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .prediction-list {
    grid-template-columns: repeat(2, 1fr);
  }
  .two-column {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .lottery-page {
    padding: 16px;
  }
  .hero {
    align-items: stretch;
    flex-direction: column;
  }
  .chart-panel .panel-heading {
    align-items: stretch;
    flex-direction: column;
  }
  .chart-tooltip {
    position: static;
    margin: 8px 0;
  }
  .stats-grid,
  .prediction-list {
    grid-template-columns: 1fr;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-grid .wide {
    grid-column: auto;
  }
  .slider-row {
    grid-template-columns: 1fr 44px;
  }
  .slider-row input {
    grid-column: 1 / -1;
  }
  .history-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .history-pagination {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
