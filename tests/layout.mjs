// 布局边界：空库、1 条、2 条、500 条，五种视图都不能出 NaN 或抛错。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const source = readFileSync(clientPath, 'utf8')
let captured = null
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } } }
const React = {
  createElement: (...a) => ({ a }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  useCallback: (f) => f,
  useMemo: (f) => f(),
  Fragment: 'frag'
}
React.default = React
new Function(source)()
if (!captured) { console.log('NOT CAPTURED'); process.exit(1) }
captured.factory((name) => (name === 'react' ? React : {}))
const hooks = globalThis.__DSHMN__
if (!hooks) {
  console.log('没有导出调试钩子 __DSHMN__')
  process.exit(1)
}
const { buildLayout, stepLayout } = hooks

const mkNode = (i) => ({
  id: `n${i}`,
  title: `记忆 ${i}`,
  body: `正文 ${i}`,
  layer: ['core', 'memory', 'command', 'capability', 'service', 'data'][i % 6],
  kind: ['rule', 'fact', 'todo', 'decision', 'project'][i % 5],
  tags: ['t' + (i % 7)],
  weight: 0.2 + (i % 8) / 10,
  pinned: i % 11 === 0,
  status: i % 13 === 0 ? 'done' : '',
  createdAt: 1793000000000 + i * 60000,
  updatedAt: 1793000000000 + i * 60000
})
const mkEdges = (nodes) => {
  const edges = []
  for (let i = 1; i < nodes.length; i += 1) edges.push({ from: nodes[i].id, to: nodes[Math.floor(i / 2)].id, kind: 'related', weight: 0.5 })
  return edges
}

let bad = 0
const check = (label, layout) => {
  if (!layout) {
    console.log(`  ✗ ${label} 返回空`)
    bad += 1
    return
  }
  let nan = 0
  for (let i = 0; i < layout.count * 3; i += 1) if (!Number.isFinite(layout.positions[i])) nan += 1
  if (nan > 0) {
    console.log(`  ✗ ${label} 有 ${nan} 个 NaN 坐标`)
    bad += 1
  }
}
const views = ['rings', 'nebula', 'cluster', 'timeline', 'list']
const focuses = [null, { id: 'n1' }, { layer: 'core' }, { layer: 'core', kind: 'rule' }]

for (const count of [0, 1, 2, 5, 500]) {
  const nodes = Array.from({ length: count }, (_, i) => mkNode(i))
  const edges = mkEdges(nodes)
  console.log(`## ${count} 条`)
  for (const view of views) {
    for (const focus of focuses) {
      if (focus && focus.id && !nodes.some((n) => n.id === focus.id)) continue
      try {
        const layout = buildLayout(nodes, edges, view, focus)
        if (count === 0) {
          if (layout && layout.count > 0) {
            console.log(`  ✗ ${view}/${focus ? 'focus' : 'all'} 空库居然有节点`)
            bad += 1
          }
          continue
        }
        check(`${view}/${focus ? JSON.stringify(focus) : 'all'}`, layout)
        if (view === 'nebula' && layout) {
          for (let f = 0; f < 30; f += 1) stepLayout(layout, 0.5)
          check(`${view} 跑 30 帧后`, layout)
        }
      } catch (error) {
        console.log(`  ✗ ${view}/${focus ? JSON.stringify(focus) : 'all'} 抛错: ${error.message}`)
        bad += 1
      }
    }
  }
}
console.log(bad === 0 ? '\n全部通过' : `\n有 ${bad} 处问题`)
process.exit(bad === 0 ? 0 : 1)
