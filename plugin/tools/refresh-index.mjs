#!/usr/bin/env node
/**
 * refresh-index —— SessionStart hook：把线上单据（需求 / 工作项 / 缺陷）拉成一份本地索引。
 *
 * 用法：node tools/refresh-index.mjs [--force]
 *
 * 为什么有它：搜索解决「知道找什么」，解决不了「不知道线上有什么」。索引只用来找单号和
 * Room，**状态以线上为准**（transitions 现查）；注入上下文的只有一行计数，正文靠 Agent 自己 grep。
 *
 * 落点：($XDG_CACHE_HOME 或 ~/.cache)/workflow/index/<host>.json —— 不进仓、不进插件根。
 * 结构：{ api: 1, host, serverTime, fullPulledAt, refreshedAt, rooms: { [RM-key]: { id, name } },
 *         items: { [displayKey]: { type, room, title, status, updatedAt } }, stale?: { attemptedAt, reason } }
 *
 * 判定顺序：
 *   0. 凭证按 tools/lib/workflow-config.mjs：env → .workflow → config.toml；.workflow 缺失 → 退出 0，
 *      不拉不注；解析不出 profile / profile 不完整 → stderr 一行、退出 0；**绝不回落 current_profile**。
 *   1. TTL：refreshedAt（或上次失败的 stale.attemptedAt）距今不足 15 分钟 → 直接退出 0；--force 忽略。
 *      失败也占 TTL，否则离线时每次会话开始都要空等 12 秒。
 *   2. 全量：无快照 / fullPulledAt 超过 24 h / 增量返 410（水位早于墓碑保留期）/ 增量返 404（端点未
 *      上线）/ 增量返 501（demo 项目或业务库租户未装配）→ GET /rooms?limit=50 取 Room 名字映射，再
 *      GET /sync/changes **不带 updatedSince**（同一端点，一次拿全三类，只回未删对象）。
 *      注意两条路径同端点：410 回退全量必然成功（全量不带水位），但 404 / 501 回退会撞上同一个
 *      404 / 501，最终落到 stale——那是诚实结果（端点在这个 host 上真的没有），reason 会指明状态码。
 *   3. 增量：同一端点带 updatedSince=<serverTime − 60 s>；按 displayKey 合并取 updatedAt 大者，
 *      deletedAt 非空删键；响应 serverTime 写回水位。
 *   4. 预算：每请求 5 s AbortController，总预算 12 s（hook 超时 15 s）。任何异常 → stderr 一行、退出 0，
 *      沿用旧快照并在文件里标 stale（离线沿用）。
 *   5. 写盘：临时文件 + rename，不用锁；写前重读，磁盘 refreshedAt 已被别的会话更新则放弃。
 *
 * /sync/changes 的 wire 形状（合同已冻结）：八个字段全部 required、永远显式出现——type / id /
 * displayKey / roomId / title / status / updatedAt / deletedAt；**没有 description**。空串是有意义的值：
 * roomId 空串 = 未归属需求室，deletedAt 空串 = 活着（非空才是墓碑，其余字段是删除时刻快照）。
 * 所以墓碑判定只能是 `if (change.deletedAt)`，写成 `!= null` 会把每个活对象都当成已删。
 * status 是自由字符串不是枚举，nextCursor 空串 = 到底，serverTime 是本轮开始时的取样、翻页期间恒定。
 *
 * 两条语义，用索引前必须知道：
 *   - **可见性按模块 read 裁类型**：PAT 若没有某模块的 read，该类整类不出现、且**不报 403**。
 *     「索引里没有缺陷」与「项目里真没有缺陷」在响应上无法区分——不得据索引断言「项目里没有 X」。
 *   - **不要加 roomId 参数**：一律按项目拉、本地按 roomId 分组。被移出某室的对象不会出现在该室的
 *     增量里（它只出现在新室），按室拉会让旧室永远删不掉那条。
 *
 * 退出码恒 0：索引是便利，不是门。stdout 一个字都不写——SessionStart 的 stdout 会进上下文。
 */
import { mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { cacheIndexPath, readIndexFile, resolveCredentials } from './lib/workflow-config.mjs'

export const TTL_MS = 15 * 60 * 1000
export const FULL_INTERVAL_MS = 24 * 60 * 60 * 1000
export const REQUEST_TIMEOUT_MS = 5_000
export const TOTAL_BUDGET_MS = 12_000
export const WATERMARK_SLACK_MS = 60_000
const SYNC_TYPES = 'requirement,work_item,bug'
// 服务端默认 100；总预算 12 s、单请求 5 s，按 100 翻页很容易在变更量大时把预算翻完。
const PAGE_LIMIT = 250

class RefreshError extends Error {
  constructor(message, { status } = {}) {
    super(message)
    this.status = status
  }
}

function isoMs(ms) {
  return new Date(ms).toISOString()
}

/** 建一个受总预算约束的 GET 客户端；每个请求单独 5 s，超总预算直接抛。 */
function makeClient({ apiBase, token, fetchImpl, deadline, now, requestTimeoutMs }) {
  return async function getJson(pathAndQuery) {
    const remaining = deadline - now()
    if (remaining <= 0) throw new RefreshError('总预算用尽')
    const controller = new AbortController()
    const clampedByBudget = remaining < requestTimeoutMs
    const timer = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, remaining))
    let response
    try {
      response = await fetchImpl(apiBase + pathAndQuery, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (error) {
      const path = pathAndQuery.split('?')[0]
      if (error?.name === 'AbortError') throw new RefreshError(clampedByBudget ? `总预算用尽（${path}）` : `请求超时：${path}`)
      throw new RefreshError(`网络错误：${error?.message ?? error}`)
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      throw new RefreshError(`HTTP ${response.status}：${pathAndQuery.split('?')[0]}`, { status: response.status })
    }
    let body
    try {
      body = await response.json()
    } catch {
      throw new RefreshError(`响应不是 JSON：${pathAndQuery.split('?')[0]}`)
    }
    const dateHeader = response.headers?.get?.('date')
    const serverDate = dateHeader ? Date.parse(dateHeader) : NaN
    return { body, serverDate: Number.isFinite(serverDate) ? serverDate : null }
  }
}

function roomsFromList(items) {
  const rooms = {}
  for (const room of items ?? []) {
    if (!room?.displayKey || !room?.id) continue
    rooms[room.displayKey] = { id: room.id, name: room.name ?? '' }
  }
  return rooms
}

function roomKeyById(rooms, roomId) {
  if (!roomId) return null
  for (const [key, room] of Object.entries(rooms)) if (room.id === roomId) return key
  return null
}

/** 把一条 wire 变更压成索引条目；roomKey 由调用方解析（增量可能要先补 Room 映射）。 */
function toItem(change, roomKey, existing) {
  return {
    type: change.type ?? existing?.type ?? null,
    room: roomKey,
    title: change.title ?? existing?.title ?? '',
    status: change.status ?? existing?.status ?? null,
    updatedAt: change.updatedAt ?? existing?.updatedAt ?? null,
  }
}

/**
 * 逐页拉 /sync/changes，每条变更交给 onChange；cursor 翻到 nextCursor 为空串。
 * 省略 updatedSince = 全量（只回未删对象），带上 = 增量。
 * 游标绑定 updatedSince / types / roomId：翻页时这三样必须与首页逐字一致，否则 422，所以整个查询
 * 串只在末尾追加 cursor。serverTime 取第一页（合同保证翻页期间恒为首页取样值），返回给调用方作水位。
 */
async function pullChanges({ getJson, updatedSince, onChange }) {
  let serverTime = null
  let cursor = ''
  do {
    const query = '/sync/changes?' +
      (updatedSince ? `updatedSince=${encodeURIComponent(updatedSince)}&` : '') +
      `types=${SYNC_TYPES}&limit=${PAGE_LIMIT}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    const { body, serverDate } = await getJson(query)
    if (serverTime === null) {
      if (typeof body?.serverTime === 'string' && body.serverTime) serverTime = body.serverTime
      else if (serverDate) serverTime = isoMs(serverDate)
    }
    for (const change of body?.items ?? []) {
      if (!change?.displayKey) continue
      await onChange(change)
    }
    cursor = body?.nextCursor ?? ''
  } while (cursor)
  return serverTime
}

/**
 * 全量：Room 列表（只为拿 Room 名字映射）+ /sync/changes 不带 updatedSince。
 * 用同一个端点而不是逐 Room 拉 /requirements——后者只拿得到需求，工作项与缺陷根本进不了索引，
 * 于是每 24 h 的全量对齐会把增量带进来的那两类整片冲掉。同端点全量后两条路径覆盖一致。
 */
async function pullFull({ getJson, now }) {
  const roomsResp = await getJson('/rooms?limit=50')
  const rooms = roomsFromList(roomsResp.body?.items)
  const items = {}
  const serverTime = await pullChanges({
    getJson,
    onChange: (change) => {
      // 全量本就只回未删对象；真回了墓碑也不该进索引。
      if (change.deletedAt) return
      items[change.displayKey] = toItem(change, roomKeyById(rooms, change.roomId), items[change.displayKey])
    },
  })
  const pulledAt = now()
  return {
    serverTime: serverTime ?? isoMs(roomsResp.serverDate ?? pulledAt),
    fullPulledAt: isoMs(pulledAt),
    rooms,
    items,
  }
}

/** 增量：从水位 − 60 s 起取变更并合并进旧快照。404 / 410 / 501 抛出让调用方回退全量。 */
async function pullIncremental({ getJson, previous }) {
  const watermark = Date.parse(previous.serverTime)
  if (!Number.isFinite(watermark)) throw new RefreshError('旧快照没有可用水位', { status: 410 })
  const updatedSince = isoMs(watermark - WATERMARK_SLACK_MS)
  const items = { ...previous.items }
  let rooms = { ...(previous.rooms ?? {}) }
  let roomsRefetched = false
  const serverTime = await pullChanges({
    getJson,
    updatedSince,
    onChange: async (change) => {
      const key = change.displayKey
      // deletedAt 空串 = 活着，非空 = 墓碑。不得写成 `!= null`：那会把每个活对象都删掉。
      if (change.deletedAt) {
        delete items[key]
        return
      }
      const existing = items[key]
      if (existing?.updatedAt && change.updatedAt && Date.parse(change.updatedAt) <= Date.parse(existing.updatedAt)) return
      // roomId 空串 = 未归属需求室 → roomKeyById 返回 null，不触发重拉。
      let roomKey = roomKeyById(rooms, change.roomId)
      if (change.roomId && roomKey === null && !roomsRefetched) {
        // 新 Room 只会出现在这里；重拉一次 Room 列表补映射，之后不再重拉。
        roomsRefetched = true
        const roomsResp = await getJson('/rooms?limit=50')
        rooms = { ...rooms, ...roomsFromList(roomsResp.body?.items) }
        roomKey = roomKeyById(rooms, change.roomId)
      }
      items[key] = toItem(change, roomKey, existing)
    },
  })
  return { serverTime: serverTime ?? previous.serverTime, fullPulledAt: previous.fullPulledAt, rooms, items }
}

/** 临时文件 + rename；写前重读，磁盘 refreshedAt 已变则放弃。返回是否写入。 */
function writeIndexFile(path, doc, baselineRefreshedAt) {
  const onDisk = readIndexFile(path)
  if (onDisk && onDisk.refreshedAt !== baselineRefreshedAt) return false
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8')
    renameSync(tmp, path)
    return true
  } catch (error) {
    try { unlinkSync(tmp) } catch { /* 临时文件可能没建成 */ }
    throw new RefreshError(`写盘失败：${error?.message ?? error}`)
  }
}

/**
 * 主流程。返回 { status, path?, reason?, mode? }，status ∈
 *   'no-marker' | 'no-credentials' | 'fresh' | 'refreshed' | 'stale' | 'abandoned'
 * 只写 stderr（经 log），从不写 stdout，从不抛。
 */
export async function refreshIndex({
  env = process.env,
  cwd = process.cwd(),
  home = homedir(),
  force = false,
  now = () => Date.now(),
  fetchImpl = globalThis.fetch,
  log = (line) => process.stderr.write(`${line}\n`),
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  totalBudgetMs = TOTAL_BUDGET_MS,
} = {}) {
  const creds = resolveCredentials({ env, cwd, home })
  if (!creds.ok) {
    if (creds.warn) log(`workflow index：${creds.warn}`)
    return { status: creds.reason === 'no-marker' ? 'no-marker' : 'no-credentials', reason: creds.reason }
  }

  const path = cacheIndexPath({ env, home, host: creds.host })
  const previous = readIndexFile(path)
  const startedAt = now()
  const baselineRefreshedAt = previous?.refreshedAt ?? null

  if (!force && previous) {
    const last = Math.max(Date.parse(previous.refreshedAt) || 0, Date.parse(previous.stale?.attemptedAt) || 0)
    if (startedAt - last < TTL_MS) return { status: 'fresh', path }
  }

  const deadline = startedAt + totalBudgetMs
  const getJson = makeClient({ apiBase: creds.apiBase, token: creds.token, fetchImpl, deadline, now, requestTimeoutMs })

  const fullAge = previous?.fullPulledAt ? startedAt - Date.parse(previous.fullPulledAt) : Infinity
  let mode = !previous || !Number.isFinite(fullAge) || fullAge > FULL_INTERVAL_MS ? 'full' : 'incremental'

  let next
  try {
    if (mode === 'incremental') {
      try {
        next = await pullIncremental({ getJson, previous })
      } catch (error) {
        if (error?.status === 410) {
          mode = 'full'
        } else if (error?.status === 404 || error?.status === 501) {
          // 404 = 端点未上线；501 = demo 项目或业务库租户未装配。两者都不是「出错了」，
          // 当成未知错误会走「标 stale、沿用旧快照」——这类 host 上索引就永远建不起来。
          log(`workflow index：增量端点 /sync/changes ${error.status === 404
            ? '未上线（404）'
            : '未装配（501：demo 项目或业务库租户）'}，回退全量`)
          mode = 'full'
        } else {
          throw error
        }
      }
    }
    if (mode === 'full') next = await pullFull({ getJson, now })
  } catch (error) {
    const reason = error instanceof RefreshError ? error.message : `未知错误：${error?.message ?? error}`
    log(`workflow index：${previous ? '离线沿用旧快照' : '未生成'}（${reason}）`)
    if (previous) {
      const staleDoc = { ...previous, stale: { attemptedAt: isoMs(now()), reason } }
      try { writeIndexFile(path, staleDoc, baselineRefreshedAt) } catch { /* 标记失败不再报 */ }
    }
    return { status: 'stale', path, reason, mode }
  }

  const doc = {
    api: 1,
    host: creds.host,
    serverTime: next.serverTime,
    fullPulledAt: next.fullPulledAt,
    refreshedAt: isoMs(now()),
    rooms: next.rooms,
    items: next.items,
  }
  let written
  try {
    written = writeIndexFile(path, doc, baselineRefreshedAt)
  } catch (error) {
    log(`workflow index：${error.message}`)
    return { status: 'stale', path, reason: error.message, mode }
  }
  if (!written) return { status: 'abandoned', path, mode }
  return { status: 'refreshed', path, mode, itemCount: Object.keys(doc.items).length, roomCount: Object.keys(doc.rooms).length }
}

async function main() {
  const force = process.argv.includes('--force')
  try {
    await refreshIndex({ force })
  } catch (error) {
    process.stderr.write(`workflow index：${error?.message ?? error}\n`)
  }
  process.exit(0)
}

function isMainModule() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isMainModule()) main()
