// dsh-memory-nebula —— host 侧：记忆存储 + 工具 + 系统提示注入 + 侧栏数据路由
import { MemoryStore, KIND_LABEL, LAYER_LABEL, LAYERS, resolveDataDir } from './store.js'

export const name = 'dsh-memory-nebula'
export const inject = ['webServer', 'tools']

const ROUTE_GRAPH = '/api/dsh-memory-nebula/graph'
const ROUTE_ACTION = '/api/dsh-memory-nebula/action'

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(value))
}

function readJsonBody(request, limitBytes = 256 * 1024) {
  return new Promise((resolve) => {
    const chunks = []
    let bytes = 0
    request.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > limitBytes) return
      chunks.push(buffer)
    })
    request.on('end', () => {
      if (bytes > limitBytes) {
        resolve(null)
        return
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!raw) {
          resolve({})
          return
        }
        const parsed = JSON.parse(raw)
        resolve(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null)
      } catch {
        resolve(null)
      }
    })
    request.on('error', () => resolve(null))
  })
}

function textRender(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return [{ type: 'text', text: text === undefined ? '' : String(text) }]
}

function tool(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'string', description: '操作结果（文本或 JSON）。' },
      render: (_args, value) => textRender(value)
    },
    // DSH 按 output.schema 校验 execute 的返回值，这里统一序列化成字符串
    execute: async (args, context) => {
      const value = await execute(args, context)
      if (typeof value === 'string') return value
      return JSON.stringify(value, null, 2)
    }
  }
}

export function apply(ctx) {
  const store = new MemoryStore(resolveDataDir())
  try {
    store.load()
  } catch {
    // 读取失败时保持空图，不影响插件加载
  }

  const log = (message) => {
    try {
      ctx.logger?.('dsh-memory-nebula')?.info?.(message)
    } catch {
      // 忽略：日志不可用不影响功能
    }
  }

  // ---------------------------------------------------------------- 工具
  const register = (definition) => {
    try {
      if (typeof ctx.tools.get === 'function' && ctx.tools.get(definition.name)) {
        log(`工具 ${definition.name} 已存在，跳过注册`)
        return
      }
      return ctx.tools.register(definition)
    } catch (error) {
      log(`注册工具 ${definition.name} 失败：${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  const disposers = []

  disposers.push(
    register(
      tool(
        'memory_save',
        '把一条值得长期记住的信息写进记忆星云（自动去重、自动与相似记忆连线）。适合：主人的偏好/习惯、重要决定及其理由、长期项目背景、人物关系、我踩过的坑。短小的原文即可，不要写成报告。',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', description: '要记住的内容本身（必填）。一到三句话，保留关键细节与数字。' },
            id: { type: 'string', description: '要改的那条记忆的 id。填了就更新它，不填就是新建。' },
            title: { type: 'string', description: '一句话标题，不填则从正文截取。' },
            kind: {
              type: 'string',
              enum: ['fact', 'preference', 'decision', 'rule', 'todo', 'event', 'person', 'project', 'skill', 'other'],
              description: '记忆类型。偏好用 preference，决定用 decision，规矩用 rule。'
            },
            layer: {
              type: 'string',
              enum: ['core', 'memory', 'command', 'capability', 'service', 'data'],
              description: '所在层。核心人设/铁律用 core，普通记忆用 memory。'
            },
            tags: { type: 'array', items: { type: 'string' }, description: '2~4 个短标签，用于连线与检索。' },
            weight: { type: 'number', description: '重要度 0~1，默认 0.5。' },
            pinned: { type: 'boolean', description: '是否钉住（不吃时间衰减，每轮注入优先）。' },
            status: {
              type: 'string',
              enum: ['open', 'done', 'parked'],
              description: '待办状态，只对 kind=todo 有意义：open 待办（默认）、done 做完、parked 搁置。'
            },
            closes: {
              type: 'string',
              description: '顺手收掉一条待办：填待办的 id 或标题片段。做完一件事写记录时一定要带上，否则完成记录和待办会并存。'
            }
          },
          required: ['text']
        },
        async (args) => {
          const input = args && typeof args === 'object' ? args : {}
          const text = typeof input.text === 'string' ? input.text : ''
          if (!text.trim() && !(typeof input.id === 'string' && input.id.trim())) return { ok: false, error: 'text 不能为空' }
          const { node, created, autoClosed } = store.upsert({
            id: typeof input.id === 'string' ? input.id : undefined,
            title: input.title,
            body: text,
            kind: input.kind,
            layer: input.layer,
            tags: input.tags,
            weight: typeof input.weight === 'number' ? input.weight : 0.5,
            pinned: input.pinned === true,
            status: typeof input.status === 'string' ? input.status : undefined,
            source: 'tool'
          })
          let closed = null
          if (typeof input.closes === 'string' && input.closes.trim()) {
            closed = store.resolveTodo(input.closes)
            if (closed) {
              try {
                store.link(node.id, closed.id, 'completes', 0.9)
              } catch {
                // 连线失败不影响主流程
              }
            }
          }
          const links = created ? store.autoLink(node, 3) : []
          return {
            ok: true,
            id: node.id,
            created,
            title: node.title,
            kind: node.kind,
            layer: node.layer,
            status: node.status,
            tags: node.tags,
            linked: links.length,
            closed: closed ? { id: closed.id, title: closed.title, status: closed.status } : null,
            autoClosed: autoClosed ? { id: autoClosed.id, title: autoClosed.title } : null,
            total: store.nodes().length
          }
        }
      )
    )
  )

  disposers.push(
    register(
      tool(
        'memory_search',
        '在记忆星云里检索：字面命中 → 顺着连线联想扩散 → 按记忆的鲜活程度排序。返回条目带 why 字段，说明是字面命中、从哪条联想过来的。需要回忆细节、确认之前记过什么、或想知道某件事的上下文时用。想起一次会强化一次。',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: '检索词或一句话描述。' },
            limit: { type: 'number', description: '最多返回几条，默认 6。' },
            kind: {
              type: 'string',
              enum: ['fact', 'preference', 'decision', 'rule', 'todo', 'event', 'person', 'project', 'skill', 'other'],
              description: '只看某一类型。'
            }
          },
          required: ['query']
        },
        async (args) => {
          const input = args && typeof args === 'object' ? args : {}
          const query = typeof input.query === 'string' ? input.query : ''
          if (!query.trim()) {
            const recent = store
              .nodes()
              .slice()
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
              .slice(0, Number.isFinite(input.limit) ? input.limit : 6)
            return {
              ok: true,
              count: recent.length,
              items: recent.map((node) => ({
                id: node.id,
                title: node.title,
                kind: node.kind,
                layer: node.layer,
                tags: node.tags,
                text: node.body,
                score: null
              }))
            }
          }
          const hits = store.search(query, { limit: input.limit, kind: input.kind })
          // 想起一次就巩固一次（提取练习），顺带把它们点亮
          store.reinforce(hits.map((hit) => hit.node.id))
          return {
            ok: true,
            count: hits.length,
            items: hits.map((hit) => ({
              id: hit.node.id,
              title: hit.node.title,
              kind: hit.node.kind,
              layer: hit.node.layer,
              kindLabel: KIND_LABEL[hit.node.kind] || hit.node.kind,
              // 属于什么：一层一类，一眼定位
              belongsTo: `${LAYER_LABEL[hit.node.layer] || hit.node.layer} · ${KIND_LABEL[hit.node.kind] || hit.node.kind}`,
              // 连着谁：最强的三条连线，顺着就能接着想
              links: store
                .neighbors(hit.node.id)
                .slice(0, 3)
                .map((item) => `${item.node.title}（${item.edge.kind}）`),
              tags: hit.node.tags,
              text: hit.node.body,
              pinned: hit.node.pinned,
              score: Number(hit.score.toFixed(2)),
              why: hit.why
            })),
            note: hits.length === 0 ? '这轮没想起来。可以换个说法，或者干脆记一条新的。' : undefined
          }
        }
      )
    )
  )

  disposers.push(
    register(
      tool(
        'memory_get',
        '按 id 读取一条记忆的完整内容，以及它连着的邻居（用来顺着线索回忆）。',
        {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string', description: '记忆 id。' } },
          required: ['id']
        },
        async (args) => {
          const input = args && typeof args === 'object' ? args : {}
          const node = store.node(String(input.id || ''))
          if (!node) return { ok: false, error: '没有这条记忆' }
          const neighbors = store.neighbors(node.id).map((item) => ({
            id: item.node.id,
            title: item.node.title,
            kind: item.edge.kind,
            weight: item.edge.weight
          }))
          store.touch([node.id])
          return {
            ok: true,
            node: { ...node, text: node.body },
            neighbors
          }
        }
      )
    )
  )

  disposers.push(
    register(
      tool(
        'memory_link',
        '手动把两条记忆连起来（比如「决定」和它的「理由」，或同一个人下的两件事）。',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string', description: '起点记忆 id。' },
            to: { type: 'string', description: '终点记忆 id。' },
            kind: { type: 'string', description: '连线含义，例如 related / caused_by / part_of。' }
          },
          required: ['from', 'to']
        },
        async (args) => {
          const input = args && typeof args === 'object' ? args : {}
          const edge = store.link(String(input.from || ''), String(input.to || ''), input.kind || 'related')
          return edge ? { ok: true, edge } : { ok: false, error: '两端记忆都要存在且不能相同' }
        }
      )
    )
  )

  disposers.push(
    register(
      tool(
        'memory_forget',
        '删掉一条记忆（连同它的连线）。只在记忆确实过时或错误时用。',
        {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string', description: '要删除的记忆 id。' } },
          required: ['id']
        },
        async (args) => {
          const input = args && typeof args === 'object' ? args : {}
          const removed = store.remove(String(input.id || ''))
          return removed ? { ok: true, removed: input.id, total: store.nodes().length } : { ok: false, error: '没有这条记忆' }
        }
      )
    )
  )

  disposers.push(
    register(
      tool(
        'memory_pin',
        '钉住或取消钉住一条记忆。钉住的记忆不吃时间衰减，每轮优先进入系统提示。',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: '记忆 id。' },
            pinned: { type: 'boolean', description: 'true 钉住，false 取消，省略则切换。' }
          },
          required: ['id']
        },
        async (args) => {
          const input = args && typeof args === 'object' ? args : {}
          const node = store.node(String(input.id || ''))
          if (!node) return { ok: false, error: '没有这条记忆' }
          const next = typeof input.pinned === 'boolean' ? input.pinned : !node.pinned
          store.upsert({ id: node.id, pinned: next })
          return { ok: true, id: node.id, pinned: next }
        }
      )
    )
  )

  disposers.push(
    register(
      tool(
        'memory_stats',
        '记忆星云的整体状况：条目数、连线数、未连线条目、分层分布。',
        { type: 'object', additionalProperties: false, properties: {} },
        async () => ({ ok: true, ...store.stats(), layers: LAYERS })
      )
    )
  )

  // ------------------------------------------------- 情境感知（听懂主人此刻在说什么）
  try {
    const rememberSaid = (value) => {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text) store.rememberSituation(text)
    }
    ctx.on('session/event', (session, event) => {
      try {
        if (!event || event.type !== 'user/message') return
        const data = event.data
        if (!data) return
        const blocks = Array.isArray(data.content) ? data.content : []
        let said = ''
        for (const block of blocks) {
          if (block && block.type === 'text' && typeof block.text === 'string') said += ' ' + block.text
        }
        if (!said && typeof data.text === 'string') said = data.text
        rememberSaid(said)
      } catch {
        /* 监听不能影响会话本身 */
      }
    })
  } catch (error) {
    log('情境感知不可用：' + (error instanceof Error ? error.message : String(error)))
  }

  // -------------------------------------------------------- 系统提示注入
  try {
    ctx.inject(['systemPrompt'], (sctx) => {
      sctx.systemPrompt.context({
        name: 'dsh-memory-nebula/map',
        order: 210,
        text: () => {
          try {
            return store.mapText()
          } catch {
            return ''
          }
        }
      })
    })
  } catch (error) {
    log(`系统提示注入不可用：${error instanceof Error ? error.message : String(error)}`)
  }

  // ------------------------------------------------------------- 侧栏路由
  try {
    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_GRAPH,
        handler: async (request, response) => {
          if (request.method !== 'POST' && request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET, POST' })
            response.end()
            return
          }
          try {
            sendJson(response, 200, store.graphPayload())
          } catch (error) {
            sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        }
      })
    )

    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_ACTION,
        handler: async (request, response) => {
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' })
            response.end()
            return
          }
          const body = await readJsonBody(request)
          if (!body) {
            sendJson(response, 400, { ok: false, error: '请求体不是有效 JSON' })
            return
          }
          try {
            const action = String(body.action || '')
            if (action === 'save') {
              const { node, created } = store.upsert({
                title: body.title,
                body: body.text,
                kind: body.kind,
                layer: body.layer,
                tags: body.tags,
                weight: body.weight,
                pinned: body.pinned,
                source: 'ui'
              })
              if (created) store.autoLink(node, 3)
              sendJson(response, 200, { ok: true, id: node.id, created })
              return
            }
            if (action === 'forget') {
              sendJson(response, 200, { ok: store.remove(String(body.id || '')) })
              return
            }
            if (action === 'pin') {
              const node = store.node(String(body.id || ''))
              if (!node) {
                sendJson(response, 404, { ok: false, error: '没有这条记忆' })
                return
              }
              const next = typeof body.pinned === 'boolean' ? body.pinned : !node.pinned
              store.upsert({ id: node.id, pinned: next })
              sendJson(response, 200, { ok: true, pinned: next })
              return
            }
            if (action === 'link') {
              const edge = store.link(String(body.from || ''), String(body.to || ''), body.kind || 'related')
              sendJson(response, edge ? 200 : 400, edge ? { ok: true, edge } : { ok: false, error: '端点无效' })
              return
            }
            if (action === 'unlink') {
              sendJson(response, 200, { ok: store.unlink(String(body.from || ''), String(body.to || '')) })
              return
            }
            sendJson(response, 400, { ok: false, error: `未知 action: ${action}` })
          } catch (error) {
            sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        }
      })
    )
  } catch (error) {
    log(`侧栏路由注册失败：${error instanceof Error ? error.message : String(error)}`)
  }

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') {
        try {
          dispose()
        } catch {
          // 卸载时忽略单个 disposer 失败
        }
      }
    }
  }, 'dsh-memory-nebula: dispose registrations')
}
