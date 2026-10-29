// dsh-memory-nebula —— 客户端：侧栏「记忆星云」面板（纯 React + Canvas，无第三方依赖）
window.__ModuleLoader__.load({
  id: 'dsh-memory-nebula',
  factory: (require) => {
    const rmod = require('react')
    const React = (rmod && rmod.default) || rmod
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const API_BASE = '/api/dsh-memory-nebula'
    const PANEL_ID = 'dsh-memory-nebula'

    const LAYER_COLORS = {
      core: '#f6c562',
      memory: '#57d6bd',
      command: '#ff9f6e',
      capability: '#b794f4',
      service: '#6aa9ff',
      data: '#8fa3bf'
    }
    const LAYER_ORDER = ['core', 'memory', 'command', 'capability', 'service', 'data']
    const LAYER_LABELS = { core: '核心', memory: '记忆', command: '指令', capability: '能力', service: '服务', data: '数据' }
    const KIND_LABELS = {
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

    function layerColor(layer) {
      return LAYER_COLORS[layer] || LAYER_COLORS.memory
    }

    function hexToRgb(hex) {
      const value = hex.replace('#', '')
      const int = Number.parseInt(value.length === 3 ? value.split('').map((c) => c + c).join('') : value, 16)
      return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
    }

    function rgba(hex, alpha) {
      const { r, g, b } = hexToRgb(hex)
      return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`
    }

    async function requestJson(path, init) {
      const response = await fetch(`${API_BASE}${path}`, {
        cache: 'no-store',
        ...init,
        headers: { 'content-type': 'application/json', ...(init && init.headers ? init.headers : {}) }
      })
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }
      if (!response.ok) {
        const message = data && data.error ? data.error : `HTTP ${response.status}`
        throw new Error(message)
      }
      return data
    }

    // ------------------------------------------------------------ 力导向布局
    const VIEWS = [
      { id: 'rings', label: '小银河', hint: '中心核 + 星系臂，每团自己转' },
      { id: 'nebula', label: '星云', hint: '3D 力导向，自由漂浮' },
      { id: 'cluster', label: '聚类', hint: '同类型抱团，簇间拉开' },
      { id: 'timeline', label: '时间轴', hint: '按记录时间铺开，一层一条河' },
      { id: 'list', label: '列表', hint: '一行一条，方便查找和编辑' }
    ]

    // 调试钩子：让 node 侧能直接跑布局，画预览图
    try {
      globalThis.__DSHMN__ = { buildLayout, stepLayout, LAYER_ORDER, projectionOf, projectPoint }
    } catch {
      /* 忽略 */
    }

    function buildLayout(nodes, edges, mode, focus) {
      const view = mode || 'nebula'
      const count = nodes.length
      const positions = new Float32Array(count * 3)
      const velocities = new Float32Array(count * 3)
      const indexById = new Map()
      const radius = 150 + Math.pow(Math.max(count, 1), 0.52) * 34
      const golden = Math.PI * (3 - Math.sqrt(5))
      for (let i = 0; i < count; i += 1) indexById.set(nodes[i].id, i)
      const groupLabels = []
      const hubs = []
      const links = []
      for (const edge of edges) {
        const a = indexById.get(edge.from)
        const b = indexById.get(edge.to)
        if (a === undefined || b === undefined) continue
        links.push({ a, b, weight: typeof edge.weight === 'number' ? edge.weight : 0.5 })
      }

      const layers = nodes.map((node) => node.layer || 'memory')
      const focusSet = new Set()
      const placeRing = (list, ringRadius, startAngle, zSpread) => {
        list.forEach((index, position) => {
          const angle = startAngle + (position / Math.max(1, list.length)) * Math.PI * 2
          positions[index * 3] = Math.cos(angle) * ringRadius
          positions[index * 3 + 1] = Math.sin(angle) * ringRadius
          positions[index * 3 + 2] = Math.sin(position * 1.7) * zSpread
        })
      }
      const scatter = (list, fromRadius, toRadius) => {
        list.forEach((index, position) => {
          const angle = position * 2.399963
          const r = fromRadius + ((position * 0.377) % 1) * (toRadius - fromRadius)
          positions[index * 3] = Math.cos(angle) * r
          positions[index * 3 + 1] = Math.sin(angle) * r
          positions[index * 3 + 2] = (((position * 0.618) % 1) - 0.5) * 220
        })
      }

      if (view === 'rings' && focus && (focus.id || focus.layer)) {
        // 点进具体分类 / 具体记忆：它以自己为中心，把下面一层摊开围着它
        let centerLabel = ''
        let centerColor = LAYER_COLORS.memory
        let centerCount = 0
        let children = []
        let leavesRing = []

        if (focus.id) {
          const centerIdx = indexById.get(focus.id)
          if (centerIdx === undefined) return null
          const centerNode = nodes[centerIdx]
          centerLabel = centerNode.title
          centerColor = layerColor(centerNode.layer)
          const neighbourSet = new Set()
          for (const edge of edges) {
            if (edge.from === focus.id) {
              const b = indexById.get(edge.to)
              if (b !== undefined) neighbourSet.add(b)
            } else if (edge.to === focus.id) {
              const a = indexById.get(edge.from)
              if (a !== undefined) neighbourSet.add(a)
            }
          }
          neighbourSet.delete(centerIdx)
          const neighbours = Array.from(neighbourSet)
          centerCount = neighbours.length
          focusSet.add(centerIdx)
          for (const index of neighbours) focusSet.add(index)
          positions[centerIdx * 3] = 0
          positions[centerIdx * 3 + 1] = 0
          positions[centerIdx * 3 + 2] = 0
          placeRing(neighbours, radius * 0.46, -Math.PI / 2, 70)
          leavesRing = []
          const others = []
          for (let i = 0; i < count; i += 1) if (!focusSet.has(i)) others.push(i)
          scatter(others, radius * 1.45, radius * 2.1)
          hubs.push({
            level: 1,
            isCenter: true,
            layer: centerNode.layer,
            label: centerLabel,
            count: centerCount,
            members: neighbours,
            x: 0,
            y: 0,
            z: 0,
            angle: 0,
            parent: -1
          })
        } else {
          const layer = focus.layer
          const inLayer = []
          for (let i = 0; i < count; i += 1) if ((nodes[i].layer || 'memory') === layer) inLayer.push(i)
          const kindGroups = new Map()
          for (const index of inLayer) {
            const kind = nodes[index].kind || 'other'
            if (!kindGroups.has(kind)) kindGroups.set(kind, [])
            kindGroups.get(kind).push(index)
          }
          const targetMembers = focus.kind ? kindGroups.get(focus.kind) || [] : inLayer
          centerLabel = focus.kind ? KIND_LABELS[focus.kind] || focus.kind : LAYER_LABELS[layer] || layer
          centerColor = layerColor(layer)
          centerCount = targetMembers.length

          for (const index of targetMembers) focusSet.add(index)

          // 中心这颗
          hubs.push({
            level: 1,
            isCenter: true,
            layer,
            label: centerLabel,
            count: centerCount,
            members: targetMembers,
            x: 0,
            y: 0,
            z: 0,
            angle: 0,
            parent: -1
          })

          if (!focus.kind && kindGroups.size > 1) {
            // 这一层下面还有类型支点：它们围成第二圈，各自的记忆再往外
            hubs[0].noLeafLines = true
            children = Array.from(kindGroups.entries())
            const childRadius = radius * 0.42
            children.forEach(([kind, members], childIndex) => {
              const baseAngle = (childIndex / children.length) * Math.PI * 2 - Math.PI / 2
              const childIndexInHubs = hubs.length
              const cx = Math.cos(baseAngle) * childRadius
              const cy = Math.sin(baseAngle) * childRadius
              hubs.push({
                level: 2,
                layer,
                kind,
                label: KIND_LABELS[kind] || kind,
                count: members.length,
                members,
                x: cx,
                y: cy,
                z: 0,
                angle: baseAngle,
                parent: 0
              })
              groupLabels.push({
                text: `${KIND_LABELS[kind] || kind} · ${members.length}`,
                x: cx,
                y: cy - 12,
                z: 0,
                size: 10.5
              })
              const leafRadius = radius * 0.72
              members.forEach((index, position) => {
                const tier = position % 2
                const jitter = ((((position * 0.6180339887) % 1) - 0.5) * 2) * 0.42
                const angle = baseAngle + jitter
                const r = leafRadius + tier * radius * 0.11 + Math.floor(position / 2) * 5
                positions[index * 3] = Math.cos(angle) * r
                positions[index * 3 + 1] = Math.sin(angle) * r
                positions[index * 3 + 2] = ((((position * 0.771) % 1) - 0.5) * 54)
              })
            })
          } else {
            // 只有一层：目标自己围成一圈
            const ringRadius = targetMembers.length > 12 ? radius * 0.58 : radius * 0.42
            placeRing(targetMembers, ringRadius, -Math.PI / 2, 80)
            if (targetMembers.length > 10) {
              const inner = targetMembers.filter((_, position) => position % 2 === 0)
              placeRing(inner, ringRadius * 0.62, -Math.PI / 2, 60)
            }
          }

          const others = []
          for (let i = 0; i < count; i += 1) if (!focusSet.has(i)) others.push(i)
          scatter(others, radius * 1.45, radius * 2.1)
        }

        groupLabels.push({ text: `${centerLabel} · ${centerCount}`, x: 0, y: 62, z: 0, size: 13 })
        return {
          count,
          positions,
          velocities,
          links,
          radius,
          mode: view,
          groupLabels,
          hubs,
          focusSet,
          focusCenter: true,
          settled: 0
        }
      }

      if (view === 'rings') {
        // 放射星云：中心核 → 环上一级分类 → 扇区内二级类型 → 朝外铺开的记忆（带立体厚度）
        const groups = new Map()
        for (let i = 0; i < count; i += 1) {
          const layer = nodes[i].layer || 'memory'
          if (!groups.has(layer)) groups.set(layer, [])
          groups.get(layer).push(i)
        }
        const present = LAYER_ORDER.filter((layer) => groups.has(layer))
        // 扇区宽度按数量开根号分配：条目多的类别占得宽，整体才铺得匀
        const weights = present.map((layer) => Math.sqrt(Math.max(1, groups.get(layer).length)))
        const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1
        let sweep = 0
        present.forEach((layer, groupIndex) => {
          const members = groups.get(layer)
          const width = (weights[groupIndex] / totalWeight) * Math.PI * 2
          const startAngle = sweep - Math.PI / 2
          sweep += width
          const baseAngle = startAngle + width / 2
          const half = width * 0.42
          const layerLabel = LAYER_LABELS[layer] || layer
          const hubIndex = hubs.length

          const hubR = radius * 0.62
          const hx = Math.cos(baseAngle) * hubR
          const hy = Math.sin(baseAngle) * hubR * 0.94
          const hz = Math.sin(baseAngle * 1.7) * radius * 0.15
          hubs.push({
            level: 1,
            layer,
            label: layerLabel,
            count: members.length,
            members,
            x: hx,
            y: hy,
            z: hz,
            angle: baseAngle,
            parent: -1
          })
          groupLabels.push({
            text: `${layerLabel} · ${members.length}`,
            x: hx,
            y: hy - (20 + Math.sqrt(members.length) * 3.6),
            z: hz,
            size: 13
          })

          const kindGroups = new Map()
          for (const index of members) {
            const kind = nodes[index].kind || 'other'
            if (!kindGroups.has(kind)) kindGroups.set(kind, [])
            kindGroups.get(kind).push(index)
          }
          const kinds = Array.from(kindGroups.keys())
          kinds.forEach((kind, kindIndex) => {
            const subMembers = kindGroups.get(kind)
            const spread = kinds.length === 1 ? 0 : (kindIndex / (kinds.length - 1)) - 0.5
            const subAngle = baseAngle + spread * half * 1.55
            const subR = radius * 0.92
            const sx = Math.cos(subAngle) * subR
            const sy = Math.sin(subAngle) * subR * 0.94
            const sz = Math.sin(subAngle * 1.9 + kindIndex) * radius * 0.24
            hubs.push({
              level: 2,
              layer,
              kind,
              label: KIND_LABELS[kind] || kind,
              count: subMembers.length,
              members: subMembers,
              x: sx,
              y: sy,
              z: sz,
              angle: subAngle,
              parent: hubIndex
            })

            const level2Index = hubs.length - 1
            // 这一类条目太多就再插一层「按标签分的次级支点」，免得外围散成一片
            if (subMembers.length > 12) {
              const tagGroups = new Map()
              for (const index of subMembers) {
                const tags = nodes[index].tags || []
                const tag = tags[0] || '其他'
                if (!tagGroups.has(tag)) tagGroups.set(tag, [])
                tagGroups.get(tag).push(index)
              }
              const tagList = Array.from(tagGroups.keys()).sort((a, b) => tagGroups.get(b).length - tagGroups.get(a).length)
              tagList.forEach((tag, tagIndex) => {
                const tagMembers = tagGroups.get(tag)
                const tSpread = tagList.length === 1 ? 0 : (tagIndex / (tagList.length - 1)) - 0.5
                const tagAngle = subAngle + tSpread * 0.46
                const tagR = radius * 1.16
                const tx = Math.cos(tagAngle) * tagR
                const ty = Math.sin(tagAngle) * tagR * 0.94
                const tz = Math.sin(tagAngle * 2.3 + tagIndex) * radius * 0.2
                hubs.push({
                  level: 3,
                  layer,
                  kind,
                  tag,
                  label: tag,
                  count: tagMembers.length,
                  members: tagMembers,
                  x: tx,
                  y: ty,
                  z: tz,
                  angle: tagAngle,
                  parent: level2Index
                })
                for (let p = 0; p < tagMembers.length; p += 1) {
                  const index = tagMembers[p]
                  const spreadA = tagMembers.length === 1 ? 0 : (((p * 0.618) % 1) - 0.5) * 2
                  const theta = tagAngle + spreadA * 0.1
                  const dist = radius * (1.32 + ((p * 0.377) % 1) * 0.3)
                  const zj = (((p * 0.771) % 1) - 0.5) * 2
                  positions[index * 3] = Math.cos(theta) * dist
                  positions[index * 3 + 1] = Math.sin(theta) * dist * 0.94
                  positions[index * 3 + 2] = zj * radius * 0.36 + tz * 0.45
                }
              })
            } else {
              // 记忆从二级支点朝外铺开，像星芒；z 上抖出厚度
              for (let p = 0; p < subMembers.length; p += 1) {
                const index = subMembers[p]
                const spreadA = subMembers.length === 1 ? 0 : (((p * 0.618) % 1) - 0.5) * 2
                const theta = subAngle + spreadA * 0.17
                const dist = radius * (1.14 + ((p * 0.377) % 1) * 0.34)
                const zj = (((p * 0.771) % 1) - 0.5) * 2
                positions[index * 3] = Math.cos(theta) * dist
                positions[index * 3 + 1] = Math.sin(theta) * dist * 0.94
                positions[index * 3 + 2] = zj * radius * 0.42 + sz * 0.5
              }
            }
          })
        })
      } else if (view === 'cluster') {
        const groups = new Map()
        for (let i = 0; i < count; i += 1) {
          const key = nodes[i].kind || 'other'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(i)
        }
        const keys = Array.from(groups.keys())
        keys.forEach((key, groupIndex) => {
          const members = groups.get(key)
          const angle = (groupIndex / Math.max(1, keys.length)) * Math.PI * 2
          const spread = radius * 0.62
          const centerX = Math.cos(angle) * spread
          const centerY = Math.sin(angle) * spread
          const centerZ = Math.sin(angle * 1.7) * spread * 0.32
          const local = 34 + Math.pow(members.length, 0.55) * 20
          groupLabels.push({ text: `${KIND_LABELS[key] || key} · ${members.length}`, x: centerX, y: centerY - local - 6, z: centerZ })
          for (let position = 0; position < members.length; position += 1) {
            const index = members[position]
            const y = members.length === 1 ? 0 : 1 - (position / (members.length - 1)) * 2
            const r = Math.sqrt(Math.max(0, 1 - y * y))
            const theta = golden * position + groupIndex * 1.7
            positions[index * 3] = centerX + Math.cos(theta) * r * local
            positions[index * 3 + 1] = centerY + y * local
            positions[index * 3 + 2] = centerZ + Math.sin(theta) * r * local
          }
        })
      } else if (view === 'timeline') {
        let min = Infinity
        let max = -Infinity
        for (const node of nodes) {
          const at = node.createdAt || node.updatedAt || 0
          if (at < min) min = at
          if (at > max) max = at
        }
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          min = 0
          max = 1
        }
        const span = Math.max(1, max - min)
        const laneOf = new Map(LAYER_ORDER.map((layer, index) => [layer, index]))
        for (let i = 0; i < count; i += 1) {
          const node = nodes[i]
          const at = node.createdAt || node.updatedAt || min
          const t = (at - min) / span
          const lane = laneOf.get(node.layer)
          const laneIndex = lane === undefined ? 3 : lane
          positions[i * 3] = (t - 0.5) * radius * 2.6
          positions[i * 3 + 1] = (laneIndex - 2.5) * radius * 0.4
          positions[i * 3 + 2] = ((i % 7) - 3) * 10
        }
      } else {
        const spread = radius * 1.38
        const focusId = focus && focus.id ? focus.id : ''
        const centerIndex = focusId ? indexById.get(focusId) : undefined
        if (centerIndex !== undefined) {
          const neighbours = []
          for (const link of links) {
            if (link.a === centerIndex && !neighbours.includes(link.b)) neighbours.push(link.b)
            else if (link.b === centerIndex && !neighbours.includes(link.a)) neighbours.push(link.a)
          }
          if (neighbours.length > 0) {
            focusSet.add(centerIndex)
            positions[centerIndex * 3] = 0
            positions[centerIndex * 3 + 1] = 0
            positions[centerIndex * 3 + 2] = 0
            const ringR = radius * 0.62
            neighbours.forEach((index, i) => {
              focusSet.add(index)
              const a = (i / Math.max(1, neighbours.length)) * Math.PI * 2 - Math.PI / 2
              const lift = Math.sin(a * 1.8) * 0.3
              positions[index * 3] = Math.cos(a) * ringR
              positions[index * 3 + 1] = Math.sin(a) * ringR * 0.7 + lift * ringR * 0.4
              positions[index * 3 + 2] = Math.sin(a) * ringR * 0.55
            })
            const rest = []
            for (let i = 0; i < count; i += 1) if (!focusSet.has(i)) rest.push(i)
            rest.forEach((index, i) => {
              const y = rest.length === 1 ? 0 : 1 - (i / (rest.length - 1)) * 2
              const r = Math.sqrt(Math.max(0, 1 - y * y))
              const theta = golden * i + 0.7
              const rr = radius * (1.15 + ((i * 0.377) % 1) * 0.55)
              positions[index * 3] = Math.cos(theta) * r * rr
              positions[index * 3 + 1] = y * rr
              positions[index * 3 + 2] = Math.sin(theta) * r * rr
            })
            for (const hub of hubs) hub.noLeafLines = true
            return {
              count,
              positions,
              velocities,
              links,
              radius: spread,
              mode: view,
              groupLabels,
              hubs,
              focusSet,
              focusCenterIndex: centerIndex,
              layers,
              settled: 0
            }
          }
        }
        // 点分类接头时：把这一类的记忆聚成一个球拉到中间
        const focusLayer = focus && focus.layer ? focus.layer : ''
        if (centerIndex === undefined && focusLayer) {
          const members = []
          for (let i = 0; i < count; i += 1) {
            if ((nodes[i].layer || 'memory') === focusLayer) members.push(i)
          }
          if (members.length > 0) {
            const R = radius * 0.5
            members.forEach((index, i) => {
              focusSet.add(index)
              const y = members.length === 1 ? 0 : 1 - (i / (members.length - 1)) * 2
              const r = Math.sqrt(Math.max(0, 1 - y * y))
              const th = golden * i
              positions[index * 3] = Math.cos(th) * r * R
              positions[index * 3 + 1] = y * R
              positions[index * 3 + 2] = Math.sin(th) * r * R
            })
            const rest = []
            for (let i = 0; i < count; i += 1) {
              if (!focusSet.has(i)) rest.push(i)
            }
            rest.forEach((index, i) => {
              const y = rest.length === 1 ? 0 : 1 - (i / (rest.length - 1)) * 2
              const r = Math.sqrt(Math.max(0, 1 - y * y))
              const th = golden * i + 0.9
              const rr = radius * (1.25 + ((i * 0.377) % 1) * 0.45)
              positions[index * 3] = Math.cos(th) * r * rr
              positions[index * 3 + 1] = y * rr
              positions[index * 3 + 2] = Math.sin(th) * r * rr
            })
            for (const hub of hubs) hub.noLeafLines = true
            return {
              count,
              positions,
              velocities,
              links,
              radius: spread,
              mode: view,
              groupLabels,
              hubs,
              focusSet,
              layers,
              settled: 0
            }
          }
        }
        // 星云：递归分层。层 → 类型 → 标签 → 标签2 … 分不分由数量说话，不封顶
        const SPLIT_MIN = 9
        const DIM_COUNT = 6
        const dimKey = (node, depth) => {
          if (depth === 0) return String(node.layer || 'memory')
          if (depth === 1) return String(node.kind || 'other')
          const tags = Array.isArray(node.tags) ? node.tags : []
          return String(tags[depth - 2] || '其他')
        }
        const dimLabel = (name, depth) => {
          if (depth === 0) return LAYER_LABELS[name] || name
          if (depth === 1) return KIND_LABELS[name] || name
          return name
        }
        const norm3 = (v) => {
          const len = Math.hypot(v[0], v[1], v[2]) || 1
          return [v[0] / len, v[1] / len, v[2] / len]
        }
        const place = (members, depth, base, radius, level, parentIndex) => {
          const groups = new Map()
          for (const index of members) {
            const key = dimKey(nodes[index], depth)
            if (!groups.has(key)) groups.set(key, [])
            groups.get(key).push(index)
          }
          const buckets = Array.from(groups.entries())
          const splittable = depth < DIM_COUNT && buckets.length > 1 && members.length > SPLIT_MIN
          if (!splittable) {
            // 分不下去了：这些就是末位，围在父节点身边
            const local = radius * 0.66
            const total = Math.max(1, members.length)
            for (let p = 0; p < members.length; p += 1) {
              const index = members[p]
              const a = p * 2.39996
              const b = Math.acos(1 - 2 * ((p + 0.5) / total))
              const sx = Math.sin(b) * Math.cos(a)
              const sy = Math.cos(b)
              const sz = Math.sin(b) * Math.sin(a)
              const jitter = 0.78 + ((p * 0.618) % 1) * 0.4
              positions[index * 3] = base[0] + sx * local * jitter
              positions[index * 3 + 1] = base[1] + sy * local * jitter
              positions[index * 3 + 2] = base[2] + sz * local * jitter
            }
            return
          }
          buckets.forEach((entry, bi) => {
            const name = entry[0]
            const subMembers = entry[1]
            const t = 2.39996 * bi + level * 1.3
            const vy = buckets.length === 1 ? 0 : 1 - (bi / (buckets.length - 1)) * 2
            const ring = Math.sqrt(Math.max(0, 1 - vy * vy))
            const dx = Math.cos(t) * ring
            const dy = vy
            const dz = Math.sin(t) * ring
            const cx = base[0] + dx * radius
            const cy = base[1] + dy * radius
            const cz = base[2] + dz * radius
            const hubIndex = hubs.length
            hubs.push({
              level,
              depth,
              layer: nodes[subMembers[0]].layer || 'memory',
              kind: nodes[subMembers[0]].kind || 'other',
              label: `${dimLabel(name, depth)} · ${subMembers.length}`,
              count: subMembers.length,
              members: subMembers,
              x: cx,
              y: cy,
              z: cz,
              angle: t,
              parent: parentIndex
            })
            if (level <= 2) {
              groupLabels.push({
                text: `${dimLabel(name, depth)} · ${subMembers.length}`,
                layer: nodes[subMembers[0]].layer || 'memory',
                x: cx,
                y: cy - 16,
                z: cz,
                size: level === 1 ? 13 : 11
              })
            }
            place(subMembers, depth + 1, [cx, cy, cz], radius * 0.62, level + 1, hubIndex)
          })
        }
        const layerGroups = new Map()
        for (let i = 0; i < count; i += 1) {
          const layer = nodes[i].layer || 'memory'
          if (!layerGroups.has(layer)) layerGroups.set(layer, [])
          layerGroups.get(layer).push(i)
        }
        const present = LAYER_ORDER.filter((layer) => layerGroups.has(layer))
        present.forEach((layer, layerIndex) => {
          const members = layerGroups.get(layer)
          const vy = present.length === 1 ? 0 : 1 - (layerIndex / (present.length - 1)) * 2
          const ring = Math.sqrt(Math.max(0, 1 - vy * vy))
          const theta = 2.39996 * layerIndex
          const dir = norm3([Math.cos(theta) * ring, vy, Math.sin(theta) * ring])
          const hubR = spread * 0.66
          const cx = dir[0] * hubR
          const cy = dir[1] * hubR
          const cz = dir[2] * hubR
          const hubIndex = hubs.length
          hubs.push({
            level: 1,
            depth: 0,
            layer,
            kind: '',
            label: `${LAYER_LABELS[layer] || layer} · ${members.length}`,
            count: members.length,
            members,
            x: cx,
            y: cy,
            z: cz,
            angle: theta,
            parent: -1
          })
          groupLabels.push({
            text: `${LAYER_LABELS[layer] || layer} · ${members.length}`,
            layer,
            x: cx,
            y: cy - 18,
            z: cz,
            size: 13
          })
          place(members, 1, [cx, cy, cz], spread * 0.3, 2, hubIndex)
        })
        // 递归分布容易偏，把整棵树平移到原点居中
        {
          let mx = 0
          let my = 0
          let mz = 0
          for (let i = 0; i < count; i += 1) {
            mx += positions[i * 3]
            my += positions[i * 3 + 1]
            mz += positions[i * 3 + 2]
          }
          mx /= Math.max(1, count)
          my /= Math.max(1, count)
          mz /= Math.max(1, count)
          for (let i = 0; i < count; i += 1) {
            positions[i * 3] -= mx
            positions[i * 3 + 1] -= my
            positions[i * 3 + 2] -= mz
          }
          for (const hub of hubs) {
            hub.x -= mx
            hub.y -= my
            hub.z -= mz
          }
          for (const label of groupLabels) {
            label.x -= mx
            label.y -= my
            label.z -= mz
          }
        }
      }
      const outRadius = view === 'rings' ? radius : radius * 1.16
      return { count, positions, velocities, links, radius: outRadius, mode: view, groupLabels, hubs, focusSet, layers, settled: 0 }
    }

    function stepLayout(layout, alpha) {
      const { count, positions, velocities, links } = layout
      if (count === 0) return
      const repel = 2600 * alpha
      // 节点间斥力
      for (let i = 0; i < count; i += 1) {
        const ix = positions[i * 3]
        const iy = positions[i * 3 + 1]
        const iz = positions[i * 3 + 2]
        for (let j = i + 1; j < count; j += 1) {
          let dx = ix - positions[j * 3]
          let dy = iy - positions[j * 3 + 1]
          let dz = iz - positions[j * 3 + 2]
          let distSq = dx * dx + dy * dy + dz * dz
          if (distSq < 1) {
            dx = (i - j) * 0.7 + 0.3
            dy = 0.4
            dz = 0.2
            distSq = dx * dx + dy * dy + dz * dz
          }
          const dist = Math.sqrt(distSq)
          const force = repel / (distSq + 60)
          const nx = (dx / dist) * force
          const ny = (dy / dist) * force
          const nz = (dz / dist) * force
          velocities[i * 3] += nx
          velocities[i * 3 + 1] += ny
          velocities[i * 3 + 2] += nz
          velocities[j * 3] -= nx
          velocities[j * 3 + 1] -= ny
          velocities[j * 3 + 2] -= nz
        }
      }
      // 连线弹簧
      const ideal = Math.max(80, layout.radius * 0.58)
      for (const link of links) {
        const a = link.a * 3
        const b = link.b * 3
        const dx = positions[b] - positions[a]
        const dy = positions[b + 1] - positions[a + 1]
        const dz = positions[b + 2] - positions[a + 2]
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001
        const stretch = (dist - ideal) * 0.0032 * alpha
        const nx = (dx / dist) * stretch
        const ny = (dy / dist) * stretch
        const nz = (dz / dist) * stretch
        velocities[a] += nx
        velocities[a + 1] += ny
        velocities[a + 2] += nz
        velocities[b] -= nx
        velocities[b + 1] -= ny
        velocities[b + 2] -= nz
      }
      // 同层弱引力：同一层的记忆互相靠拢，一簇一簇地长
      if (layout.layers) {
        const centroids = new Map()
        for (let i = 0; i < count; i += 1) {
          const key = layout.layers[i]
          if (!centroids.has(key)) centroids.set(key, { x: 0, y: 0, z: 0, n: 0 })
          const spot = centroids.get(key)
          spot.x += positions[i * 3]
          spot.y += positions[i * 3 + 1]
          spot.z += positions[i * 3 + 2]
          spot.n += 1
        }
        for (const spot of centroids.values()) {
          spot.x /= spot.n
          spot.y /= spot.n
          spot.z /= spot.n
        }
        for (let i = 0; i < count; i += 1) {
          const spot = centroids.get(layout.layers[i])
          if (!spot) continue
          const k = i * 3
          velocities[k] += (spot.x - positions[k]) * 0.0022 * alpha
          velocities[k + 1] += (spot.y - positions[k + 1]) * 0.0022 * alpha
          velocities[k + 2] += (spot.z - positions[k + 2]) * 0.0022 * alpha
        }
      }

      // 向心弱引力 + 球壳约束
      const targetRadius = layout.radius
      for (let i = 0; i < count; i += 1) {
        const k = i * 3
        const x = positions[k]
        const y = positions[k + 1]
        const z = positions[k + 2]
        const dist = Math.sqrt(x * x + y * y + z * z) || 0.001
        const pull = (targetRadius - dist) * 0.022 * alpha
        velocities[k] += (x / dist) * pull
        velocities[k + 1] += (y / dist) * pull
        velocities[k + 2] += (z / dist) * pull
      }
      // 整团别漂走：把质心轻轻拉回原点
      let centX = 0
      let centY = 0
      let centZ = 0
      for (let i = 0; i < count; i += 1) {
        centX += positions[i * 3]
        centY += positions[i * 3 + 1]
        centZ += positions[i * 3 + 2]
      }
      centX /= count
      centY /= count
      centZ /= count
      const recenter = 0.012 * alpha
      for (let i = 0; i < count; i += 1) {
        const k = i * 3
        velocities[k] -= centX * recenter
        velocities[k + 1] -= centY * recenter
        velocities[k + 2] -= centZ * recenter
      }
      // 积分
      const damping = 0.88
      for (let i = 0; i < count * 3; i += 1) {
        velocities[i] *= damping
        positions[i] += velocities[i]
      }
    }

    // --------------------------------------------------------------- 画布
    function GraphCanvas(props) {
      const { graph, layoutNonce, hiddenLayers, query, onlyPinned, selectedId, onSelect, sizeScale, labelScale, autoRotate, view } = props
      const canvasRef = useRef(null)
      const wrapRef = useRef(null)
      const stateRef = useRef({ yaw: 0.4, pitch: -0.18, roll: 0, zoom: 1, focusT: 0, focusX: 0, focusY: 0, hubScreens: [], dragging: false, moved: false, lastX: 0, lastY: 0, hoverId: '', dpr: 1 })
      const layoutRef = useRef(null)
      const layoutFrame = useRef(0)
      const drawFrame = useRef(0)
      const propsRef = useRef(props)
      propsRef.current = props
      const focus = props.focus || null
      const focusRef = useRef(null)
      focusRef.current = focus
      const setFocus = (next) => propsRef.current.onFocus?.(next)

      // 换视图时把镜头摆正：分组/列表这类结构图不该斜着看，也不该自己转
      useEffect(() => {
        const state = stateRef.current
        if (!state) return
        state.yaw = 0
        state.pitch = view === 'rings' ? -0.06 : 0
        state.roll = 0
        setFocus(null)
      }, [view])

      useEffect(() => {
        const nodes = graph ? graph.nodes : []
        const mode = view || 'nebula'
        const previous = layoutRef.current
        const next = buildLayout(nodes, graph ? graph.edges : [], mode, focus)
        if (!next) return undefined
        const target = Float32Array.from(next.positions)
        const sameSize = previous && previous.count === next.count && previous.positions.length === target.length
        const from = sameSize ? Float32Array.from(previous.positions) : null
        {
          // 其它情况（分组 / 星云聚焦）：显示位置从当前位置追到新布局
          stateRef.current.target = target
          stateRef.current.display = from || target.slice()
          stateRef.current.animFrom = undefined
          next.positions.set(stateRef.current.display)
        }
        layoutRef.current = next
        // 自动适配画面：布局变了就把镜头拉到刚好装下，别让节点跑到画布外
        {
          let maxR = 0
          for (let i = 0; i < next.count; i += 1) {
            const px = next.positions[i * 3]
            const py = next.positions[i * 3 + 1]
            const pz = next.positions[i * 3 + 2]
            const d = Math.sqrt(px * px + py * py + pz * pz)
            if (d > maxR) maxR = d
          }
          const wrap = wrapRef.current
          const cw = wrap ? wrap.clientWidth : 900
          const ch = wrap ? wrap.clientHeight : 700
          const fit = (0.44 * Math.min(cw, ch)) / Math.max(60, maxR * 0.537)
          stateRef.current.zoom = Math.max(0.3, Math.min(1.5, fit))
        }
        return undefined
      }, [graph, layoutNonce, view, focus])

      useEffect(() => {
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        let stars = []
        const rebuildStars = (width, height) => {
          stars = []
          const total = Math.round((width * height) / 5200)
          let seed = 20261029
          const rand = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648
            return seed / 2147483648
          }
          for (let i = 0; i < total; i += 1) {
            stars.push({ x: rand() * width, y: rand() * height, r: 0.3 + rand() * 0.9, a: 0.12 + rand() * 0.45 })
          }
        }

        let width = 0
        let height = 0
        const resize = () => {
          const rect = wrap.getBoundingClientRect()
          width = Math.max(240, Math.floor(rect.width))
          height = Math.max(240, Math.floor(rect.height))
          const dpr = Math.min(window.devicePixelRatio || 1, 2)
          stateRef.current.dpr = dpr
          canvas.width = Math.floor(width * dpr)
          canvas.height = Math.floor(height * dpr)
          canvas.style.width = `${width}px`
          canvas.style.height = `${height}px`
          rebuildStars(width, height)
        }
        resize()
        const observer = new ResizeObserver(resize)
        observer.observe(wrap)

        const hitTest = (mx, my) => {
          const current = propsRef.current
          const layout = layoutRef.current
          if (!layout || !current.graph) return ''
          const state = stateRef.current
          const hubs = layout.hubs || []
          const hubScreens = state.hubScreens || []
          let bestHub = -1
          let bestHubDistance = Infinity
          for (let i = 0; i < hubs.length; i += 1) {
            const screen = hubScreens[i]
            if (!screen) continue
            const reach = hubs[i].level === 1 ? 17 : 13
            const distance = Math.hypot(screen.x - mx, screen.y - my)
            if (distance < reach && distance < bestHubDistance) {
              bestHubDistance = distance
              bestHub = i
            }
          }
          if (bestHub >= 0) return `hub:${bestHub}`
          const projection = projectionOf(layout, state, width, height)
          let best = ''
          let bestDistance = 18
          for (let i = 0; i < layout.count; i += 1) {
            const node = current.graph.nodes[i]
            if (!node) continue
            const screen = projection.screens[i]
            if (!screen) continue
            const distance = Math.hypot(screen.x - mx, screen.y - my)
            if (distance < bestDistance) {
              bestDistance = distance
              best = node.id
            }
          }
          return best
        }

        const draw = () => {
          drawFrame.current = requestAnimationFrame(draw)
          const current = propsRef.current
          const state = stateRef.current
          const layout = layoutRef.current
          const clock = performance.now() / 1000
          const dpr = state.dpr
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, width, height)

          // 背景
          const bg = ctx.createRadialGradient(width * 0.5, height * 0.46, 10, width * 0.5, height * 0.5, Math.max(width, height) * 0.78)
          bg.addColorStop(0, '#0c1018')
          bg.addColorStop(0.55, '#070a10')
          bg.addColorStop(1, '#04060a')
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, width, height)
          for (let si = 0; si < stars.length; si += 1) {
            const star = stars[si]
            const flicker = 0.78 + 0.22 * Math.sin(clock * 0.22 + si * 0.31)
            const driftX = (star.x + clock * (3 + (si % 4))) % (width + 40) - 20
            ctx.fillStyle = `rgba(180,205,255,${star.a * flicker})`
            ctx.beginPath()
            ctx.arc(driftX, star.y, star.r, 0, Math.PI * 2)
            ctx.fill()
          }
          if (!layout || layout.count === 0) return

          if (current.autoRotate && !state.dragging) state.roll += 0.0022
          if (!state.dragging) {
            const spinRoll = state.spinRoll || 0
            const spinPitch = state.spinPitch || 0
            if (Math.abs(spinRoll) > 0.00002 || Math.abs(spinPitch) > 0.00002) {
              state.roll += spinRoll
              state.pitch = Math.max(-0.9, Math.min(0.9, state.pitch + spinPitch))
              state.spinRoll = spinRoll * 0.93
              state.spinPitch = spinPitch * 0.9
            } else {
              state.spinRoll = 0
              state.spinPitch = 0
            }
          }
          const focused = layout.focusSet && layout.focusSet.size > 0
          const grouped = layout.hubs && layout.hubs.length > 0
          if ((layout.mode || 'nebula') === 'nebula' && !focused && !grouped && (layout.settled || 0) < 460) {
            layout.settled = (layout.settled || 0) + 1
            const progress = layout.settled / 460
            stepLayout(layout, Math.max(0.05, 0.88 * Math.pow(1 - progress, 1.5)))
          }

          // 布局动画：显示位置每帧朝目标追一点，换视图/换焦点都会自己动起来
          if (state.display && state.target) {
            const pos = layout.positions
            const target = state.target
            const disp = state.display
            if (state.animFrom === undefined) {
              state.animFrom = Float32Array.from(disp)
              state.animStart = performance.now()
            }
            const raw = Math.min(1, (performance.now() - state.animStart) / 620)
            const eased = 1 - Math.pow(1 - raw, 3)
            const origin = state.animFrom
            for (let i = 0; i < pos.length; i += 1) {
              disp[i] = origin[i] + (target[i] - origin[i]) * eased
              pos[i] = disp[i]
            }
            if (raw >= 1) {
              state.animFrom = undefined
              state.target = null
            }
          }

          // 每个星团只在自己那颗接头附近缓慢自转，整团位置不动
          const orbitMap = new Map()
          const hubPosMap = new Map()
          if (!(layout.focusSet && layout.focusSet.size > 0) && layout.hubs) {
            for (const hub of layout.hubs) {
              if (hub.level === 1 && hub.layer) hubPosMap.set(hub.layer, hub)
            }
            LAYER_ORDER.forEach((layer, index) => {
              if (!hubPosMap.has(layer)) return
              orbitMap.set(layer, {
                omega: (index % 2 === 0 ? 1 : -1) * (0.07 + index * 0.012),
                phase: index * 1.7
              })
            })
          }
          const orbitAngle = (layer) => {
            const orbit = orbitMap.get(layer)
            if (!orbit) return 0
            return orbit.omega * clock + orbit.phase
          }
          // 每颗星球（一级接头 + 它的所有记忆）共用一个整体位移，整团一起漂
          const planetDrift = (layer) => {
            const seed = (layer || 'x').charCodeAt(0) * 0.37 + (layer || 'x').length * 1.7
            const t = clock
            const n = (k) =>
              Math.sin(t * (0.42 + k * 0.19) + seed * (1.7 + k)) * 0.6 +
              Math.sin(t * (0.91 + k * 0.27) + seed * (2.9 + k)) * 0.3 +
              Math.sin(t * (1.63 + k * 0.37) + seed * (4.1 + k)) * 0.1
            return { x: n(1) * 55, y: n(2) * 42, z: n(3) * 55 }
          }
          const layerNames = Array.isArray(layout.layers) ? layout.layers : []
          const orbitEnabled =
            orbitMap.size > 0 &&
            state.display &&
            state.display.length === layout.count * 3 &&
            layerNames.length === layout.count
          if (orbitEnabled) {
            const disp = state.display
            const pos = layout.positions
            for (let i = 0; i < layout.count; i += 1) {
              const a = orbitAngle(layerNames[i])
              if (a === 0) {
                pos[i * 3] = disp[i * 3]
                pos[i * 3 + 1] = disp[i * 3 + 1]
                pos[i * 3 + 2] = disp[i * 3 + 2]
                continue
              }
              const layer = layerNames[i]
              const hub = hubPosMap.get(layer)
              const drift = planetDrift(layer)
              if (!hub) {
                pos[i * 3] = disp[i * 3] + drift.x
                pos[i * 3 + 1] = disp[i * 3 + 1] + drift.y
                pos[i * 3 + 2] = disp[i * 3 + 2] + drift.z
                continue
              }
              const spin = a * 0.55
              const cosA = Math.cos(spin)
              const sinA = Math.sin(spin)
              const dx = disp[i * 3] - hub.x
              const dz = disp[i * 3 + 2] - hub.z
              pos[i * 3] = hub.x + dx * cosA - dz * sinA + drift.x
              pos[i * 3 + 1] = disp[i * 3 + 1] + drift.y
              pos[i * 3 + 2] = hub.z + dx * sinA + dz * cosA + drift.z
            }
          }
          const projection = projectionOf(layout, state, width, height)
          const { screens, order } = projection
          // 极轻的浮动，静止时整张图也在呼吸
          for (let i = 0; i < layout.count; i += 1) {
            const screen = screens[i]
            if (!screen) continue
            const wx = layout.positions[i * 3]
            const wy = layout.positions[i * 3 + 1]
            screen.x += Math.sin(clock * 0.3 + wy * 0.0021) * 7
            screen.y += Math.cos(clock * 0.24 + wx * 0.0019) * 7
          }
          const orbitHub = (hub) => {
            const frozen = layout.focusSet && layout.focusSet.size > 0
            if (frozen) return { x: hub.x, y: hub.y, z: hub.z }
            // 和它星球上的记忆共用同一份位移，整团一起动
            const drift = planetDrift(hub.layer)
            const scale = hub.level === 1 ? 1 : 0.6
            return {
              x: hub.x + drift.x * scale,
              y: hub.y + drift.y * scale,
              z: hub.z + drift.z * scale
            }
          }
          state.hubScreens = layout.hubs && layout.hubs.length > 0
            ? layout.hubs.map((hub) => {
                const point = orbitHub(hub)
                return projectPoint(point.x, point.y, point.z, state, width, height)
              })
            : []
          const visible = new Array(layout.count).fill(true)
          const hidden = current.hiddenLayers || new Set()
          const queryText = String(current.query || '').trim().toLowerCase()
          const selected = current.selectedId
          const hover = state.hoverId

          for (let i = 0; i < layout.count; i += 1) {
            const node = current.graph.nodes[i]
            if (!node) {
              visible[i] = false
              continue
            }
            if (hidden.has(node.layer)) visible[i] = false
            else if (current.onlyPinned && !node.pinned) visible[i] = false
            else if (queryText && !matches(node, queryText)) visible[i] = false
            if (layout.focusSet && layout.focusSet.size > 0 && !layout.focusSet.has(i)) {
              const screen = projection.screens[i]
              if (screen) screen.alpha *= 0.07
            }
          }

          // 分组放射：中心 → 一级 → 二级 → 每条记忆，一层比一层细
          if (layout.hubs && layout.hubs.length > 0) {
            const coreX = width * 0.5
            const coreY = height * 0.5
            const hubScreens = []
            for (const hub of layout.hubs) {
              const point = orbitHub(hub)
              hubScreens.push(projectPoint(point.x, point.y, point.z, state, width, height))
            }
            // 星丝：直的细线，外层柔光 + 内层亮芯，像星图里的连线
            const starlink = (ax, ay, bx, by, alpha, lineWidth) => {
              ctx.strokeStyle = `rgba(150,195,255,${alpha * 0.35})`
              ctx.lineWidth = lineWidth * 3.2
              ctx.beginPath()
              ctx.moveTo(ax, ay)
              ctx.lineTo(bx, by)
              ctx.stroke()
              ctx.strokeStyle = `rgba(196,226,255,${alpha})`
              ctx.lineWidth = lineWidth
              ctx.beginPath()
              ctx.moveTo(ax, ay)
              ctx.lineTo(bx, by)
              ctx.stroke()
            }
            layout.hubs.forEach((hub, index) => {
              const screen = hubScreens[index]
              const from = hub.parent >= 0 ? hubScreens[hub.parent] : null
              const wobble = (Math.sin(index * 12.9898) * 0.5 + 0.5) * 2 - 1
              if (hub.level === 1) {
                starlink(coreX, coreY, screen.x, screen.y, 0.34, 0.85)
              } else if (from) {
                starlink(from.x, from.y, screen.x, screen.y, hub.level === 3 ? 0.16 : 0.24, hub.level === 3 ? 0.45 : 0.6)
              }
              const anchor = hub.level === 1 ? screen : from || screen
              for (const index2 of hub.noLeafLines ? [] : hub.members) {
                if (!visible[index2]) continue
                const leaf = screens[index2]
                if (!leaf) continue
                // 偶尔有一条线轻轻亮一下，像记忆被点亮
                const cycle = (clock * 0.11 + ((index2 * 0.618) % 1)) % 1
                const flash = cycle > 0.986 ? Math.sin(((cycle - 0.986) / 0.014) * Math.PI) : 0
                starlink(
                  anchor.x,
                  anchor.y,
                  leaf.x,
                  leaf.y,
                  (hub.level === 1 ? 0.13 : 0.15) * leaf.alpha * (1 + flash * 0.9),
                  0.32 * (1 + flash * 0.7)
                )
              }
            })
          }

          // 从核心向外辐射的光丝（纯散点星云才用，分组后靠树突连线）
          if (!layout.hubs || layout.hubs.length === 0) {
            const coreX = width * 0.5
            const coreY = height * 0.5
            const reach = Math.max(width, height) * 0.55
            for (const index of order) {
              if (!visible[index]) continue
              const screen = screens[index]
              if (!screen) continue
              const dx = screen.x - coreX
              const dy = screen.y - coreY
              const dist = Math.sqrt(dx * dx + dy * dy) || 1
              const fade = Math.max(0.015, Math.min(0.26, (1 - dist / reach) * 0.3))
              ctx.strokeStyle = `rgba(150,195,255,${fade * screen.alpha})`
              ctx.lineWidth = 0.7
              ctx.beginPath()
              ctx.moveTo(coreX, coreY)
              ctx.lineTo(screen.x, screen.y)
              ctx.stroke()
            }
          }

          // 连线
          for (const link of layout.links) {
            if (!visible[link.a] || !visible[link.b]) continue
            const a = screens[link.a]
            const b = screens[link.b]
            if (!a || !b) continue
            const depthAlpha = Math.min(a.alpha, b.alpha)
            const isHot = current.graph.nodes[link.a].id === selected || current.graph.nodes[link.b]?.id === selected
            const baseLinkAlpha = (layout.mode || 'nebula') === 'rings' ? 0.07 : 0.16
            ctx.strokeStyle = isHot ? `rgba(140,205,255,${0.55 * depthAlpha})` : `rgba(120,170,235,${baseLinkAlpha * depthAlpha * (0.5 + link.weight)})`
            ctx.lineWidth = isHot ? 1.5 : 0.8
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }

          // 节点（远→近）
          const labels = []
          for (const index of order) {
            const node = current.graph.nodes[index]
            const screen = screens[index]
            if (!node || !screen) continue
            const dimmed = !visible[index]
            const color = layerColor(node.layer)
            const isSelected = node.id === selected
            const isHover = node.id === hover
            const weightValue = Math.max(0.05, node.weight || 0.5)
            const big = (layout.focusCenterIndex === index ? 2.1 : node.layer === 'core' ? 1.35 : 1)
            const radius = Math.max(
              0.9,
              Math.min(15, (1.0 + 6.2 * Math.pow(weightValue, 2) + (node.pinned ? 2.2 : 0)) * big * screen.scale * (current.sizeScale || 1))
            )
            const twinkle = 0.92 + 0.08 * Math.sin(clock * 0.33 + index * 0.41)
            const alpha = dimmed ? 0.07 : screen.alpha * twinkle

            if (isSelected || isHover) {
              const glow = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius * 4.4)
              glow.addColorStop(0, rgba(color, 0.5))
              glow.addColorStop(0.45, rgba(color, 0.16))
              glow.addColorStop(1, rgba(color, 0))
              ctx.fillStyle = glow
              ctx.beginPath()
              ctx.arc(screen.x, screen.y, radius * 4.4, 0, Math.PI * 2)
              ctx.fill()
            }

            const gradient = ctx.createRadialGradient(
              screen.x - radius * 0.3,
              screen.y - radius * 0.3,
              radius * 0.1,
              screen.x,
              screen.y,
              radius
            )
            gradient.addColorStop(0, rgba('#ffffff', Math.min(1, alpha + 0.35)))
            gradient.addColorStop(0.42, rgba(color, Math.min(1, alpha + 0.1)))
            gradient.addColorStop(1, rgba(color, alpha * 0.5))
            ctx.fillStyle = gradient
            ctx.beginPath()
            ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
            ctx.fill()

            // 星星：亮的节点带四角光芒和一层柔光
            if (!dimmed && radius > 3.1) {
              ctx.save()
              ctx.globalCompositeOperation = 'lighter'
              const halo = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius * 2.8)
              halo.addColorStop(0, rgba(color, 0.22 * alpha))
              halo.addColorStop(0.5, rgba(color, 0.07 * alpha))
              halo.addColorStop(1, rgba(color, 0))
              ctx.fillStyle = halo
              ctx.beginPath()
              ctx.arc(screen.x, screen.y, radius * 2.8, 0, Math.PI * 2)
              ctx.fill()
              if (radius > 4.4) {
                const flare = Math.min(26, radius * 2.6 + 4)
                const spoke = (x1, y1, x2, y2) => {
                  const beam = ctx.createLinearGradient(x1, y1, x2, y2)
                  beam.addColorStop(0, rgba(color, 0))
                  beam.addColorStop(0.5, rgba(color, 0.3 * alpha))
                  beam.addColorStop(1, rgba(color, 0))
                  ctx.strokeStyle = beam
                  ctx.lineWidth = 1.05
                  ctx.beginPath()
                  ctx.moveTo(x1, y1)
                  ctx.lineTo(x2, y2)
                  ctx.stroke()
                }
                spoke(screen.x - flare, screen.y, screen.x + flare, screen.y)
                spoke(screen.x, screen.y - flare, screen.x, screen.y + flare)
              }
              ctx.restore()
            }

            if (node.pinned && !dimmed) {
              ctx.strokeStyle = rgba(color, 0.85 * alpha)
              ctx.lineWidth = 1
              ctx.beginPath()
              ctx.arc(screen.x, screen.y, radius + 2.4, 0, Math.PI * 2)
              ctx.stroke()
            }

            const dense = (layout.mode || 'nebula') === 'rings'
            const inFocus = !layout.focusSet || layout.focusSet.size === 0 || layout.focusSet.has(index)
            const wantLabel = !dimmed && (isSelected || isHover || (inFocus && (dense || (current.labelScale || 1) * screen.scale > 0.92)))
            if (wantLabel && labels.length < (dense ? 140 : 70)) {
              labels.push({ node, screen, radius, alpha, color, weight: isSelected || isHover ? 3 : screen.scale })
            }
          }

          // 分类节点：一级是主干接头，二级是分出来的小接头
          if (layout.hubs && layout.hubs.length > 0) {
            for (const hub of layout.hubs) {
              const hubPoint = orbitHub(hub)
              const hubScreen = projectPoint(hubPoint.x, hubPoint.y, hubPoint.z, state, width, height)
              const color = layerColor(hub.layer)
              const hubR = hub.isCenter
                ? 13 + Math.sqrt(Math.max(1, hub.count)) * 1.5
                : hub.level === 1
                  ? 7.2 + Math.sqrt(Math.max(1, hub.count)) * 1.25
                  : 3.4 + Math.sqrt(Math.max(1, hub.count)) * 0.95
              const glowScale = hub.level === 1 ? 2.5 : 2
              const glow = ctx.createRadialGradient(hubScreen.x, hubScreen.y, 0, hubScreen.x, hubScreen.y, hubR * glowScale)
              glow.addColorStop(0, rgba(color, hub.level === 1 ? 0.3 : 0.18))
              glow.addColorStop(0.55, rgba(color, 0.06))
              glow.addColorStop(1, rgba(color, 0))
              ctx.fillStyle = glow
              ctx.beginPath()
              ctx.arc(hubScreen.x, hubScreen.y, hubR * glowScale, 0, Math.PI * 2)
              ctx.fill()
              const body = ctx.createRadialGradient(
                hubScreen.x - hubR * 0.3,
                hubScreen.y - hubR * 0.3,
                hubR * 0.1,
                hubScreen.x,
                hubScreen.y,
                hubR
              )
              body.addColorStop(0, rgba('#ffffff', hub.level === 1 ? 0.92 : 0.7))
              body.addColorStop(0.45, rgba(color, hub.level === 1 ? 0.85 : 0.6))
              body.addColorStop(1, rgba(color, hub.level === 1 ? 0.3 : 0.2))
              ctx.fillStyle = body
              ctx.beginPath()
              ctx.arc(hubScreen.x, hubScreen.y, hubR, 0, Math.PI * 2)
              ctx.fill()
              if ((state.hoverHub ?? -1) >= 0 && layout.hubs[state.hoverHub] === hub) {
                ctx.strokeStyle = 'rgba(220,240,255,0.9)'
                ctx.lineWidth = 1.4
                ctx.beginPath()
                ctx.arc(hubScreen.x, hubScreen.y, hubR + 4.5, 0, Math.PI * 2)
                ctx.stroke()
              }
              if (hub.level === 1) {
                ctx.strokeStyle = rgba(color, 0.5)
                ctx.lineWidth = 0.8
                ctx.beginPath()
                ctx.arc(hubScreen.x, hubScreen.y, hubR + 2.1, 0, Math.PI * 2)
                ctx.stroke()
              }
            }
          }

          // 分组标签（同心环 / 聚类视图才用）
          if (layout.groupLabels && layout.groupLabels.length > 0) {
            ctx.textAlign = 'center'
            for (const group of layout.groupLabels) {
              const gDrift = group.layer ? planetDrift(group.layer) : { x: 0, y: 0, z: 0 }
              const gScale = group.level === 2 ? 0.6 : 1
              const point = projectPoint(
                group.x + gDrift.x * gScale,
                group.y + gDrift.y * gScale,
                group.z + gDrift.z * gScale,
                state,
                width,
                height
              )
              const alpha = Math.max(0.2, Math.min(0.92, 0.3 + point.scale * 1.5))
              ctx.font = `600 ${group.size || 12.5}px "Microsoft YaHei", -apple-system, system-ui, sans-serif`
              ctx.fillStyle = `rgba(202,226,255,${alpha})`
              ctx.shadowColor = 'rgba(0,0,0,0.92)'
              ctx.shadowBlur = 8
              ctx.fillText(group.text, point.x, point.y)
            }
            ctx.shadowBlur = 0
            ctx.textAlign = 'start'
          }

          // 中心核：整个星云的原点（每个视图都要有；聚焦时让位给被点的节点）
          if (layout.focusCenterIndex === undefined && !layout.focusCenter) {
            const corePoint = projectPoint(0, 0, 0, state, width, height)
            const coreX = corePoint.x
            const coreY = corePoint.y
            const beat = 1 + Math.sin(clock * 1.45) * 0.09
            const coreRadius = (7.4 + Math.min(4.2, Math.sqrt(Math.max(1, layout.count)) * 0.42)) * beat
            const halo = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreRadius * (4.5 + Math.sin(clock * 1.45) * 0.35))
            halo.addColorStop(0, 'rgba(224,241,255,0.9)')
            halo.addColorStop(0.2, 'rgba(158,208,255,0.32)')
            halo.addColorStop(0.55, 'rgba(112,170,242,0.09)')
            halo.addColorStop(1, 'rgba(90,140,220,0)')
            ctx.fillStyle = halo
            ctx.beginPath()
            ctx.arc(coreX, coreY, coreRadius * 4.6, 0, Math.PI * 2)
            ctx.fill()
            // 两道缓慢转动的细环，像原子轨道
            ctx.save()
            ctx.translate(coreX, coreY)
            for (let orbit = 0; orbit < 2; orbit += 1) {
              ctx.save()
              ctx.rotate(clock * (orbit === 0 ? 0.22 : -0.16) + orbit * 1.1)
              ctx.beginPath()
              ctx.ellipse(0, 0, coreRadius * (2.5 + orbit * 0.9), coreRadius * (0.62 + orbit * 0.34), 0, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(158,206,255,${0.16 - orbit * 0.05})`
              ctx.lineWidth = 0.9
              ctx.stroke()
              ctx.restore()
            }
            ctx.restore()
            const body = ctx.createRadialGradient(
              coreX - coreRadius * 0.28,
              coreY - coreRadius * 0.28,
              coreRadius * 0.12,
              coreX,
              coreY,
              coreRadius
            )
            body.addColorStop(0, '#ffffff')
            body.addColorStop(0.5, 'rgba(206,231,255,0.96)')
            body.addColorStop(1, 'rgba(138,188,255,0.6)')
            ctx.fillStyle = body
            ctx.beginPath()
            ctx.arc(coreX, coreY, coreRadius, 0, Math.PI * 2)
            ctx.fill()
            ctx.font = '500 10.5px "Microsoft YaHei", -apple-system, system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.fillStyle = 'rgba(212,230,250,0.62)'
            ctx.shadowColor = 'rgba(0,0,0,0.9)'
            ctx.shadowBlur = 6
            ctx.fillText('记忆核心', coreX, coreY + coreRadius + 12)
            ctx.shadowBlur = 0
            ctx.textAlign = 'start'
          }

          // 标签（按重要度从高到低画，避免互相盖）
          labels.sort((a, b) => b.weight - a.weight)
          const boxes = []
          ctx.textBaseline = 'middle'
          for (const label of labels) {
            const text = label.node.title.length > 26 ? `${label.node.title.slice(0, 25)}…` : label.node.title
            const fontSize = label.weight >= 3 ? 12.5 : 11
            ctx.font = `${label.weight >= 3 ? 600 : 400} ${fontSize}px "Microsoft YaHei", -apple-system, system-ui, sans-serif`
            const textWidth = ctx.measureText(text).width
            const offsetX = label.screen.x - width * 0.5
            const offsetY = label.screen.y - height * 0.5
            const offsetLength = Math.sqrt(offsetX * offsetX + offsetY * offsetY) || 1
            const push = label.radius + 7
            const x = label.screen.x + (offsetX / offsetLength) * push
            const y = label.screen.y + (offsetY / offsetLength) * push
            const alignRight = offsetX < -2
            const box = alignRight
              ? { x: x - textWidth, y: y - 7, w: textWidth, h: 14 }
              : { x, y: y - 7, w: textWidth, h: 14 }
            let overlaps = false
            for (const other of boxes) {
              if (box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y) {
                overlaps = true
                break
              }
            }
            if (overlaps) continue
            boxes.push(box)
            if (label.weight >= 3) {
              ctx.shadowColor = 'rgba(0,0,0,0.85)'
              ctx.shadowBlur = 6
            }
            ctx.fillStyle = rgba(label.color, Math.min(1, 0.35 + label.alpha * 0.75))
            ctx.textAlign = alignRight ? 'right' : 'left'
            ctx.fillText(text, x, y)
            ctx.textAlign = 'start'
            ctx.shadowBlur = 0
          }
        
          // 悬浮卡片：鼠标停在哪颗星上就把它的底细摊开
          const hoverId = state.hoverId
          if (hoverId && current.graph) {
            const nodesList = current.graph.nodes
            let hi = -1
            for (let i = 0; i < nodesList.length; i += 1) {
              if (nodesList[i].id === hoverId) {
                hi = i
                break
              }
            }
            const hs = hi >= 0 ? screens[hi] : null
            if (hs) {
              const node = nodesList[hi]
              const lines = []
              lines.push({ text: node.title, size: 13, bold: true, color: 'rgba(232,242,255,0.96)' })
              const layerLabel = LAYER_LABELS[node.layer] || node.layer || ''
              const kindLabel = KIND_LABELS[node.kind] || node.kind || ''
              const statusLabel = node.status === 'done' ? ' · 已完成' : node.status === 'parked' ? ' · 搁置' : ''
              lines.push({ text: `${layerLabel} · ${kindLabel}${statusLabel}`, size: 11, color: 'rgba(150,190,235,0.85)' })
              const links = (current.graph.edges || []).filter((e) => e.a === hi || e.b === hi).length
              lines.push({ text: `连线 ${links} 条 · 权重 ${((node.weight || 0) * 100).toFixed(0)}`, size: 11, color: 'rgba(140,175,215,0.8)' })
              if (node.tags && node.tags.length > 0) {
                lines.push({ text: node.tags.slice(0, 4).map((t) => `#${t}`).join(' '), size: 11, color: 'rgba(150,205,255,0.75)' })
              }
              const bodyText = String(node.body || '').replace(/\s+/g, ' ').trim()
              if (bodyText) {
                const cut = bodyText.length > 46 ? `${bodyText.slice(0, 46)}…` : bodyText
                lines.push({ text: cut, size: 11, color: 'rgba(190,205,225,0.72)' })
              }
              let widest = 0
              for (const line of lines) {
                ctx.font = `${line.bold ? '600 ' : ''}${line.size}px "Microsoft YaHei", -apple-system, system-ui, sans-serif`
                const w = ctx.measureText(line.text).width
                if (w > widest) widest = w
              }
              const padX = 11
              const padY = 9
              const lineH = 17
              const boxW = widest + padX * 2
              const boxH = lines.length * lineH + padY * 2 - 4
              let bx = hs.x + 16
              let by = hs.y - boxH - 14
              if (bx + boxW > width - 10) bx = hs.x - boxW - 16
              if (by < 10) by = hs.y + 18
              if (bx < 10) bx = 10
              ctx.save()
              ctx.beginPath()
              const r = 9
              ctx.moveTo(bx + r, by)
              ctx.lineTo(bx + boxW - r, by)
              ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r)
              ctx.lineTo(bx + boxW, by + boxH - r)
              ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH)
              ctx.lineTo(bx + r, by + boxH)
              ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r)
              ctx.lineTo(bx, by + r)
              ctx.quadraticCurveTo(bx, by, bx + r, by)
              ctx.closePath()
              ctx.fillStyle = 'rgba(10,16,28,0.93)'
              ctx.fill()
              ctx.strokeStyle = 'rgba(120,170,235,0.34)'
              ctx.lineWidth = 1
              ctx.stroke()
              ctx.textAlign = 'start'
              let ty = by + padY + 12
              for (const line of lines) {
                ctx.font = `${line.bold ? '600 ' : ''}${line.size}px "Microsoft YaHei", -apple-system, system-ui, sans-serif`
                ctx.fillStyle = line.color
                ctx.fillText(line.text, bx + padX, ty)
                ty += lineH
              }
              ctx.restore()
            }
          }
}
        drawFrame.current = requestAnimationFrame(draw)

        const onPointerDown = (event) => {
          const state = stateRef.current
          state.dragging = true
          state.moved = false
          state.lastX = event.clientX
          state.lastY = event.clientY
          canvas.setPointerCapture?.(event.pointerId)
        }
        const onPointerMove = (event) => {
          const rect = canvas.getBoundingClientRect()
          const state = stateRef.current
          if (state.dragging) {
            const dx = event.clientX - state.lastX
            const dy = event.clientY - state.lastY
            if (Math.abs(dx) + Math.abs(dy) > 2) state.moved = true
            state.roll += dx * 0.0075
            state.pitch = Math.max(-0.95, Math.min(0.95, state.pitch + dy * 0.0052))
            state.spinRoll = dx * 0.0088
            state.spinPitch = dy * 0.0062
            state.lastX = event.clientX
            state.lastY = event.clientY
          } else {
            const hover = hitTest(event.clientX - rect.left, event.clientY - rect.top)
            state.hoverId = hover && !hover.startsWith('hub:') ? hover : ''
            state.hoverHub = hover && hover.startsWith('hub:') ? Number(hover.slice(4)) : -1
            state.hoverHubLayer = state.hoverHub >= 0
              ? ((layoutRef.current?.hubs || [])[state.hoverHub] || {}).layer || ''
              : ''
            canvas.style.cursor = hover ? 'pointer' : 'grab'
          }
        }
        const onPointerUp = (event) => {
          const state = stateRef.current
          const rect = canvas.getBoundingClientRect()
          if (state.dragging && !state.moved) {
            const hit = hitTest(event.clientX - rect.left, event.clientY - rect.top)
            if (hit && hit.startsWith('hub:')) {
              const hub = (layoutRef.current?.hubs || [])[Number(hit.slice(4))]
              if (hub) {
                setFocus({ layer: hub.layer, kind: hub.kind || '' })
              }
            } else if (hit) {
              const node = ((propsRef.current.graph || {}).nodes || []).find((item) => item.id === hit)
              propsRef.current.onSelect?.(hit)
              if (node) setFocus({ id: node.id, layer: node.layer, kind: node.kind || '', title: node.title })
            } else {
              setFocus(null)
            }
          }
          state.dragging = false
        }
        const onWheel = (event) => {
          event.preventDefault()
          const state = stateRef.current
          state.zoom = Math.max(0.45, Math.min(3.2, state.zoom * (event.deltaY > 0 ? 0.92 : 1.08)))
        }

        const onKeyDown = (event) => {
          if (event.key === 'Escape') setFocus(null)
        }
        const onDoubleClick = () => {
          const state = stateRef.current
          state.yaw = 0
          state.pitch = view === 'rings' ? -0.06 : 0
          state.roll = 0
          state.zoom = 1
          setFocus(null)
        }
        window.addEventListener('keydown', onKeyDown)
        canvas.addEventListener('dblclick', onDoubleClick)
        canvas.addEventListener('pointerdown', onPointerDown)
        canvas.addEventListener('pointermove', onPointerMove)
        canvas.addEventListener('pointerup', onPointerUp)
        canvas.addEventListener('pointerleave', onPointerUp)
        canvas.addEventListener('wheel', onWheel, { passive: false })
        // 双保险：指针滑出画布、或捕获失败时也能继续拖
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)

        return () => {
          cancelAnimationFrame(drawFrame.current)
          observer.disconnect()
          canvas.removeEventListener('pointerdown', onPointerDown)
          canvas.removeEventListener('pointermove', onPointerMove)
          canvas.removeEventListener('pointerup', onPointerUp)
          canvas.removeEventListener('pointerleave', onPointerUp)
          canvas.removeEventListener('wheel', onWheel)
          window.removeEventListener('keydown', onKeyDown)
          canvas.removeEventListener('dblclick', onDoubleClick)
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', onPointerUp)
        }
      }, [])

      return h(
        'div',
        { ref: wrapRef, className: 'dshmn_canvasWrap' },
        h('canvas', { ref: canvasRef, className: 'dshmn_canvas' }),
        focus && view === 'rings'
          ? h(
              'div',
              { className: 'dshmn_crumb' },
              h(
                'button',
                { className: 'dshmn_crumbItem', onClick: () => setFocus(null) },
                '全部'
              ),
              h('span', { className: 'dshmn_crumbSep' }, '›'),
              h(
                'span',
                { className: 'dshmn_crumbNow' },
                focus.id
                  ? focus.title || '这一条'
                  : `${LAYER_LABELS[focus.layer] || focus.layer}${focus.kind ? ` · ${KIND_LABELS[focus.kind] || focus.kind}` : ''}`
              ),
              h(
                'button',
                { className: 'dshmn_crumbItem dshmn_crumbBack', onClick: () => setFocus(null) },
                '返回'
              )
            )
          : null
      )
    }

    function matches(node, queryText) {
      if (node.title.toLowerCase().includes(queryText)) return true
      if (node.body.toLowerCase().includes(queryText)) return true
      for (const tag of node.tags) if (tag.toLowerCase().includes(queryText)) return true
      return false
    }

    function projectPoint(px, py, pz, state, width, height) {
      const roll = state.roll || 0
      const cosR = Math.cos(roll)
      const sinR = Math.sin(roll)
      const focusT = state.focusT || 0
      const fpx = px - (state.focusX || 0) * focusT
      const fpy = py - (state.focusY || 0) * focusT
      const rx = fpx * cosR - fpy * sinR
      const ry = fpx * sinR + fpy * cosR
      const x1 = rx * Math.cos(state.yaw) - pz * Math.sin(state.yaw)
      const z1 = rx * Math.sin(state.yaw) + pz * Math.cos(state.yaw)
      const y1 = ry * Math.cos(state.pitch) - z1 * Math.sin(state.pitch)
      const z2 = ry * Math.sin(state.pitch) + z1 * Math.cos(state.pitch)
      const depth = z2 + 900
      const safe = depth < 120 ? 120 : depth
      const scale = ((780 * state.zoom * (1 + focusT * 1.5)) / safe) * 0.62
      return { x: width * 0.5 + x1 * scale, y: height * 0.5 + y1 * scale, scale, depth }
    }

    function projectionOf(layout, state, width, height) {
      const screens = new Array(layout.count)
      const order = []
      const cosY = Math.cos(state.yaw)
      const sinY = Math.sin(state.yaw)
      const cosP = Math.cos(state.pitch)
      const sinP = Math.sin(state.pitch)
      const cosR = Math.cos(state.roll || 0)
      const sinR = Math.sin(state.roll || 0)
      const camDistance = 900
      const focal = 780 * state.zoom * (1 + (state.focusT || 0) * 1.5)
      const cx = width * 0.5
      const cy = height * 0.5
      let nearest = -Infinity
      let farthest = Infinity
      for (let i = 0; i < layout.count; i += 1) {
        const focusT = state.focusT || 0
        const px0 = layout.positions[i * 3] - (state.focusX || 0) * focusT
        const py0 = layout.positions[i * 3 + 1] - (state.focusY || 0) * focusT
        const pz = layout.positions[i * 3 + 2]
        const px = px0 * cosR - py0 * sinR
        const py = px0 * sinR + py0 * cosR
        const x1 = px * cosY - pz * sinY
        const z1 = px * sinY + pz * cosY
        const y1 = py * cosP - z1 * sinP
        const z2 = py * sinP + z1 * cosP
        const depth = z2 + camDistance
        const safeDepth = depth < 120 ? 120 : depth
        const scale = (focal / safeDepth) * 0.62
        screens[i] = { x: cx + x1 * scale, y: cy + y1 * scale, scale, depth }
        if (depth > nearest) nearest = depth
        if (depth < farthest) farthest = depth
        order.push(i)
      }
      const span = Math.max(1, nearest - farthest)
      for (let i = 0; i < layout.count; i += 1) {
        const screen = screens[i]
        if (!screen) continue
        screen.alpha = 0.22 + 0.78 * ((screen.depth - farthest) / span)
      }
      order.sort((a, b) => screens[b].depth - screens[a].depth)
      return { screens, order }
    }

    // --------------------------------------------------------------- 面板
    const styles = `
.dshmn_root{display:flex;flex-direction:column;height:100%;min-height:520px;width:100%;color:var(--dsw-alias-label-primary,#e8edf5);font:13px/1.55 "Microsoft YaHei",-apple-system,system-ui,sans-serif;--dshmn-border:rgba(255,255,255,.09);--dshmn-dim:rgba(255,255,255,.45)}
.dshmn_head{display:flex;align-items:center;gap:10px;padding:10px 14px 8px;border-bottom:.5px solid var(--dshmn-border);background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03))}
.dshmn_title{display:flex;align-items:baseline;gap:8px;font-size:14px;font-weight:600;letter-spacing:.02em}
.dshmn_count{font-size:11px;color:var(--dshmn-dim);font-weight:400}
.dshmn_search{flex:1;min-width:120px;max-width:320px;display:flex;align-items:center;gap:6px;padding:4px 9px;border:.5px solid var(--dshmn-border);border-radius:8px;background:rgba(0,0,0,.28)}
.dshmn_search input{flex:1;min-width:0;border:0;background:transparent;color:inherit;font:inherit;outline:none}
.dshmn_btn{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:.5px solid var(--dshmn-border);border-radius:8px;background:rgba(255,255,255,.04);color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dshmn_btn:hover{background:rgba(255,255,255,.09)}
.dshmn_btn[data-on="1"]{border-color:rgba(110,200,255,.55);background:rgba(90,170,255,.16);color:#bfe3ff}
.dshmn_btn[data-danger="1"]{border-color:rgba(255,120,120,.4);color:#ffb3b3}
.dshmn_body{flex:1;display:flex;min-height:0}
.dshmn_side{width:186px;flex:none;display:flex;flex-direction:column;gap:10px;padding:10px;overflow:auto;border-right:.5px solid var(--dshmn-border);background:rgba(0,0,0,.14)}
.dshmn_groupLabel{font-size:11px;color:var(--dshmn-dim);letter-spacing:.06em;margin:2px 0 4px}
.dshmn_layer{display:flex;align-items:center;gap:7px;padding:2px 4px;border-radius:6px;cursor:pointer;font-size:12px}
.dshmn_layer:hover{background:rgba(255,255,255,.06)}
.dshmn_layer input{accent-color:#6aa9ff}
.dshmn_layerName{cursor:pointer;border-bottom:.5px dashed transparent}
.dshmn_layerName:hover{color:#9fd2ff;border-bottom-color:rgba(120,190,255,.5)}
.dshmn_dot{width:8px;height:8px;border-radius:50%;flex:none;box-shadow:0 0 6px currentColor}
.dshmn_layerNum{margin-left:auto;font-size:11px;color:var(--dshmn-dim);font-variant-numeric:tabular-nums}
.dshmn_range{display:flex;flex-direction:column;gap:3px;font-size:12px}
.dshmn_range input{width:100%;accent-color:#6aa9ff}
.dshmn_stats{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.dshmn_stat{padding:6px 8px;border:.5px solid var(--dshmn-border);border-radius:8px;background:rgba(255,255,255,.03)}
.dshmn_stat b{display:block;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.dshmn_stat span{font-size:10.5px;color:var(--dshmn-dim)}
.dshmn_canvasWrap{position:relative;flex:1;min-width:0;min-height:320px;overflow:hidden}
.dshmn_crumb{position:absolute;left:12px;top:10px;display:flex;align-items:center;gap:7px;padding:5px 11px;border-radius:10px;border:.5px solid rgba(255,255,255,.11);background:rgba(9,14,22,.76);backdrop-filter:blur(10px);font-size:12px;color:rgba(226,238,255,.92);z-index:5}
.dshmn_crumbItem{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0;opacity:.75}
.dshmn_crumbItem:hover{color:#9fd2ff;opacity:1}
.dshmn_crumbSep{opacity:.35}
.dshmn_crumbNow{font-weight:600;letter-spacing:.02em}
.dshmn_crumbBack{margin-left:4px;padding-left:8px;border-left:.5px solid rgba(255,255,255,.14)}
.dshmn_canvas{display:block;touch-action:none;cursor:grab}
.dshmn_hint{position:absolute;left:12px;bottom:10px;font-size:11px;color:rgba(255,255,255,.32);pointer-events:none}
.dshmn_detail{width:262px;flex:none;display:flex;flex-direction:column;border-left:.5px solid var(--dshmn-border);background:rgba(0,0,0,.18);overflow:auto}
.dshmn_detailHead{display:flex;align-items:center;gap:6px;padding:9px 12px 7px;border-bottom:.5px solid var(--dshmn-border)}
.dshmn_pill{font-size:10.5px;padding:1px 7px;border-radius:999px;border:.5px solid currentColor;opacity:.9}
.dshmn_detailTitle{padding:10px 12px 2px;font-size:13.5px;font-weight:600;line-height:1.45;overflow-wrap:anywhere}
.dshmn_detailBody{padding:6px 12px 10px;font-size:12.5px;line-height:1.62;color:rgba(232,237,245,.82);white-space:pre-wrap;overflow-wrap:anywhere}
.dshmn_tags{display:flex;flex-wrap:wrap;gap:5px;padding:0 12px 10px}
.dshmn_tag{font-size:10.5px;padding:1px 7px;border-radius:999px;background:rgba(110,180,255,.13);color:#a9d2ff}
.dshmn_actions{display:flex;gap:6px;padding:0 12px 10px}
.dshmn_links{padding:0 12px 12px}
.dshmn_linkRow{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11.5px;color:rgba(232,237,245,.72);cursor:pointer;border:0;background:none;text-align:left;width:100%;font-family:inherit}
.dshmn_linkRow:hover{color:#bfe3ff}
.dshmn_linkKind{font-size:10px;color:var(--dshmn-dim);flex:none}
.dshmn_empty{padding:22px 14px;font-size:12px;color:var(--dshmn-dim);line-height:1.7}
.dshmn_recent{padding:0 12px 12px;display:flex;flex-direction:column;gap:2px}
.dshmn_recentRow{display:flex;align-items:baseline;gap:6px;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:11.5px;color:rgba(232,237,245,.78);border:0;background:none;text-align:left;width:100%;font-family:inherit;overflow-wrap:anywhere}
.dshmn_recentRow:hover{background:rgba(255,255,255,.06);color:#d8ecff}
.dshmn_err{margin:0 12px 10px;padding:6px 9px;border-radius:8px;background:rgba(255,90,90,.12);color:#ffb9b9;font-size:11.5px}
.dshmn_composer{display:flex;flex-direction:column;gap:6px;padding:10px 12px;margin:0 0 8px;border-radius:11px;background:rgba(12,18,30,.72);box-shadow:inset 0 0 0 .5px rgba(120,170,240,.28)}
.dshmn_in{border:.5px solid var(--dshmn-border);border-radius:7px;background:rgba(0,0,0,.3);color:inherit;font:inherit;font-size:12px;padding:5px 8px;outline:none}
.dshmn_in:focus{border-color:rgba(140,190,255,.6)}
.dshmn_ta{min-height:52px;resize:vertical;font-family:inherit}
.dshmn_inline{display:flex;gap:6px;align-items:center}
.dshmn_views{display:flex;gap:2px;padding:2px;border-radius:9px;background:rgba(255,255,255,.05);flex:none}
.dshmn_viewBtn{border:0;background:none;color:rgba(232,237,245,.62);font:inherit;font-size:11.5px;padding:4px 9px;border-radius:7px;cursor:pointer;white-space:nowrap;line-height:1.4}
.dshmn_viewBtn:hover{color:#d8ecff;background:rgba(255,255,255,.06)}
.dshmn_viewBtn[data-on="1"]{background:rgba(120,180,255,.2);color:#dcecff;box-shadow:inset 0 0 0 .5px rgba(150,200,255,.35)}
.dshmn_listWrap{flex:1;min-width:0;min-height:320px;overflow:auto;padding:2px 6px 10px}
.dshmn_list{display:flex;flex-direction:column;gap:1px}
.dshmn_listRow{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:none;color:rgba(232,237,245,.82);font:inherit;font-size:12px;padding:6px 9px;border-radius:7px;cursor:pointer}
.dshmn_listRow:hover{background:rgba(255,255,255,.055);color:#d8ecff}
.dshmn_listRow[data-active="1"]{background:rgba(120,180,255,.16);box-shadow:inset 0 0 0 .5px rgba(150,200,255,.3)}
.dshmn_listDot{width:6px;height:6px;border-radius:50%;flex:none}
.dshmn_listKind{flex:none;font-size:10.5px;opacity:.55;width:34px}
.dshmn_listTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshmn_listTags{flex:none;font-size:10.5px;opacity:.42;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshmn_listPin{flex:none;color:#f6c562;font-size:10px}
.dshmn_listEmpty{padding:22px 14px;font-size:12px;color:var(--dshmn-dim)}
`

    function MemoryList(props) {
      const { nodes, selectedId, onSelect, query, hiddenLayers, onlyPinned } = props
      const queryText = String(query || '').trim().toLowerCase()
      const rows = nodes.filter((node) => {
        if (hiddenLayers && hiddenLayers.has(node.layer)) return false
        if (onlyPinned && !node.pinned) return false
        if (queryText && !matches(node, queryText)) return false
        return true
      })
      rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      if (rows.length === 0) {
        return h('div', { className: 'dshmn_listEmpty' }, '没有符合条件的记忆。')
      }
      return h(
        'div',
        { className: 'dshmn_list' },
        rows.map((node) =>
          h(
            'button',
            {
              key: node.id,
              className: 'dshmn_listRow',
              'data-active': node.id === selectedId ? '1' : '0',
              onClick: () => onSelect(node.id)
            },
            h('span', { className: 'dshmn_listDot', style: { background: layerColor(node.layer), color: layerColor(node.layer) } }),
            h('span', { className: 'dshmn_listKind' }, KIND_LABELS[node.kind] || node.kind),
            node.status === 'done' ? h('span', { className: 'dshmn_listStatus', style: { color: 'rgba(110,205,150,0.95)' } }, '✓') : null,
            node.status === 'parked' ? h('span', { className: 'dshmn_listStatus', style: { color: 'rgba(190,190,190,0.85)' } }, '⏸') : null,
            h('span', {
              className: 'dshmn_listTitle',
              style: node.status === 'done' ? { opacity: 0.55, textDecoration: 'line-through' } : undefined
            }, node.title),
            node.tags.length > 0 ? h('span', { className: 'dshmn_listTags' }, node.tags.join(' · ')) : null,
            node.pinned ? h('span', { className: 'dshmn_listPin' }, '★') : null
          )
        )
      )
    }

    function MemoryPanel() {
      const [graph, setGraph] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [query, setQuery] = useState('')
      const [hiddenLayers, setHiddenLayers] = useState(() => new Set())
      const [onlyPinned, setOnlyPinned] = useState(false)
      const [selectedId, setSelectedId] = useState('')
      const [sizeScale, setSizeScale] = useState(1)
      const [labelScale, setLabelScale] = useState(1)
      const [autoRotate, setAutoRotate] = useState(false)
      const [focus, setFocus] = useState(null)
      const [nonce, setNonce] = useState(0)
      const [view, setView] = useState('rings')
      const [composer, setComposer] = useState(null)

      // 在面板里直接新建一条记忆（末位节点）
      const saveComposer = useCallback(async () => {
        if (!composer || !String(composer.title || '').trim()) return
        setBusy(true)
        try {
          const response = await fetch('/api/dsh-memory-nebula/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'save',
              title: String(composer.title).trim(),
              text: String(composer.text || ''),
              layer: composer.layer,
              kind: composer.kind,
              tags: String(composer.tags || '')
                .split(/[,，\s]+/)
                .map((value) => value.trim())
                .filter(Boolean)
            })
          })
          const result = await response.json()
          if (result && result.ok) {
            setComposer(null)
            await load()
          }
        } catch {
          // 界面不弹错，保持安静
        } finally {
          setBusy(false)
        }
      }, [composer])


      const load = useCallback(async () => {
        setBusy(true)
        try {
          const data = await requestJson('/graph', { method: 'GET' })
          setGraph(data)
          setError('')
          setNonce((n) => n + 1)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const act = useCallback(
        async (body) => {
          setBusy(true)
          try {
            await requestJson('/action', { method: 'POST', body: JSON.stringify(body) })
            await load()
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [load]
      )

      const nodes = graph ? graph.nodes : []
      const edges = graph ? graph.edges : []
      const stats = graph && graph.stats ? graph.stats : { nodes: 0, edges: 0, pinned: 0, isolated: 0, byLayer: {} }
      const selected = nodes.find((node) => node.id === selectedId) || null

      const layerCounts = useMemo(() => {
        const counts = {}
        for (const node of nodes) counts[node.layer] = (counts[node.layer] || 0) + 1
        return counts
      }, [nodes])

      const linksOfSelected = useMemo(() => {
        if (!selected) return []
        const out = []
        for (const edge of edges) {
          const otherId = edge.from === selected.id ? edge.to : edge.to === selected.id ? edge.from : ''
          if (!otherId) continue
          const other = nodes.find((node) => node.id === otherId)
          if (other) out.push({ edge, other })
        }
        return out
      }, [edges, nodes, selected])

      const recent = useMemo(() => {
        return nodes
          .slice()
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .slice(0, 10)
      }, [nodes])

      const toggleLayer = (layer) => {
        setHiddenLayers((prev) => {
          const next = new Set(prev)
          if (next.has(layer)) next.delete(layer)
          else next.add(layer)
          return next
        })
      }

      return h(
        'div',
        { className: 'dshmn_root' },
        h('style', null, styles),
        h(
          'div',
          { className: 'dshmn_head' },
          h(
            'div',
            { className: 'dshmn_title' },
            '记忆星云',
            h('span', { className: 'dshmn_count' }, `${stats.nodes} 条 · ${stats.edges} 连线`)
          ),
          h(
            'label',
            { className: 'dshmn_search' },
            h('span', { style: { opacity: 0.5 } }, '⌕'),
            h('input', {
              value: query,
              placeholder: '搜标题 / 正文 / 标签…',
              onChange: (event) => setQuery(event.target.value)
            })
          ),
          h(
            'div',
            { className: 'dshmn_views' },
            VIEWS.map((item) =>
              h(
                'button',
                {
                  key: item.id,
                  className: 'dshmn_viewBtn',
                  'data-on': view === item.id ? '1' : '0',
                  title: item.hint,
                  onClick: () => setView(item.id)
                },
                item.label
              )
            )
          ),
          h(
            'button',
            { className: 'dshmn_btn', 'data-on': autoRotate ? '1' : '0', onClick: () => setAutoRotate((value) => !value) },
            '自转'
          ),
          h(
            'button',
            { className: 'dshmn_btn', onClick: () => setNonce((n) => n + 1), title: '重新计算布局' },
            '重排'
          ),
          h('button', { className: 'dshmn_btn', onClick: load, disabled: busy, title: '重新读取' }, busy ? '读取中…' : '刷新'),
          h(
            'button',
            {
              className: 'dshmn_btn',
              title: '新建一条记忆',
              onClick: () => setComposer({ title: '', text: '', layer: 'memory', kind: 'fact', tags: '' })
            },
            '+ 记一条'
          )
        ),
        composer
          ? h(
              'div',
              { className: 'dshmn_composer' },
              h('input', {
                className: 'dshmn_in',
                placeholder: '标题（一句话说清是什么）',
                value: composer.title,
                onChange: (event) => setComposer({ ...composer, title: event.target.value })
              }),
              h('textarea', {
                className: 'dshmn_in dshmn_ta',
                placeholder: '正文：当时的细节、为什么、怎么做',
                value: composer.text,
                onChange: (event) => setComposer({ ...composer, text: event.target.value })
              }),
              h(
                'div',
                { className: 'dshmn_inline' },
                h(
                  'select',
                  {
                    className: 'dshmn_in',
                    value: composer.layer,
                    onChange: (event) => setComposer({ ...composer, layer: event.target.value })
                  },
                  LAYER_ORDER.map((layer) => h('option', { key: layer, value: layer }, LAYER_LABELS[layer] || layer))
                ),
                h(
                  'select',
                  {
                    className: 'dshmn_in',
                    value: composer.kind,
                    onChange: (event) => setComposer({ ...composer, kind: event.target.value })
                  },
                  Object.keys(KIND_LABELS).map((kind) => h('option', { key: kind, value: kind }, KIND_LABELS[kind]))
                ),
                h('input', {
                  className: 'dshmn_in',
                  placeholder: '标签，逗号分隔',
                  value: composer.tags,
                  onChange: (event) => setComposer({ ...composer, tags: event.target.value })
                })
              ),
              h(
                'div',
                { className: 'dshmn_inline' },
                h('button', { className: 'dshmn_btn', onClick: saveComposer }, '存下'),
                h('button', { className: 'dshmn_btn', onClick: () => setComposer(null) }, '取消')
              )
            )
          : null,
        h(
          'div',
          { className: 'dshmn_body' },
          h(
            'div',
            { className: 'dshmn_side' },
            h('div', { className: 'dshmn_groupLabel' }, '分层'),
            LAYER_ORDER.map((layer) =>
              h(
                'label',
                { key: layer, className: 'dshmn_layer' },
                h('input', {
                  type: 'checkbox',
                  checked: !hiddenLayers.has(layer),
                  onChange: () => toggleLayer(layer)
                }),
                h('span', { className: 'dshmn_dot', style: { background: layerColor(layer), color: layerColor(layer) } }),
                h(
                  'span',
                  {
                    className: 'dshmn_layerName',
                    onClick: (event) => {
                      event.preventDefault()
                      setFocus(focus && focus.layer === layer && !focus.kind ? null : { layer, kind: '' })
                    }
                  },
                  LAYER_LABELS[layer]
                ),
                h('span', { className: 'dshmn_layerNum' }, layerCounts[layer] || 0)
              )
            ),
            h(
              'label',
              { className: 'dshmn_layer' },
              h('input', { type: 'checkbox', checked: onlyPinned, onChange: () => setOnlyPinned((value) => !value) }),
              h('span', { className: 'dshmn_dot', style: { background: '#f6c562', color: '#f6c562' } }),
              h('span', null, '只看钉住'),
              h('span', { className: 'dshmn_layerNum' }, stats.pinned || 0)
            ),
            h('div', { className: 'dshmn_groupLabel' }, '显示'),
            h(
              'label',
              { className: 'dshmn_range' },
              h('span', null, `节点大小 ${sizeScale.toFixed(2)}×`),
              h('input', {
                type: 'range',
                min: 0.5,
                max: 1.8,
                step: 0.05,
                value: sizeScale,
                onChange: (event) => setSizeScale(Number(event.target.value))
              })
            ),
            h(
              'label',
              { className: 'dshmn_range' },
              h('span', null, `标签密度 ${labelScale.toFixed(2)}×`),
              h('input', {
                type: 'range',
                min: 0.4,
                max: 1.8,
                step: 0.05,
                value: labelScale,
                onChange: (event) => setLabelScale(Number(event.target.value))
              })
            ),
            h('div', { className: 'dshmn_groupLabel' }, '概览'),
            h(
              'div',
              { className: 'dshmn_stats' },
              h('div', { className: 'dshmn_stat' }, h('b', null, stats.nodes), h('span', null, '条目')),
              h('div', { className: 'dshmn_stat' }, h('b', null, stats.edges), h('span', null, '连线')),
              h('div', { className: 'dshmn_stat' }, h('b', null, stats.pinned), h('span', null, '钉住')),
              h('div', { className: 'dshmn_stat' }, h('b', null, stats.isolated), h('span', null, '孤立'))
            )
          ),
          view === 'list'
            ? h(
                'div',
                { className: 'dshmn_listWrap' },
                h(MemoryList, {
                  nodes,
                  selectedId,
                  onSelect: setSelectedId,
                  query,
                  hiddenLayers,
                  onlyPinned
                })
              )
            : h(GraphCanvas, {
                graph,
                layoutNonce: nonce,
                hiddenLayers,
                query,
                onlyPinned,
                selectedId,
                onSelect: setSelectedId,
                sizeScale,
                labelScale,
                autoRotate,
                view,
                focus,
                onFocus: setFocus
              }),
          h(
            'div',
            { className: 'dshmn_detail' },
            error ? h('div', { className: 'dshmn_err' }, error) : null,
            selected
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'dshmn_detailHead' },
                    h('span', { className: 'dshmn_pill', style: { color: layerColor(selected.layer) } }, KIND_LABELS[selected.kind] || selected.kind),
                    h('span', { className: 'dshmn_pill', style: { color: 'rgba(255,255,255,.5)' } }, LAYER_LABELS[selected.layer] || selected.layer),
                    selected.pinned ? h('span', { className: 'dshmn_pill', style: { color: '#f6c562' } }, '钉住') : null
                  ),
                  h('div', { className: 'dshmn_detailTitle' }, selected.title),
                  h('div', { className: 'dshmn_detailBody' }, selected.body),
                  selected.tags.length > 0
                    ? h('div', { className: 'dshmn_tags' }, selected.tags.map((tag) => h('span', { key: tag, className: 'dshmn_tag' }, tag)))
                    : null,
                  h(
                    'div',
                    { className: 'dshmn_actions' },
                    h(
                      'button',
                      {
                        className: 'dshmn_btn',
                        onClick: () => act({ action: 'pin', id: selected.id, pinned: !selected.pinned })
                      },
                      selected.pinned ? '取消钉住' : '钉住'
                    ),
                    h(
                      'button',
                      {
                        className: 'dshmn_btn',
                        'data-danger': '1',
                        onClick: () => {
                          if (!window.confirm(`删除「${selected.title}」？`)) return
                          setSelectedId('')
                          act({ action: 'forget', id: selected.id })
                        }
                      },
                      '删除'
                    )
                  ),
                  h(
                    'div',
                    { className: 'dshmn_links' },
                    h('div', { className: 'dshmn_groupLabel' }, `连到 ${linksOfSelected.length} 条`),
                    linksOfSelected.length === 0
                      ? h('div', { style: { fontSize: 11.5, color: 'rgba(255,255,255,.35)' } }, '还没有连线。')
                      : linksOfSelected.map(({ edge, other }) =>
                          h(
                            'button',
                            { key: edge.id, className: 'dshmn_linkRow', onClick: () => setSelectedId(other.id) },
                            h('span', { className: 'dshmn_dot', style: { width: 6, height: 6, background: layerColor(other.layer), color: layerColor(other.layer) } }),
                            h('span', { className: 'dshmn_linkKind' }, edge.kind),
                            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, other.title)
                          )
                        )
                  )
                )
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'dshmn_empty' },
                    graph && nodes.length === 0
                      ? '还没有记忆。让模型用 memory_save 记下第一件事，或在这个面板里等它长出来。'
                      : '点一颗星，看看它记得什么。拖拽旋转，滚轮缩放。'
                  ),
                  nodes.length > 0
                    ? h(
                        React.Fragment,
                        null,
                        h('div', { className: 'dshmn_groupLabel', style: { padding: '0 12px' } }, '最近更新'),
                        h(
                          'div',
                          { className: 'dshmn_recent' },
                          recent.map((node) =>
                            h(
                              'button',
                              { key: node.id, className: 'dshmn_recentRow', onClick: () => setSelectedId(node.id) },
                              h('span', { className: 'dshmn_dot', style: { width: 6, height: 6, background: layerColor(node.layer), color: layerColor(node.layer) } }),
                              h('span', { style: { flex: 1, minWidth: 0 } }, node.title)
                            )
                          )
                        )
                      )
                    : null
                )
          )
        ),
        h('div', { className: 'dshmn_hint' }, '拖拽旋转 · 滚轮缩放 · 点击查看 · 中心是「记忆核心」，所有记忆从这里长出来')
      )
    }

    function MemorySidebarIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true', style: { display: 'block' } },
        h('path', { d: 'M12 4.2 5.4 8v8L12 19.8 18.6 16V8Z', stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.42 }),
        h('path', { d: 'M12 4.2 18.6 8M12 4.2 5.4 8M12 12v7.8M12 12 5.4 8M12 12l6.6-4', stroke: 'currentColor', strokeWidth: 0.8, opacity: 0.3 }),
        h('circle', { cx: 12, cy: 4.2, r: 1.7, fill: 'currentColor' }),
        h('circle', { cx: 5.4, cy: 8, r: 1.5, fill: 'currentColor', opacity: 0.8 }),
        h('circle', { cx: 18.6, cy: 8, r: 1.5, fill: 'currentColor', opacity: 0.8 }),
        h('circle', { cx: 5.4, cy: 16, r: 1.5, fill: 'currentColor', opacity: 0.55 }),
        h('circle', { cx: 18.6, cy: 16, r: 1.5, fill: 'currentColor', opacity: 0.55 }),
        h('circle', { cx: 12, cy: 19.8, r: 1.7, fill: 'currentColor', opacity: 0.9 }),
        h('circle', { cx: 12, cy: 12, r: 2.1, fill: 'currentColor' })
      )
    }

    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 60,
            label: () => '记忆星云'
          },
          (props) => h(MemorySidebarIcon, props && typeof props === 'object' && 'size' in props ? props : {})
        )
      )
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          { name: 'main', key: PANEL_ID },
          () => h(MemoryPanel)
        )
      )
    }

    return { name: 'dsh-memory-nebula', inject: ['slots'], apply }
  }
})
