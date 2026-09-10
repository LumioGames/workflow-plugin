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
 *      上线）→ GET /rooms?limit=50，逐 Room GET /requirements?roomId=&view=summary&limit=250，cursor 翻到
 *      nextCursor 为空（Room 之间 4 路并发——15 个 Room 串行实测 ~9 s，逼近总预算）；items 只含
 *      type=requirement。
 *   3. 增量：GET /sync/changes?updatedSince=<serverTime − 60 s>&types=requirement,work_item,bug（cursor
 *      分页）；按 displayKey 合并取 updatedAt 大者，deletedAt 非空删键；响应 serverTime 写回水位。
 *   4. 预算：每请求 5 s AbortController，总预算 12 s（hook 超时 15 s）。任何异常 → stderr 一行、退出 0，
 *      沿用旧快照并在文件里标 stale（离线沿用）。
 *   5. 写盘：临时文件 + rename，不用锁；写前重读，磁盘 refreshedAt 已被别的会话更新则放弃。
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
const PAGE_LIMIT = 250
const ROOM_CONCURRENCY = 4

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

/** 逐页拉一个 Room 的需求摘要，cursor 翻到空；返回 [displayKey, item] 列表。 */
async function pullRoomRequirements({ getJson, roomKey, roomId }) {
  const out = []
  let cursor = ''
  do {
    const query = `/requirements?roomId=${encodeURIComponent(roomId)}&view=summary&limit=${PAGE_LIMIT}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    const { body } = await getJson(query)
    for (const req of body?.items ?? []) {
      if (!req?.displayKey) continue
      out.push([req.displayKey, {
        type: 'requirement',
        room: roomKey,
        title: req.title ?? '',
        status: req.status ?? null,
        updatedAt: req.updatedAt ?? null,
      }])
    }
    cursor = body?.nextCursor ?? ''
  } while (cursor)
  return out
}

/** 有界并发跑任务；任一失败立即抛（其余在途请求由各自的超时收尾）。 */
async function mapLimited(inputs, limit, fn) {
  const results = new Array(inputs.length)
  let next = 0
  async function worker() {
    for (;;) {
      const i = next++
      if (i >= inputs.length) return
      results[i] = await fn(inputs[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker))
  return results
}

/** 全量：Room 列表 + 逐 Room 需求摘要（4 路并发，单 Room 内按 cursor 串行）。返回新文档主体。 */
async function pullFull({ getJson, now }) {
  const roomsResp = await getJson('/rooms?limit=50')
  const rooms = roomsFromList(roomsResp.body?.items)
  const perRoom = await mapLimited(Object.entries(rooms), ROOM_CONCURRENCY, ([roomKey, room]) =>
    pullRoomRequirements({ getJson, roomKey, roomId: room.id }),
  )
  const items = {}
  for (const list of perRoom) for (const [key, item] of list) items[key] = item
  const pulledAt = now()
  const serverTime = roomsResp.serverDate ?? pulledAt
  return { serverTime: isoMs(serverTime), fullPulledAt: isoMs(pulledAt), rooms, items }
}

/** 增量：从水位 − 60 s 起取变更并合并进旧快照。404 / 410 抛出让调用方回退全量。 */
async function pullIncremental({ getJson, previous }) {
  const watermark = Date.parse(previous.serverTime)
  if (!Number.isFinite(watermark)) throw new RefreshError('旧快照没有可用水位', { status: 410 })
  const updatedSince = isoMs(watermark - WATERMARK_SLACK_MS)
  const items = { ...previous.items }
  let rooms = { ...(previous.rooms ?? {}) }
  let roomsRefetched = false
  let serverTime = null
  let cursor = ''
  do {
    const query = `/sync/changes?updatedSince=${encodeURIComponent(updatedSince)}&types=${SYNC_TYPES}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    const { body, serverDate } = await getJson(query)
    if (typeof body?.serverTime === 'string') serverTime = body.serverTime
    else if (serverTime === null && serverDate) serverTime = isoMs(serverDate)
    for (const change of body?.items ?? []) {
      const key = change?.displayKey
      if (!key) continue
      if (change.deletedAt) {
        delete items[key]
        continue
      }
      const existing = items[key]
      if (existing?.updatedAt && change.updatedAt && Date.parse(change.updatedAt) <= Date.parse(existing.updatedAt)) continue
      let roomKey = roomKeyById(rooms, change.roomId)
      if (change.roomId && roomKey === null && !roomsRefetched) {
        // 新 Room 只会出现在这里；重拉一次 Room 列表补映射，之后不再重拉。
        roomsRefetched = true
        const roomsResp = await getJson('/rooms?limit=50')
        rooms = { ...rooms, ...roomsFromList(roomsResp.body?.items) }
        roomKey = roomKeyById(rooms, change.roomId)
      }
      items[key] = {
        type: change.type ?? existing?.type ?? null,
        room: roomKey,
        title: change.title ?? existing?.title ?? '',
        status: change.status ?? existing?.status ?? null,
        updatedAt: change.updatedAt ?? existing?.updatedAt ?? null,
      }
    }
    cursor = body?.nextCursor ?? ''
  } while (cursor)
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
        } else if (error?.status === 404) {
          log('workflow index：增量端点 /sync/changes 未上线（404），回退全量')
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
