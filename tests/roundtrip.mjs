// 导入/导出的数据正确性：不只看快不快，还要看进来的是不是原样
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { isFragment } from '../lib/index.js'

const makeDir = () => mkdtempSync(join(tmpdir(), 'dshmn-roundtrip-'))

const sample = (i) => ({
  id: 'rt' + String(i).padStart(4, '0'),
  title: `第 ${i} 条测试记忆 · 中文标题`,
  body: `正文第 ${i} 条，包含数字 ${i * 7}、路径 C:\\temp\\${i} 和标点：。（）`,
  kind: ['fact', 'preference', 'rule', 'todo', 'decision'][i % 5],
  layer: ['core', 'memory', 'command', 'capability', 'service', 'data'][i % 6],
  tags: ['测试', 'rt' + (i % 3), i % 2 === 0 ? '偶数' : '奇数'],
  weight: Number((0.3 + ((i % 7) * 0.1)).toFixed(2)),
  pinned: i % 11 === 0,
  status: i % 5 === 3 ? (i % 2 === 0 ? 'open' : 'done') : ''
})

test('500 条批量导入后字段逐条一致', () => {
  const dir = makeDir()
  try {
    const store = new MemoryStore(dir)
    const rows = Array.from({ length: 500 }, (_, i) => sample(i))
    for (const row of rows) store.upsert(row, { silent: true })
    store.save()

    const reopened = new MemoryStore(dir)
    const nodes = reopened.nodes()
    assert.equal(nodes.length, 500, '条数应一致')

    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const row of rows) {
      const got = byId.get(row.id)
      assert.ok(got, `缺少 ${row.id}`)
      assert.equal(got.body, row.body, `${row.id} 正文不一致`)
      assert.equal(got.title, row.title, `${row.id} 标题不一致`)
      assert.equal(got.kind, row.kind, `${row.id} kind 不一致`)
      assert.equal(got.layer, row.layer, `${row.id} layer 不一致`)
      assert.deepEqual(got.tags, row.tags, `${row.id} 标签不一致`)
      assert.equal(got.pinned, row.pinned, `${row.id} pinned 不一致`)
      if (row.status) assert.equal(got.status, row.status, `${row.id} status 不一致`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('silent 期间不落盘，save 之后才看得见', () => {
  const dir = makeDir()
  try {
    const store = new MemoryStore(dir)
    store.upsert({ id: 'a1', title: '静默写入的那条', body: '正文要足够长才算有效记录' }, { silent: true })
    const before = new MemoryStore(dir)
    assert.equal(before.nodes().length, 0, 'silent 期间不该落盘')
    store.save()
    const after = new MemoryStore(dir)
    assert.equal(after.nodes().length, 1, 'save 之后应可见')
    assert.equal(after.nodes()[0].body, '正文要足够长才算有效记录')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('导出再导入，内容等价', () => {
  const from = makeDir()
  const to = makeDir()
  try {
    const src = new MemoryStore(from)
    for (let i = 0; i < 60; i += 1) src.upsert(sample(i), { silent: true })
    src.save()
    src.link('rt0000', 'rt0001', 'related', 0.7)
    src.link('rt0002', 'rt0003', 'completes', 0.9)
    const exported = { nodes: src.nodes(), edges: src.edges() }

    const dst = new MemoryStore(to)
    for (const node of exported.nodes) dst.upsert(node, { silent: true })
    dst.save()
    for (const edge of exported.edges) dst.link(edge.from, edge.to, edge.kind, edge.weight, true)
    dst.save()

    const back = new MemoryStore(to)
    assert.equal(back.nodes().length, 60)
    assert.equal(back.edges().length, 2)
    const map = new Map(back.nodes().map((n) => [n.id, n]))
    for (let i = 0; i < 60; i += 1) {
      assert.equal(map.get('rt' + String(i).padStart(4, '0')).body, sample(i).body)
    }
  } finally {
    rmSync(from, { recursive: true, force: true })
    rmSync(to, { recursive: true, force: true })
  }
})

test('自动收待办：真事收得掉，模板标题不乱收', () => {
  const dir = makeDir()
  try {
    const store = new MemoryStore(dir)
    // 真事：待办与完成记录写法不同，但关键实体一致
    store.upsert({ id: 'td1', title: '没做完：人设插件 + 旧本已迁移', body: '人设插件还没写，旧记事本还没迁', kind: 'todo' }, { silent: true })
    const done = store.upsert(
      { id: 'dn1', title: '已完成：人设插件(dsh-soul) + 旧本迁移', body: '人设插件落地，旧本已经迁完归档', kind: 'fact' }
    )
    assert.ok(done.autoClosed, '写法不同但指的是同一件事，应该自动收掉')
    assert.equal(store.node('td1').status, 'done')

    // 模板标题：同一个模子套出来的，不算同一件事
    store.upsert({ id: 'td2', title: '第 3 条测试记忆 · 中文标题', body: '这只是模板化标题的待办', kind: 'todo' }, { silent: true })
    const other = store.upsert(
      { id: 'fx2', title: '第 8 条测试记忆 · 中文标题', body: '这只是模板化标题的另一条记录', kind: 'fact' },
      { silent: true }
    )
    assert.equal(other.autoClosed, null, '模板标题不该被当成同一个待办')
    assert.equal(store.node('td2').status, 'open')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('碎片判定', () => {
  assert.equal(isFragment('n', '正文足够长足够长'), true, '标题太短应丢弃')
  assert.equal(isFragment('一个正常的标题', '太短'), true, '正文太短应丢弃')
  assert.equal(isFragment('  ', '正文足够长足够长'), true, '空白标题应丢弃')
  assert.equal(isFragment(null, null), true, '空值应丢弃')
  assert.equal(isFragment('桌面端插件安装方式', '这是足够长的正文内容用于测试'), false, '正常记录应保留')
  assert.equal(isFragment('ness Web GUI 地址', 'ness 的 Web GUI URL：http://127.0.0.1:61272'), false, '这条长度够，靠提示词拦')
})
