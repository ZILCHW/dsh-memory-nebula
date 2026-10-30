// 边界与异常自检：拿一个临时库跑各种极端输入，看有没有抛错或坏数据。
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { MemoryStore, tokenize, normalizeText } = await import(new URL('../lib/store.js', import.meta.url).href)

const dir = mkdtempSync(join(tmpdir(), 'mn-edge-'))
const store = new MemoryStore(dir)
let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass += 1
  } else {
    fail += 1
    console.log(`  ✗ ${name} ${extra}`)
  }
}
const tryIt = (name, fn) => {
  try {
    fn()
    pass += 1
  } catch (error) {
    fail += 1
    console.log(`  ✗ ${name} 抛错: ${error && error.message}`)
  }
}

console.log('## 空库')
ok('空库 nodes 为 0', store.nodes().length === 0)
ok('空库 search 返回空', store.search('随便什么').length === 0)
ok('空库 stats 不炸', typeof store.stats() === 'object')
ok('空库 mapText 为空串', store.mapText({ tip: '测试' }) === '')

console.log('## 单条 + 特殊字符')
const weirdTitle = '🧪 路径 C:\\Windows\\System32 "引号" <tag> & $var %PATH% —— 超长'.repeat(3)
const a = store.upsert({ title: weirdTitle, text: 'SELECT * FROM nodes; DROP TABLE x; --', kind: 'fact', layer: 'data', tags: ['a b', '含空格'] })
ok('特殊字符能存', !!a && !!a.node && !!a.node.id)
const aid = a.node.id
const got = store.node(aid)
ok('标题按 120 上限截断', got && got.title.length <= 120 && weirdTitle.startsWith(got.title))
ok('正文没被截断', got && got.body.includes('DROP TABLE'))
ok('搜含 emoji 的标题不炸', Array.isArray(store.search('🧪 路径')))

console.log('## 去重')
const dup = store.upsert({ title: weirdTitle, text: 'SELECT * FROM nodes; DROP TABLE x; --', kind: 'fact', layer: 'data', tags: [] })
ok('同标题同正文不会新增节点', store.nodes().length === 1, `现在 ${store.nodes().length} 条`)

console.log('## 检索边界')
ok('空查询返回空', store.search('').length === 0)
ok('空白查询返回空', store.search('   ').length === 0)
ok('单字查询不炸', Array.isArray(store.search('a')))
ok('超长查询不炸', Array.isArray(store.search('很长'.repeat(500))))
ok('纯符号查询不炸', Array.isArray(store.search('!!!###%%%')))
ok('limit 0 不炸', Array.isArray(store.search('路径', { limit: 0 })))
ok('limit 负数不炸', Array.isArray(store.search('路径', { limit: -3 })))
ok('不存在的 kind 过滤返回空', store.search('路径', { kind: 'nope' }).length === 0)

console.log('## 操作不存在的东西')
ok('remove 不存在 id 返回 false', store.remove('m_nope') === false)
ok('node 查不存在返回 undefined', store.node('m_nope') === undefined)
ok('link 不存在不炸', (() => { try { store.link('m_a', 'm_b'); return true } catch { return false } })())
ok('resolveTodo 不存在返回 null', store.resolveTodo('不存在的东西') === null)

console.log('## 自环与重复连线')
const bRaw = store.upsert({ title: '第二条测试记忆', text: '内容', kind: 'rule', layer: 'core', tags: [] })
const bid = bRaw.node.id
const selfEdge = store.link(aid, aid, 'related', 0.5)
ok('不允许自环', !selfEdge)
const e1 = store.link(aid, bid, 'related', 0.5)
const e2 = store.link(aid, bid, 'related', 0.5)
ok('重复连线不会加第二条', e1 && !e2 || (e1 && e2 && store.edges().length === 1), `边数 ${store.edges().length}`)

console.log('## 待办状态机')
const todoRaw = store.upsert({ title: '待办：测试收口', text: '', kind: 'todo', layer: 'memory', tags: [] })
const tid = todoRaw.node.id
ok('todo 默认 open', store.node(tid).status === 'open', `实际 ${store.node(tid).status}`)
const doneRaw = store.upsert({ title: '已完成：测试收口', text: '做完了', kind: 'project', layer: 'memory', tags: [] })
const closed = store.resolveTodo(tid)
store.link(doneRaw.node.id, tid, 'completes', 0.8)
ok('resolveTodo 能收掉', closed && store.node(tid).status === 'done', `实际 ${store.node(tid) && store.node(tid).status}`)
ok('收口后有 completes 边', store.edges().some((e) => e.kind === 'completes'))

console.log('## 注入文本')
store.rememberSituation('测试一下检索')
const text = store.mapText({ tip: '测试' })
ok('注入文本是字符串', typeof text === 'string')
ok('注入文本不超过预算', text.length <= 1200, `长度 ${text.length}`)

console.log('## 坏文件容错')
writeFileSync(join(dir, 'graph.json'), '{ 这不是 json', 'utf8')
tryIt('坏 json 不抛错', () => {
  const s2 = new MemoryStore(dir)
  s2.nodes()
})
const s3 = new MemoryStore(dir)
ok('坏文件读成空库', s3.nodes().length === 0)
writeFileSync(join(dir, 'graph.json'), '[]', 'utf8')
const s4 = new MemoryStore(dir)
ok('顶层是数组也不炸', s4.nodes().length === 0)
writeFileSync(join(dir, 'graph.json'), '{"nodes":[{"id":"x"}],"edges":[{"from":"x","to":"y"}]}', 'utf8')
const s5 = new MemoryStore(dir)
ok('残缺节点被 sanitize 或丢弃，不炸', Array.isArray(s5.nodes()))
ok('指向不存在节点的边被丢掉', s5.edges().length === 0)

console.log('## 分词')
ok('全角字母归一', normalizeText('Ｂ站').includes('b站'))
ok('大小写归一', normalizeText('ABC') === 'abc')
ok('虚词 2-gram 被过滤', !tokenize('人的东西').has('人的'))
ok('实词保留', tokenize('时间怎么取').has('时间'))
ok('停用词不出现', !tokenize('这个怎么办').has('这个'))

rmSync(dir, { recursive: true, force: true })
console.log(`\n通过 ${pass}，失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
