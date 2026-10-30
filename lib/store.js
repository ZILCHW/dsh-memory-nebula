// dsh-memory-nebula —— 记忆图存储层
// 纯 Node，无第三方依赖。数据落在 ~/.dsh/memory-net/graph.json（原子写）。
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const LAYERS = ['core', 'memory', 'command', 'capability', 'service', 'data']
export const KINDS = ['fact', 'preference', 'decision', 'rule', 'todo', 'event', 'person', 'project', 'skill', 'other']

const HALF_LIFE_DAYS = 45
const ACT_HALF_LIFE_HOURS = 12
const RECENCY_HALF_LIFE_DAYS = 7
const DAY_MS = 86400000

export function resolveDataDir(env = process.env) {
  const fromEnv = typeof env.DSH_MEMORY_NET_DIR === 'string' ? env.DSH_MEMORY_NET_DIR.trim() : ''
  if (fromEnv) return fromEnv
  const home = os.homedir()
  return path.join(home, '.dsh', 'memory-net')
}

function nowMs() {
  return Date.now()
}

function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${nowMs().toString(36)}${rand}`
}

function clamp01(value, fallback = 0.5) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function asText(value, limit) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\r\n/g, '\n').trim()
  if (typeof limit === 'number' && text.length > limit) return text.slice(0, limit)
  return text
}

function asTags(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、\s]+/) : []
  const seen = new Set()
  const out = []
  for (const item of list) {
    const tag = asText(item, 24)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= 8) break
  }
  return out
}

function normalizeKind(value) {
  const kind = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return KINDS.includes(kind) ? kind : 'other'
}

function normalizeLayer(value) {
  const layer = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return LAYERS.includes(layer) ? layer : 'memory'
}

/** 中文友好分词：英文/数字按词，中文按 2-gram（单字段保留单字）。 */
const STOP_WORDS = new Set([
  '的', '了', '是', '我', '你', '他', '她', '它', '们', '吗', '呢', '吧', '啊', '呀', '嘛', '哦', '嗯',
  '这', '那', '有', '和', '与', '就', '都', '也', '还', '要', '会', '能', '可', '去', '来', '说', '做',
  '用', '个', '把', '被', '给', '让', '对', '从', '到', '里', '上', '下', '中', '过', '很', '再', '又',
  '才', '只', '着', '得', '地', '不', '没',
  '什么', '怎么', '为什', '如何', '哪个', '哪些', '这个', '那个', '我们', '你们', '他们', '可以',
  '应该', '现在', '今天', '明天', '的话', '一下', '有点', '一些', '时候', '东西', '事情', '感觉',
  '觉得', '但是', '因为', '所以', '如果', '然后', '而且', '还有', '就是', '不是', '没有', '一个',
  'the', 'a', 'an', 'is', 'are', 'to', 'of', 'and', 'in', 'on', 'for', 'it', 'this', 'that', 'with'
])

// 同义词：同一个意思的不同说法，撞到一个就把整组都算进来
const SYNONYM_GROUPS = [
  ['白屏', '空白', '黑屏', '看不见', '没显示', '不显示', '空着', '看不到'],
  ['b站', 'bilibili', 'bili', '哔哩', '哔哩哔哩', '小破站'],
  ['插件', 'plugin', '扩展', '外挂'],
  ['星云', '图谱', '记忆图', '神经元', '星球', '记忆星云'],
  ['断电', '关机', '下线', '睡觉', '休息', '熄灯'],
  ['删除', '删掉', '清掉', '移除', 'remove', 'delete'],
  ['安装', '装', '部署', 'install', 'add'],
  ['报错', '错误', '失败', '崩', 'error', '挂', '白屏'],
  ['检索', '搜索', '查找', 'search', '查', '找'],
  ['记忆', '记住', 'remember', '牢记'],
  ['重启', '重载', 'reload', '刷新', 'restart'],
  ['端口', 'port', '地址', 'url'],
  ['声音', '语音', 'tts', '音频', '嗓'],
  ['人格', '人设', '性格', 'persona']
]

const WEAK_CHARS = new Set(['的', '了', '是', '在', '和', '与', '就', '都', '也', '很', '着', '过', '把',
  '被', '给', '让', '对', '从', '到', '呢', '吗', '吧', '啊', '呀', '哦', '嗯', '这', '那', '我', '你', '他',
  '她', '它', '们', '之', '而', '着'])

const STOP_PAIRS = new Set(['什么', '怎么', '为什', '如何', '这个', '那个', '我们', '你们', '他们', '可以',
  '应该', '现在', '今天', '的话', '一下', '一点', '有些', '时候', '东西', '事情', '感觉', '觉得',
  '但是', '因为', '所以', '如果', '然后', '而且', '还有', '就是', '不是', '没有', '一个', '我了',
  '了吗', '的呢', '吧啊', '是不', '是不', '么了', '怎了'])

/** 粗分词：英文数字词 + 整串 2-gram（跨中英），再丢掉没有信息量的虚词。 */
export function normalizeText(text) {
  return String(text || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
    .toLowerCase()
}

export function tokenize(text) {
  const out = new Set()
  const s = normalizeText(text).replace(/[\u3000\s]+/g, ' ').trim()
  if (!s) return out
  for (const m of s.matchAll(/[a-z0-9_]{2,}/g)) {
    if (!STOP_WORDS.has(m[0])) out.add(m[0])
  }
  const flat = s.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
  for (let i = 0; i + 1 < flat.length; i += 1) {
    const pair = flat.slice(i, i + 2)
    if (STOP_WORDS.has(pair) || STOP_PAIRS.has(pair)) continue
    // 只要一个字是虚词，这个词就说明不了主题（"人的""是的""在了"）
    if (WEAK_CHARS.has(pair[0]) || WEAK_CHARS.has(pair[1])) continue
    out.add(pair)
  }
  if (flat.length >= 3) {
    for (const m of flat.matchAll(/[a-z0-9_]{3,}/g)) {
      if (!STOP_WORDS.has(m[0])) out.add(m[0])
    }
  }
  return out
}

/** 查询扩展：把命中同义词组的所有说法都按 0.7 权重补进来。 */
export function expandTokens(tokens, cooc) {
  const weights = new Map()
  for (const token of tokens) weights.set(token, 1)
  for (const token of tokens) {
    for (const group of SYNONYM_GROUPS) {
      if (!group.includes(token)) continue
      for (const word of group) {
        if (word === token) continue
        if (weights.has(word)) continue
        weights.set(word, 0.7)
      }
    }
  }
  // 从库里学到的共现：出现过两次以上才算「这俩常一起说」
  if (cooc && cooc.size > 0) {
    for (const token of tokens) {
      const inner = cooc.get(token)
      if (!inner) continue
      const top = Array.from(inner.entries())
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
      for (const [word] of top) {
        if (weights.has(word)) continue
        weights.set(word, 0.45)
      }
    }
  }
  return weights
}

/** 时间衰减后的有效权重：45 天半衰期，pinned 不掉。 */
export function effectiveWeight(node, at = nowMs()) {
  const base = clamp01(node && node.weight)
  if (node && node.pinned) return Math.min(1, base + 0.15)
  const touched = typeof node?.lastHitAt === 'number' && node.lastHitAt > 0 ? node.lastHitAt : node?.updatedAt
  const age = typeof touched === 'number' ? Math.max(0, at - touched) : 0
  const decay = Math.pow(0.5, age / (HALF_LIFE_DAYS * DAY_MS))
  return base * (0.35 + 0.65 * decay)
}

/** 当前激活强度：刚想起过的记忆是亮的，几小时没碰就暗下去。 */
export function activation(node, at = nowMs()) {
  const raw = typeof node?.act === 'number' && Number.isFinite(node.act) ? node.act : 0
  if (raw <= 0) return 0
  const touched = typeof node?.lastHitAt === 'number' && node.lastHitAt > 0 ? node.lastHitAt : node?.updatedAt
  const age = typeof touched === 'number' ? Math.max(0, at - touched) : 0
  return Math.min(1.5, raw * Math.pow(0.5, age / (ACT_HALF_LIFE_HOURS * 3600000)))
}

/** 新鲜度：最近写下的更鲜活。 */
export function recency(node, at = nowMs()) {
  const stamp = typeof node?.createdAt === 'number' ? node.createdAt : at
  const age = Math.max(0, at - stamp)
  return Math.pow(0.5, age / (RECENCY_HALF_LIFE_DAYS * DAY_MS))
}

function emptyGraph() {
  return { version: 1, updatedAt: nowMs(), nodes: [], edges: [] }
}

function sanitizeNode(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = asText(raw.title, 120)
  const body = asText(raw.body, 4000)
  if (!title && !body) return null
  const created = Number.isFinite(raw.createdAt) ? raw.createdAt : nowMs()
  const kind = normalizeKind(raw.kind)
  const status = raw.status === 'done' || raw.status === 'parked' ? raw.status : kind === 'todo' ? 'open' : ''
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : newId('m'),
    title: title || body.slice(0, 40),
    body: body || title,
    kind,
    layer: normalizeLayer(raw.layer),
    status,
    tags: asTags(raw.tags),
    weight: clamp01(raw.weight),
    pinned: raw.pinned === true,
    createdAt: created,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : created,
    lastHitAt: Number.isFinite(raw.lastHitAt) ? raw.lastHitAt : 0,
    hits: Number.isFinite(raw.hits) && raw.hits > 0 ? Math.floor(raw.hits) : 0,
    act: Number.isFinite(raw.act) && raw.act > 0 ? Math.min(1.5, raw.act) : 0,
    strength: Number.isFinite(raw.strength) && raw.strength > 0 ? Math.min(6, raw.strength) : 1,
    source: typeof raw.source === 'string' ? raw.source : 'manual'
  }
}

function sanitizeEdge(raw, nodeIds) {
  if (!raw || typeof raw !== 'object') return null
  const from = typeof raw.from === 'string' ? raw.from : ''
  const to = typeof raw.to === 'string' ? raw.to : ''
  if (!from || !to || from === to) return null
  if (nodeIds && (!nodeIds.has(from) || !nodeIds.has(to))) return null
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : newId('e'),
    from,
    to,
    kind: typeof raw.kind === 'string' && raw.kind.trim() ? raw.kind.trim().slice(0, 24) : 'related',
    weight: clamp01(raw.weight, 0.5)
  }
}

export class MemoryStore {
  constructor(dataDir) {
    this.dataDir = dataDir || resolveDataDir()
    this.file = path.join(this.dataDir, 'graph.json')
    this.graph = null
    this.dirty = false
    this.tip = null
    this.fieldCache = new Map()
  }

  /** 倒排索引：词 → 出现在哪些记忆里。查询时先缩小候选，不用全表扫描。 */
  invertedIndex() {
    const signature = this.fileSignature()
    if (this.indexCache && this.indexSignature === signature) return this.indexCache
    const map = new Map()
    for (const node of this.nodes()) {
      const fields = this.fieldsOf(node)
      const bag = new Set([...fields.title, ...fields.tags, ...fields.body])
      for (const token of bag) {
        if (!map.has(token)) map.set(token, new Set())
        map.get(token).add(node.id)
      }
    }
    this.indexCache = map
    this.indexSignature = signature
    return map
  }

  /** 从库里学词与词的共现（同一条记忆的标题/标签里一起出现就算）。 */
  cooccurrence() {
    const signature = this.fileSignature()
    if (this.coCache && this.coSignature === signature) return this.coCache
    const pairs = new Map()
    const bump = (from, to) => {
      if (!pairs.has(from)) pairs.set(from, new Map())
      const inner = pairs.get(from)
      inner.set(to, (inner.get(to) || 0) + 1)
    }
    for (const node of this.nodes()) {
      const bag = new Set()
      for (const token of tokenize(node.title)) bag.add(token)
      for (const tag of node.tags) for (const token of tokenize(tag)) bag.add(token)
      const list = Array.from(bag)
      for (let i = 0; i < list.length; i += 1) {
        for (let j = 0; j < list.length; j += 1) {
          if (i === j) continue
          bump(list[i], list[j])
        }
      }
    }
    this.coCache = pairs
    this.coSignature = signature
    return pairs
  }

  fileSignature() {
    try {
      const info = statSync(this.file)
      return `${info.mtimeMs}:${info.size}`
    } catch {
      return 'missing'
    }
  }

  load() {
    const signature = this.fileSignature()
    if (this.graph && this.signature === signature) return this.graph
    let raw = null
    try {
      if (existsSync(this.file)) raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      raw = null
    }
    const graph = emptyGraph()
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.nodes)) {
        for (const item of raw.nodes) {
          const node = sanitizeNode(item)
          if (node) graph.nodes.push(node)
        }
      }
      const ids = new Set(graph.nodes.map((n) => n.id))
      if (Array.isArray(raw.edges)) {
        for (const item of raw.edges) {
          const edge = sanitizeEdge(item, ids)
          if (edge) graph.edges.push(edge)
        }
      }
      if (Number.isFinite(raw.updatedAt)) graph.updatedAt = raw.updatedAt
    }
    this.graph = graph
    this.signature = signature
    return graph
  }

  save() {
    const graph = this.load()
    graph.updatedAt = nowMs()
    try {
      mkdirSync(this.dataDir, { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(graph, null, 1), 'utf8')
      renameSync(tmp, this.file)
      this.signature = this.fileSignature()
      this.dirty = false
    } catch (error) {
      this.dirty = true
      throw error
    }
    return graph
  }

  nodes() {
    return this.load().nodes
  }

  edges() {
    return this.load().edges
  }

  node(id) {
    return this.nodes().find((n) => n.id === id)
  }

  /** 标题/正文去重：同一件事不重复存。 */
  findDuplicate(title, body) {
    const a = asText(title, 120).toLowerCase()
    const b = asText(body, 600).toLowerCase()
    for (const node of this.nodes()) {
      if (a && node.title.toLowerCase() === a) return node
      if (b && node.body.slice(0, 600).toLowerCase() === b) return node
    }
    return null
  }

  upsert(input = {}) {
    const graph = this.load()
    const title = asText(input.title, 120)
    const body = asText(input.body, 4000)
    const id = typeof input.id === 'string' ? input.id.trim() : ''
    const existing = id ? this.node(id) : this.findDuplicate(title, body)
    const at = nowMs()
    if (existing) {
      if (title) existing.title = title
      if (body) existing.body = body
      if (input.kind !== undefined) existing.kind = normalizeKind(input.kind)
      if (input.layer !== undefined) existing.layer = normalizeLayer(input.layer)
      if (input.tags !== undefined) existing.tags = asTags(input.tags)
      if (input.weight !== undefined) existing.weight = clamp01(input.weight, existing.weight)
      if (input.pinned !== undefined) existing.pinned = input.pinned === true
      if (input.status !== undefined) existing.status = input.status === 'done' || input.status === 'parked' ? input.status : 'open'
      existing.updatedAt = at
      existing.source = input.source || existing.source
      this.save()
      return { node: existing, created: false }
    }
    const node = sanitizeNode({
      id: id || newId('m'),
      title: title || body.slice(0, 40),
      body: body || title,
      kind: input.kind,
      layer: input.layer,
      tags: input.tags,
      weight: input.weight,
      pinned: input.pinned,
      status: input.status,
      createdAt: at,
      updatedAt: at,
      source: input.source || 'manual'
    })
    graph.nodes.push(node)
    this.save()
    // 新记录如果跟某条没做完的待办标题高度重合，就当成做完了，自动收掉
    let autoClosed = null
    if (node.kind !== 'todo') {
      const fresh = tokenize(node.title)
      let best = null
      let bestScore = 0
      for (const other of this.nodes()) {
        if (other.id === node.id || other.kind !== 'todo' || other.status !== 'open') continue
        const cand = tokenize(other.title)
        if (cand.size === 0) continue
        let inter = 0
        for (const t of cand) if (fresh.has(t)) inter += 1
        const union = cand.size + fresh.size - inter
        const score = union > 0 ? inter / union : 0
        if (score > bestScore) {
          bestScore = score
          best = other
        }
      }
      if (best && bestScore >= 0.4) {
        autoClosed = this.resolveTodo(best.id)
        if (autoClosed) {
          try {
            this.link(node.id, best.id, 'completes', 0.8)
          } catch {
            // 连线失败不影响主流程
          }
        }
      }
    }
    return { node, created: true, autoClosed }
  }

  /** 把一条待办收掉（默认完成，也可以标成搁置）。matches 是 id 或标题片段。 */
  resolveTodo(matches, status = 'done') {
    const needle = String(matches || '').trim().toLowerCase()
    if (!needle) return null
    const graph = this.load()
    let target = graph.nodes.find((node) => node.id === needle)
    if (!target) {
      target = graph.nodes.find((node) => {
        if (node.kind !== 'todo') return false
        const title = node.title.toLowerCase()
        return title.includes(needle) || needle.includes(title)
      })
    }
    if (!target || target.kind !== 'todo') return null
    target.status = status === 'parked' ? 'parked' : 'done'
    target.updatedAt = nowMs()
    this.save()
    return target
  }

  remove(id) {
    const graph = this.load()
    const before = graph.nodes.length
    graph.nodes = graph.nodes.filter((n) => n.id !== id)
    graph.edges = graph.edges.filter((e) => e.from !== id && e.to !== id)
    if (graph.nodes.length === before) return false
    this.save()
    return true
  }

  link(from, to, kind = 'related', weight = 0.6) {
    const graph = this.load()
    if (!this.node(from) || !this.node(to) || from === to) return null
    const dup = graph.edges.find((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))
    if (dup) {
      dup.weight = Math.max(dup.weight, clamp01(weight, 0.6))
      this.save()
      return dup
    }
    const edge = sanitizeEdge({ from, to, kind, weight }, new Set(graph.nodes.map((n) => n.id)))
    if (!edge) return null
    graph.edges.push(edge)
    this.save()
    return edge
  }

  unlink(from, to) {
    const graph = this.load()
    const before = graph.edges.length
    graph.edges = graph.edges.filter((e) => !((e.from === from && e.to === to) || (e.from === to && e.to === from)))
    if (graph.edges.length === before) return false
    this.save()
    return true
  }

  neighbors(id) {
    const out = []
    for (const edge of this.edges()) {
      if (edge.from === id) out.push({ edge, node: this.node(edge.to) })
      else if (edge.to === id) out.push({ edge, node: this.node(edge.from) })
    }
    return out.filter((item) => item.node)
  }

  /** 可及性：底子（权重×久远衰减）× 当前激活 × 巩固度。 */
  accessibility(node, at = nowMs()) {
    const base = effectiveWeight(node, at)
    const live = activation(node, at)
    const strength = typeof node.strength === 'number' && node.strength > 0 ? node.strength : 1
    let value = base * (0.6 + 0.4 * live) * (1 + 0.1 * Math.log1p(strength))
    if (node.pinned) value *= 1.18
    return value
  }

  /** 关键词通路：标题/标签/正文命中，整串命中额外加分。 */
  /** 每个节点的分词结果，按 updatedAt 缓存，避免每轮重复切词。 */
  fieldsOf(node) {
    const stamp = node.updatedAt || 0
    const cached = this.fieldCache.get(node.id)
    if (cached && cached.stamp === stamp) return cached.fields
    const fields = {
      title: tokenize(node.title),
      tags: tokenize(node.tags.join(' ')),
      body: tokenize(node.body)
    }
    this.fieldCache.set(node.id, { stamp, fields })
    return fields
  }

  lexicalScore(node, queryTokens, queryText, idf, fields) {
    let hit = 0
    if (queryTokens && queryTokens.size > 0) {
      const title = (fields && fields.title) || tokenize(node.title)
      const tags = (fields && fields.tags) || tokenize(node.tags.join(' '))
      const body = (fields && fields.body) || tokenize(node.body)
      for (const [token, weight] of queryTokens) {
        // 罕见的词更说明问题：常见词（插件、记忆）自动降权
        const boost = weight * (idf ? idf(token) : 1)
        if (title.has(token)) hit += 6 * boost
        if (tags.has(token)) hit += 4 * boost
        if (body.has(token)) hit += 1.5 * boost
      }
      hit /= Math.sqrt(queryTokens.size)
    }
    const text = String(queryText || '').trim().toLowerCase()
    if (text.length >= 2) {
      if (node.title.toLowerCase().includes(text)) hit += 5
      else if (node.tags.some((tag) => tag.toLowerCase().includes(text))) hit += 3
      else if (node.body.toLowerCase().includes(text)) hit += 1.5
    }
    return hit
  }

  /**
   * 联想扩散：从种子的连线往外传，像想起一件事顺带拽出一串。
   * 返回 Map(id -> { value, via })：value 是传过来的强度，via 是从哪条想起来的。
   */
  spread(seedScores, options = {}) {
    const hops = Number.isFinite(options.hops) ? options.hops : 3
    const decay = Number.isFinite(options.decay) ? options.decay : 0.55
    const out = new Map()
    let frontier = new Map(seedScores)
    for (let hop = 1; hop <= hops && frontier.size > 0; hop += 1) {
      const next = new Map()
      for (const [id, value] of frontier) {
        for (const item of this.neighbors(id)) {
          const edgeWeight = item.edge && Number.isFinite(item.edge.weight) ? item.edge.weight : 0.5
          const carried = value * decay * (0.4 + 0.6 * edgeWeight)
          if (carried < 0.04) continue
          if (carried > (next.get(item.node.id) || 0)) next.set(item.node.id, carried)
        }
      }
      for (const [id, value] of next) {
        if (seedScores.has(id)) continue
        const known = out.get(id)
        if (!known || value > known.value) out.set(id, { value, via: '' })
      }
      frontier = next
    }
    // 回填 via：谁把这条带出来的（种子优先，其次路上分数最高的邻居）
    for (const [id, info] of out) {
      let best = ''
      let bestValue = -1
      for (const item of this.neighbors(id)) {
        const seedValue = seedScores.get(item.node.id)
        const passed = out.get(item.node.id)
        const value = Math.max(seedValue !== undefined ? seedValue : -1, passed ? passed.value : -1)
        if (value > bestValue) {
          bestValue = value
          best = item.node.id
        }
      }
      info.via = best
    }
    return out
  }

  /**
   * 三通路检索：关键词 + 联想扩散 + 可及性，融合排序。
   * 像人脑：先看到字面上的，再顺着连线想起相关的，最后按记忆的鲜活程度排序。
   */
  search(query, options = {}) {
    const at = nowMs()
    const text = asText(query, 200)
    const tokens = expandTokens(tokenize(text), this.cooccurrence())
    const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(50, options.limit)) : 8
    const kind = options.kind ? normalizeKind(options.kind) : ''
    const layer = options.layer ? normalizeLayer(options.layer) : ''
    const pool = []
    for (const node of this.nodes()) {
      if (kind && node.kind !== kind) continue
      if (layer && node.layer !== layer) continue
      pool.push(node)
    }
    // 用倒排索引先把范围收窄到「至少命中一个词」的那些
    const index = this.invertedIndex()
    const hitIds = new Set()
    for (const token of tokens.keys()) {
      const bucket = index.get(token)
      if (bucket) for (const id of bucket) hitIds.add(id)
    }
    if (pool.length === 0) return []
    const poolIds = new Set(pool.map((node) => node.id))

    // 先给每个词算 IDF：越罕见的词越能代表这次想找的东西
    const candidates = hitIds.size > 0 ? pool.filter((node) => hitIds.has(node.id)) : []
    const fields = new Map()
    for (const node of candidates) fields.set(node.id, this.fieldsOf(node))
    const df = new Map()
    for (const token of tokens.keys()) {
      let seen = 0
      for (const value of fields.values()) {
        if (value.title.has(token) || value.tags.has(token) || value.body.has(token)) seen += 1
      }
      df.set(token, seen)
    }
    const idf = (token) => Math.log(1 + pool.length / (1 + (df.get(token) || 0)))

    // 一、字面命中（按 IDF 加权）
    const lexical = new Map()
    for (const node of candidates) {
      const value = this.lexicalScore(node, tokens, text, idf, fields.get(node.id))
      if (value > 0) lexical.set(node.id, value)
    }
    let lexicalMax = 0
    for (const value of lexical.values()) lexicalMax = Math.max(lexicalMax, value)

    // 二、从最强的几个字面命中往外联想
    const seeds = new Map()
    for (const [id, value] of Array.from(lexical.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      seeds.set(id, lexicalMax > 0 ? value / lexicalMax : value)
    }
    const spreadRaw = seeds.size > 0 ? this.spread(seeds) : new Map()
    // 种子已经归一化到 1，扩散出来的分不重新归一化，免得一条沾边的也被抬到满分
    const spreadMax = 1

    // 三、融合：字面 / 联想 / 可及性 / 新鲜度
    const results = []
    for (const node of pool) {
      const lex = lexical.get(node.id) || 0
      const spreadInfo = spreadRaw.get(node.id)
      const spr = spreadInfo ? spreadInfo.value : 0
      if (lex <= 0 && spr <= 0) continue
      const lexNorm = lexicalMax > 0 ? lex / lexicalMax : 0
      const sprNorm = spreadMax > 0 ? spr / spreadMax : 0
      const access = this.accessibility(node, at)
      const fresh = recency(node, at)
      const score = lexNorm * 1.0 + sprNorm * 0.5 + access * 0.22 + fresh * 0.1
      results.push({
        node,
        score,
        why: {
          lexical: Number(lexNorm.toFixed(3)),
          spread: Number(sprNorm.toFixed(3)),
          access: Number(access.toFixed(3)),
          via: spreadInfo && spreadInfo.via && poolIds.has(spreadInfo.via) ? spreadInfo.via : ''
        }
      })
    }
    if (results.length === 0) return []
    results.sort((a, b) => b.score - a.score || (b.node.updatedAt || 0) - (a.node.updatedAt || 0))
    // 相对门槛：比起第一名差太远的，就是沾边，不端上桌
    const top = results[0].score
    const floor = Math.max(0.12, top * 0.42)
    return results.filter((item) => item.score >= floor).slice(0, limit)
  }

  /** 新节点自动连线：共享标签优先，其次正文相似度。 */
  autoLink(node, max = 3) {
    const created = []
    const all = this.nodes()
    if (all.length <= 1) return created
    // 只在「标题语义」或「标签」上找亲戚；正文里的功能词（验证/用于/自动）
    // 常常跨主题撞车，按它连线只会长出一堆噪声边。
    const titleSets = new Map()
    const df = new Map()
    for (const other of all) {
      const set = tokenize(other.title)
      titleSets.set(other.id, set)
      for (const token of set) df.set(token, (df.get(token) || 0) + 1)
    }
    const total = all.length
    const weightOf = (token) => Math.log(1 + total / (1 + (df.get(token) || 0)))
    const selfTitle = titleSets.get(node.id) || tokenize(node.title)
    const tagSet = new Set(node.tags)
    const candidates = []
    for (const other of all) {
      if (other.id === node.id) continue
      const otherTitle = titleSets.get(other.id)
      if (!otherTitle) continue
      let semantic = 0
      for (const token of selfTitle) if (otherTitle.has(token)) semantic += weightOf(token)
      let tagHit = 0
      for (const tag of other.tags) if (tagSet.has(tag)) tagHit += 1
      const affinity = Math.min(1, semantic * 0.12) + Math.min(0.5, tagHit * 0.25)
      if (affinity >= 0.3) candidates.push({ id: other.id, affinity })
    }
    candidates.sort((a, b) => b.affinity - a.affinity)
    for (const item of candidates.slice(0, max)) {
      const edge = this.link(node.id, item.id, 'related', Math.min(0.9, 0.3 + item.affinity))
      if (edge) created.push(edge)
    }
    return created
  }

  /** 被想起一次，就亮一点、记得牢一点（提取练习）。 */
  reinforce(ids, amount = 0.45, at = nowMs()) {
    if (!ids || ids.length === 0) return 0
    const wanted = new Set(ids)
    const graph = this.load()
    let changed = 0
    for (const node of graph.nodes) {
      if (!wanted.has(node.id)) continue
      const live = typeof node.act === 'number' ? node.act : 0
      node.act = Math.min(1, live + amount)
      const strength = typeof node.strength === 'number' && node.strength > 0 ? node.strength : 1
      node.strength = Math.min(6, strength * 1.08 + 0.04)
      node.hits = (node.hits || 0) + 1
      node.lastHitAt = at
      changed += 1
    }
    if (changed > 0) this.save()
    return changed
  }

  /** 一段时间的遗忘：没被想起的慢慢变暗。只降激活，不删内容。 */
  settle(at = nowMs()) {
    const graph = this.load()
    let changed = 0
    for (const node of graph.nodes) {
      if (typeof node.act !== 'number' || node.act <= 0) continue
      const live = activation(node, at)
      if (live < 0.02) {
        if (node.act !== 0) {
          node.act = 0
          changed += 1
        }
        continue
      }
      if (Math.abs(live - node.act) > 0.01) {
        node.act = live
        changed += 1
      }
    }
    if (changed > 0) this.save()
    return changed
  }

  touch(ids, at = nowMs()) {
    if (!ids || ids.length === 0) return
    const graph = this.load()
    let changed = false
    for (const node of graph.nodes) {
      if (!ids.includes(node.id)) continue
      node.hits = (node.hits || 0) + 1
      node.lastHitAt = at
      changed = true
    }
    if (changed) this.save()
  }

  stats() {
    const now = nowMs()
    const nodes = this.nodes()
    const edges = this.edges()
    const byLayer = {}
    const byKind = {}
    for (const node of nodes) {
      byLayer[node.layer] = (byLayer[node.layer] || 0) + 1
      byKind[node.kind] = (byKind[node.kind] || 0) + 1
    }
    const linked = new Set()
    for (const edge of edges) {
      linked.add(edge.from)
      linked.add(edge.to)
    }
    return {
      nodes: nodes.length,
      edges: edges.length,
      pinned: nodes.filter((n) => n.pinned).length,
      isolated: nodes.filter((n) => !linked.has(n.id)).length,
      hot: nodes.filter((n) => activation(n, now) > 0.15).length,
      avgStrength: Number((nodes.reduce((sum, n) => sum + (typeof n.strength === 'number' ? n.strength : 1), 0) / Math.max(1, nodes.length)).toFixed(2)),
      byLayer,
      byKind,
      dataFile: this.file
    }
  }

  /** 最近一句用户原话，用来让注入跟着"现在在聊什么"走。 */
  situation() {
    if (this.tip) return this.tip
    let text = ''
    let at = 0
    try {
      const file = path.join(this.dataDir, 'tip.json')
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8'))
        text = asText(raw && raw.text, 400)
        at = Number(raw && raw.at) || 0
      }
    } catch {
      text = ''
    }
    this.tip = { text, at }
    return this.tip
  }

  rememberSituation(input) {
    const text = asText(input, 400)
    if (!text) return
    const previous = this.situation()
    if (previous.text === text) return
    this.tip = { text, at: nowMs() }
    try {
      mkdirSync(this.dataDir, { recursive: true })
      const file = path.join(this.dataDir, 'tip.json')
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(this.tip), 'utf8')
      renameSync(tmp, file)
    } catch {
      /* 写不进去就只留在内存里 */
    }
  }

  /** 单条记忆压成一行（注入用）。 */
  lineOf(node) {
    const kindLabel = KIND_LABEL[node.kind] || node.kind
    const tags = node.tags.length > 0 ? `｜${node.tags.join('、')}` : ''
    let line = `- [${kindLabel}] ${node.title.replace(/\n/g, ' ').slice(0, 46)}${tags}`
    if (line.length > 68) line = `${line.slice(0, 67)}…`
    return line
  }

  /**
   * 注入到系统提示的「记忆星云」。
   * 先按当前这句话检索（像人脑被一句话勾出相关记忆），再补最常被想起来的几条。
   */
  mapText(options = {}) {
    const at = nowMs()
    const budget = Number.isFinite(options.budget) ? options.budget : 600
    const nodes = this.nodes()
    if (nodes.length === 0) return ''
    const tip = this.situation().text
    let picked = []
    if (tip) {
      let hits = []
      try {
        hits = this.search(tip, { limit: 6 })
      } catch {
        hits = []
      }
      picked = hits.filter((item) => item && item.node && item.score > 0.16).slice(0, 5)
    }

    // 还没做完的事永远提一句，不然做着做着就忘了
    const openTodos = nodes.filter((node) => node.kind === 'todo' && node.status === 'open')
    let todoLine = ''
    if (openTodos.length > 0) {
      const brief = openTodos
        .slice(0, 3)
        .map((node) => String(node.title || '').replace(/^没做完[：:]\s*/, '').slice(0, 16))
        .join('、')
      todoLine = `${String.fromCharCode(10)}⏳ 还没做完 ${openTodos.length} 条：${brief}${openTodos.length > 3 ? '…' : ''}`
    }

    // 没有直接相关的东西就闭嘴：记忆不用时不该占用思考
    if (picked.length === 0) {
      return `【记忆星云】存着 ${nodes.length} 条记忆，这一刻没有跟当前说话直接相关的。需要调取用 memory_search，想起来什么用 memory_save 记下。${todoLine}`
    }

    // 钉住的铁律每轮都占一个固定名额，不参与话题竞争
    const pinnedCore = nodes.filter((node) => node.pinned && node.layer === 'core')
    const pinnedRules = pinnedCore.filter((node) => node.kind === 'rule')
    const mustHave = (pinnedRules.length > 0 ? pinnedRules : pinnedCore)
      .slice()
      .sort((a, b) => clamp01(b.weight) - clamp01(a.weight))
      .slice(0, 6)
    const seen = new Set(mustHave.map((node) => node.id))
    const rest = picked.filter((item) => !seen.has(item.node.id))
    const lines = [
      ...mustHave.map((node) => `- [铁律] ${String(node.title || '').slice(0, 26)}`),
      ...rest.map((item) => this.lineOf(item.node))
    ]
    const text = [
      `【记忆星云】这 ${lines.length} 条跟当前说话相关（共 ${nodes.length} 条）：`,
      ...lines,
      `要细节用 memory_get/search；这是你自己想起来的，不是提示。${todoLine}`
    ].join(String.fromCharCode(10))
    return text.length > budget ? `${text.slice(0, budget - 1)}…` : text
  }

  graphPayload() {
    const at = nowMs()
    return {
      ok: true,
      now: at,
      nodes: this.nodes().map((node) => ({
        id: node.id,
        title: node.title,
        body: node.body,
        kind: node.kind,
        layer: node.layer,
        tags: node.tags,
        weight: node.weight,
        act: Number(activation(node, at).toFixed(3)),
        strength: Number((typeof node.strength === 'number' ? node.strength : 1).toFixed(2)),
        effective: Number(effectiveWeight(node, at).toFixed(3)),
        pinned: node.pinned,
        hits: node.hits,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        lastHitAt: node.lastHitAt
      })),
      edges: this.edges().map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, weight: edge.weight })),
      stats: this.stats()
    }
  }
}

export const KIND_LABEL = {
  fact: '事实',
  preference: '偏好',
  decision: '决定',
  rule: '规矩',
  todo: '待办',
  event: '事件',
  person: '人物',
  project: '项目',
  skill: '技能',
  other: '其它'
}

export const LAYER_LABEL = {
  core: '核心',
  memory: '记忆',
  command: '指令',
  capability: '能力',
  service: '服务',
  data: '数据'
}
