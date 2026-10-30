/**
 * 渲染冒烟：不碰真实 DOM，只把组件函数跑一遍。
 * 目的很具体——抓 `h(...)` 里引用了不存在的东西（KIND_LABEL 写成 KIND_LABELS 那类），
 * 这种错 node --check 查不出来，只在真机上白屏。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const source = readFileSync(clientPath, 'utf8')

let captured = null
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } } }

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  Fragment: 'fragment'
}
React.default = React

new Function(source)()
if (!captured) {
  console.log('NOT CAPTURED')
  process.exit(1)
}
captured.factory((name) => (name === 'react' ? React : {}))

const ui = globalThis.__DSHMN__
if (!ui || !ui.MemoryList) {
  console.log('UI HOOK MISSING')
  process.exit(1)
}

let pass = 0
let fail = 0
const check = (name, fn) => {
  try {
    fn()
    pass += 1
  } catch (error) {
    fail += 1
    console.log(`  ✗ ${name}: ${error && error.message}`)
  }
}

const node = (id, patch = {}) => ({
  id,
  title: `记忆 ${id}`,
  body: '正文',
  layer: 'core',
  kind: 'rule',
  tags: ['a', 'b'],
  weight: 0.6,
  act: 0.5,
  hits: 1,
  pinned: false,
  status: 'open',
  createdAt: 1700000000000,
  updatedAt: 1700000500000,
  ...patch
})

const nodes = [node('n1'), node('n2', { layer: 'data', kind: 'fact' }), node('n3', { pinned: true, status: 'done' })]
const edges = [{ from: 'n1', to: 'n2', kind: 'related', weight: 0.5 }]
const base = {
  nodes,
  edges,
  selectedId: 'n1',
  onSelect: () => {},
  query: '',
  hiddenLayers: new Set(),
  onlyPinned: false,
  statusFilter: 'all',
  sortMode: 'recent',
  ranked: null
}

const text = (tree) => {
  if (tree === null || tree === undefined) return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  return text(tree.children)
}

check('MemoryList 普通列表', () => {
  const out = ui.MemoryList(base)
  if (!text(out).includes('记忆 n1')) throw new Error('没渲染出条目')
})

check('MemoryList 搜索平铺', () => {
  const ranked = new Map([
    ['n2', { id: 'n2', title: '记忆 n2', score: 1.2, why: { matched: [{ token: '插件', field: 'title' }] } }]
  ])
  const out = ui.MemoryList({ ...base, query: '插件', ranked })
  const body = text(out)
  if (!body.includes('检索结果')) throw new Error('搜索时没有平铺')
  if (!body.includes('插件')) throw new Error('没显示命中词')
})

check('MemoryList 空结果', () => {
  const out = ui.MemoryList({ ...base, query: '不存在的词', ranked: new Map() })
  if (!text(out).includes('没有符合条件')) throw new Error('空结果没有提示')
})

check('MemoryList 状态筛选', () => {
  const out = ui.MemoryList({ ...base, statusFilter: 'done' })
  if (!text(out).includes('记忆 n3')) throw new Error('已完成筛选丢了条目')
  if (text(out).includes('记忆 n1')) throw new Error('已完成筛选没过滤掉别的')
})

check('MemoryList 隐藏层', () => {
  const out = ui.MemoryList({ ...base, hiddenLayers: new Set(['core']) })
  if (text(out).includes('记忆 n1')) throw new Error('隐藏层没生效')
})

check('MemoryList 三种排序', () => {
  for (const mode of ['recent', 'weight', 'hits']) ui.MemoryList({ ...base, sortMode: mode })
})

check('GraphCanvas 构造不炸', () => {
  const out = ui.GraphCanvas({
    graph: { nodes, edges },
    layoutNonce: 0,
    hiddenLayers: new Set(),
    hiddenKinds: new Set(),
    query: '',
    onlyPinned: false,
    selectedId: 'n1',
    onSelect: () => {},
    sizeScale: 1,
    labelScale: 1,
    autoRotate: false,
    view: 'rings',
    hitIds: new Set(['n1'])
  })
  if (!out) throw new Error('GraphCanvas 没返回节点')
})

check('GraphCanvas 空数据', () => {
  ui.GraphCanvas({
    graph: null,
    layoutNonce: 0,
    hiddenLayers: new Set(),
    hiddenKinds: new Set(),
    query: '',
    onlyPinned: false,
    selectedId: '',
    onSelect: () => {},
    sizeScale: 1,
    labelScale: 1,
    autoRotate: false,
    view: 'nebula',
    hitIds: null
  })
})

check('MemoryPanel 首屏', () => {
  const out = ui.MemoryPanel()
  if (!out) throw new Error('MemoryPanel 没返回节点')
})

console.log(`通过 ${pass}，失败 ${fail}`)
if (fail > 0) process.exit(1)
