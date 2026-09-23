import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@halo-dev/components', async () => {
  const { defineComponent, h, Teleport } = await import('vue')
  return {
    VModal: defineComponent({
      props: {
        title: String,
        width: Number,
        bodyClass: Array,
        mountToBody: Boolean,
        layerClosable: Boolean,
      },
      emits: ['close'],
      setup(props, { emit, expose, slots }) {
        expose({ close: () => emit('close') })
        return () =>
          h(Teleport, { to: 'body' }, [
            h('div', { role: 'dialog' }, [
              h('h2', props.title),
              slots.default?.(),
              h('div', { class: 'modal-footer' }, slots.footer?.()),
            ]),
          ])
      },
    }),
  }
})

import HomeView from '../HomeView.vue'

describe('历史开奖查询', () => {
  beforeEach(() => localStorage.clear())

  it('shows paginated draws and finds the first draw by issue or date', async () => {
    const wrapper = mount(HomeView)
    expect(wrapper.findAll('.history-row')).toHaveLength(20)
    expect(wrapper.find('.history-row').text()).toContain('2026110')

    await wrapper.find('.history-pagination button:last-child').trigger('click')
    expect(wrapper.find('.history-row').text()).toContain('2026090')

    const search = wrapper.get('[aria-label="搜索历史开奖期号或日期"]')
    await search.setValue('2003001')
    expect(wrapper.findAll('.history-row')).toHaveLength(1)
    expect(wrapper.find('.history-row').text()).toContain('2003-02-23')
    expect(wrapper.findAll('.history-row .ball').map((ball) => ball.text())).toEqual([
      '10',
      '11',
      '12',
      '13',
      '26',
      '28',
      '11',
    ])

    await search.setValue('2003-02-23')
    expect(wrapper.findAll('.history-row')).toHaveLength(1)
    await search.setValue('不存在的期号')
    expect(wrapper.find('.history-empty').text()).toContain('没有符合条件')
    wrapper.unmount()
  })

  it('filters by year and resets pagination when the filter changes', async () => {
    const wrapper = mount(HomeView)
    await wrapper.find('.history-pagination button:last-child').trigger('click')
    await wrapper.get('[aria-label="筛选开奖年份"]').setValue('2003')
    expect(wrapper.find('.history-pagination').text()).toContain('第 1 /')
    expect(wrapper.findAll('.history-row')).toHaveLength(20)
    expect(wrapper.findAll('.history-row').every((row) => row.text().includes('2003-'))).toBe(true)
    wrapper.unmount()
  })

  it('filters the chart by an inclusive date range and toggles each ball series', async () => {
    const wrapper = mount(HomeView)
    expect(wrapper.find('.chart-hint').text()).toContain('共 30 期')
    expect(wrapper.find('.chart-footer').text()).toContain('2026110')
    expect(wrapper.findAll('polyline.series')).toHaveLength(7)

    const toggles = wrapper.findAll('.chart-series-toggle')
    expect(toggles).toHaveLength(7)
    for (const [index, toggle] of toggles.entries()) {
      await toggle.trigger('click')
      expect(toggle.attributes('aria-pressed')).toBe('false')
      expect(wrapper.findAll('polyline.series')).toHaveLength(6 - index)
    }
    for (const toggle of toggles) await toggle.trigger('click')
    expect(wrapper.findAll('polyline.series')).toHaveLength(7)

    await wrapper.get('[aria-label="图表截止日期"]').setValue('2003-02-23')
    expect(wrapper.find('.chart-empty').text()).toContain('开始日期不能晚于截至日期')
    await wrapper.get('[aria-label="图表开始日期"]').setValue('2003-02-23')
    expect(wrapper.find('.chart-hint').text()).toContain('共 1 期')
    expect(wrapper.find('.chart-footer').text()).toContain('2003001')

    const svg = wrapper.get<SVGSVGElement>('.trend-chart').element
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 900 } as DOMRect)
    await wrapper.get('.chart-hit-area').trigger('mousemove', { clientX: 450 })
    expect(wrapper.find('.chart-tooltip').text()).toContain('第 2003001 期')
    expect(wrapper.find('.chart-tooltip').text()).toContain('2003-02-23')
    expect(wrapper.findAll('.chart-tooltip .ball').map((ball) => ball.text())).toEqual([
      '10',
      '11',
      '12',
      '13',
      '26',
      '28',
      '11',
    ])

    await wrapper.get('.chart-plot').trigger('mouseleave')
    expect(wrapper.find('.chart-tooltip').exists()).toBe(false)
    await wrapper.get('.chart-hit-area').trigger('focus')
    expect(wrapper.find('.chart-tooltip').exists()).toBe(true)

    await wrapper.get('.chart-controls button').trigger('click')
    expect(wrapper.find('.chart-hint').text()).toContain('共 30 期')
    expect(wrapper.find('.chart-footer').text()).toContain('2026110')
    await wrapper.get('.chart-hit-area').trigger('focus')
    expect(wrapper.find('.chart-tooltip').text()).toContain('2026110')
    await wrapper.get('.chart-hit-area').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.find('.chart-tooltip').text()).toContain('2026109')

    await wrapper.get('[aria-label="图表开始日期"]').setValue('2003-02-23')
    expect(wrapper.find('.chart-hint').text()).toContain('共 3507 期')
    expect(wrapper.findAll('.chart-hit-area')).toHaveLength(1)
    expect(wrapper.findAll('.chart-dot')).toHaveLength(0)
    wrapper.unmount()
  })

  it('opens data management in a modal and returns focus when closed', async () => {
    const wrapper = mount(HomeView, { attachTo: document.body })
    const trigger = wrapper.find<HTMLButtonElement>('.hero-actions button:first-child')
    expect(wrapper.find('.data-import-text').exists()).toBe(false)

    await trigger.trigger('click')
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"] .data-import-text')).not.toBeNull()
    })
    const modal = document.body.querySelector('[role="dialog"]')
    expect(modal?.textContent).toContain('数据导入与备份')
    expect(modal?.textContent).toContain('恢复 JSON 备份')

    modal?.querySelector<HTMLButtonElement>('.modal-footer button')?.click()
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    })
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element))
    wrapper.unmount()
  })
})
