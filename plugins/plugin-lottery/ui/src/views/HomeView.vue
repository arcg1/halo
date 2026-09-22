<script setup lang="ts">
import { computed, ref } from 'vue'
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
const importText = ref('')

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

const chartDraws = computed(() => draws.value.slice(0, 30).reverse())
const chartSeries = computed(() => {
  const colors = ['#ef4444', '#f97316', '#eab308', '#16a34a', '#8b5cf6', '#ec4899']
  const redSeries = colors.map((color, position) => ({
    color,
    points: chartDraws.value
      .map((draw, index) => chartPoint(index, draw.reds[position] ?? 1, chartDraws.value.length))
      .join(' '),
  }))
  return [
    ...redSeries,
    {
      color: '#2563eb',
      points: chartDraws.value
        .map((draw, index) => chartPoint(index, draw.blue, chartDraws.value.length))
        .join(' '),
    },
  ]
})

function chartPoint(index: number, number: number, length: number) {
  const x = 42 + (index * 816) / Math.max(1, length - 1)
  const y = 246 - ((number - 1) * 216) / 32
  return `${x.toFixed(1)},${y.toFixed(1)}`
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
  message.value = '已恢复内置的 100 期样本和默认参数'
}

function formatOdds(combinations: number) {
  return `约 1 / ${Math.round(TOTAL_COMBINATIONS / combinations).toLocaleString('zh-CN')}`
}

function ball(number: number) {
  return String(number).padStart(2, '0')
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
          class="button button-secondary"
          type="button"
          @click="showDataPanel = !showDataPanel"
        >
          {{ showDataPanel ? '收起数据管理' : '数据管理' }}
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

    <p v-if="message" class="message" role="status">{{ message }}</p>

    <section class="stats-grid">
      <article class="stat-card">
        <span>预测期号</span><strong>{{ currentIssue }}</strong
        ><small>基于最新第 {{ draws[0]?.issue }} 期</small>
      </article>
      <article class="stat-card">
        <span>历史样本</span><strong>{{ draws.length }} 期</strong
        ><small>{{ draws.at(-1)?.date }} — {{ draws[0]?.date }}</small>
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
            <p class="section-kicker">LAST 30 DRAWS</p>
            <h2>历史号码折线图</h2>
          </div>
          <div class="legend">
            <span class="red-dot"></span>红球 1–6 <span class="blue-dot"></span>蓝球
          </div>
        </div>
        <svg
          class="trend-chart"
          viewBox="0 0 900 280"
          role="img"
          aria-label="最近 30 期双色球号码走势"
        >
          <line
            v-for="tick in [1, 8, 16, 24, 33]"
            :key="tick"
            x1="42"
            x2="858"
            :y1="chartPoint(0, tick, 1).split(',')[1]"
            :y2="chartPoint(0, tick, 1).split(',')[1]"
            class="grid-line"
          />
          <text
            v-for="tick in [1, 8, 16, 24, 33]"
            :key="`label-${tick}`"
            x="8"
            :y="Number(chartPoint(0, tick, 1).split(',')[1]) + 4"
            class="axis-label"
          >
            {{ tick }}
          </text>
          <polyline
            v-for="(series, index) in chartSeries"
            :key="index"
            :points="series.points"
            :stroke="series.color"
            :class="['series', { 'blue-series': index === 6 }]"
          />
        </svg>
        <div class="chart-footer">
          <span>{{ chartDraws[0]?.issue }}</span
          ><span>{{ chartDraws.at(-1)?.issue }}</span>
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

    <section v-if="showDataPanel" class="panel data-panel">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">LOCAL DATA</p>
          <h2>数据导入与备份</h2>
        </div>
      </div>
      <p class="fine-print">
        每行格式：期号,日期,红1,红2,红3,红4,红5,红6,蓝球。数据与模型参数保存在当前浏览器；换设备前请导出备份。
      </p>
      <textarea
        v-model="importText"
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
    </section>
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
.data-panel {
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
.legend {
  color: #64748b;
  font-size: 11px;
}
.red-dot,
.blue-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin: 0 5px 0 10px;
  border-radius: 50%;
  background: #ef4444;
}
.blue-dot {
  background: #2563eb;
}
.chart-footer {
  display: flex;
  justify-content: space-between;
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
.data-panel textarea {
  resize: vertical;
  font-family: ui-monospace, monospace;
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
}
</style>
