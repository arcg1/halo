import { definePlugin } from '@halo-dev/ui-shared'
import { markRaw } from 'vue'
import RiLineChartLine from '~icons/ri/line-chart-line'

export default definePlugin({
  components: {},
  routes: [
    {
      parentName: 'Root',
      route: {
        path: '/lottery/ssq',
        name: 'DoubleColorBallLab',
        component: () => import(/* webpackChunkName: "HomeView" */ './views/HomeView.vue'),
        meta: {
          title: '双色球实验室',
          searchable: true,
          menu: {
            name: '双色球',
            group: '彩票实验室',
            icon: markRaw(RiLineChartLine),
            priority: 0,
          },
        },
      },
    },
  ],
  extensionPoints: {},
})
