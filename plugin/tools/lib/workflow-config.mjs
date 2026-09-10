/**
 * workflow-config —— 凭证解析与索引缓存路径（inject-rules / refresh-index 共用）。
 *
 * 口径是 skills/workflow-ops/references/connection.md 第一节的 JS 移植，只取前两级：
 *   1. 环境变量 WORKFLOW_API_BASE（以 /api/v1 结尾）+ WORKFLOW_TOKEN，最高优先；
 *   2. 从 cwd 向上找最近的 .workflow（到含 .git 的目录或文件系统根为止），按其 profile 名
 *      到 ~/.config/workflow/config.toml 的 [profiles.<名>] 取 base_url 与 token。
 * **绝不回落第 3 级 current_profile。** 这两个工具跑在会话开始、无人看着；标记文件在场却被
 * 忽略，等于把索引拉自另一个项目——宁可不拉。
 *
 * 所有函数都不抛：解析失败返回 { ok: false, reason, warn }，由调用方决定是否打一行 stderr。
 * token 只在返回对象里流转，绝不写进任何消息。
 */
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const API_SUFFIX = '/api/v1'
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** 从 cwd 向上找最近的 .workflow；到含 .git 的目录或根为止。找不到返回 null。 */
export function findWorkflowMarker(cwd) {
  let dir = resolve(cwd)
  for (;;) {
    const marker = join(dir, '.workflow')
    if (existsSync(marker)) return marker
    if (existsSync(join(dir, '.git'))) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** .workflow 顶层只有 profile 一个键；单引号、键名拼错、缺引号一律视为解析失败。 */
export function parseMarkerProfile(text) {
  const m = /^[ \t]*profile[ \t]*=[ \t]*"([^"]*)"/m.exec(text)
  const name = m?.[1]?.trim()
  return name ? name : null
}

/** 取 config.toml 里 [profiles.<name>] 的 base_url / token（缺项为 undefined）。 */
export function parseProfile(configText, name) {
  const lines = configText.split(/\r?\n/)
  let inside = false
  const out = {}
  for (const line of lines) {
    const header = /^\[([^\]]+)\]\s*$/.exec(line)
    if (header) {
      inside = header[1].trim() === `profiles.${name}`
      continue
    }
    if (!inside) continue
    const kv = /^(base_url|token)\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(line)
    if (kv && out[kv[1]] === undefined) out[kv[1]] = kv[2]
  }
  return out
}

function normalizeBase(siteRoot) {
  let base = siteRoot.trim().replace(/\/+$/, '')
  if (base.endsWith(API_SUFFIX)) base = base.slice(0, -API_SUFFIX.length)
  return base
}

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * 解析凭证。返回：
 *   { ok: true, source: 'env' | 'marker', profile?, baseUrl, apiBase, token, host }
 *   { ok: false, reason: 'no-marker' }                            —— 静默：不拉不注
 *   { ok: false, reason: 'marker-unparseable' | 'config-missing' | 'profile-missing'
 *                | 'profile-incomplete' | 'bad-base-url', warn }  —— 一行警告
 */
export function resolveCredentials({ env = process.env, cwd = process.cwd(), home = homedir() } = {}) {
  const envBase = env.WORKFLOW_API_BASE?.trim()
  const envToken = env.WORKFLOW_TOKEN?.trim()
  if (envBase && envToken) {
    const baseUrl = normalizeBase(envBase)
    const host = hostOf(baseUrl)
    if (!host) return { ok: false, reason: 'bad-base-url', warn: `WORKFLOW_API_BASE 不是合法 URL` }
    return { ok: true, source: 'env', baseUrl, apiBase: baseUrl + API_SUFFIX, token: envToken, host }
  }

  const marker = findWorkflowMarker(cwd)
  if (!marker) return { ok: false, reason: 'no-marker' }

  let markerText
  try {
    markerText = readFileSync(marker, 'utf8')
  } catch {
    return { ok: false, reason: 'marker-unparseable', warn: `读不到 ${marker}` }
  }
  const profile = parseMarkerProfile(markerText)
  if (!profile) {
    return {
      ok: false,
      reason: 'marker-unparseable',
      warn: `找到 ${marker} 但解析不出 profile：请修标记文件（不回落全局 current_profile）`,
    }
  }

  const configPath = join(home, '.config', 'workflow', 'config.toml')
  if (!existsSync(configPath)) {
    return { ok: false, reason: 'config-missing', warn: `${marker} 指向 profile「${profile}」，但 ${configPath} 不存在` }
  }
  let configText
  try {
    configText = readFileSync(configPath, 'utf8')
  } catch {
    return { ok: false, reason: 'config-missing', warn: `读不到 ${configPath}` }
  }
  const section = parseProfile(configText, profile)
  if (section.base_url === undefined && section.token === undefined) {
    return { ok: false, reason: 'profile-missing', warn: `config.toml 里没有 [profiles.${profile}]（不回落 current_profile）` }
  }
  if (!section.base_url || !section.token) {
    return { ok: false, reason: 'profile-incomplete', warn: `profile「${profile}」缺 base_url 或 token：转 workflow-setup 补齐` }
  }

  const baseUrl = normalizeBase(section.base_url)
  const host = hostOf(baseUrl)
  if (!host) return { ok: false, reason: 'bad-base-url', warn: `profile「${profile}」的 base_url 不是合法 URL` }
  if (!baseUrl.startsWith('https://') && !LOOPBACK.has(host)) {
    return { ok: false, reason: 'bad-base-url', warn: `profile「${profile}」的 base_url 不是 HTTPS：不拉索引` }
  }
  return { ok: true, source: 'marker', profile, baseUrl, apiBase: baseUrl + API_SUFFIX, token: section.token, host }
}

/** 索引缓存目录：$XDG_CACHE_HOME 或 ~/.cache，下挂 workflow/index/。不进仓、不进插件根。 */
export function cacheIndexDir({ env = process.env, home = homedir() } = {}) {
  const xdg = env.XDG_CACHE_HOME?.trim()
  return join(xdg || join(home, '.cache'), 'workflow', 'index')
}

/**
 * 索引缓存的身份键：hostname 之外还要区分端口与凭据范围。
 * 只按 hostname 切分时,127.0.0.1:4011 与 :4012 共用一个文件,B 项目会直接读到 A 的标题;
 * 同一 host 上换一枚权限不同的 token 也不会重置缓存,于是"看得见的类型"跟着旧 token 走。
 * 指纹取 sha256(baseUrl + token) 前 8 位:单向、不可逆推,且 token 本身不进文件名、不进日志。
 */
export function cacheIdentity({ baseUrl = '', token = '' } = {}) {
  return createHash('sha256').update(`${baseUrl}\u0000${token}`).digest('hex').slice(0, 8)
}

/**
 * 某个凭据的索引文件路径：<cacheIndexDir>/<host>-<身份指纹>.json。
 * 传 creds（resolveCredentials 的返回）时按完整身份分区；只传 host 时退化为旧的
 * <host>.json —— 仅供读取历史快照，不要用于写入。
 */
export function cacheIndexPath({ env = process.env, home = homedir(), host, creds } = {}) {
  const dir = cacheIndexDir({ env, home })
  if (!creds?.ok) return join(dir, `${host}.json`)
  const port = (() => { try { return new URL(creds.baseUrl).port } catch { return '' } })()
  const hostPart = port ? `${creds.host}_${port}` : creds.host
  return join(dir, `${hostPart}-${cacheIdentity(creds)}.json`)
}

/** 读索引文件；不存在或损坏都返回 null（损坏视同无快照，由刷新走全量覆盖）。 */
export function readIndexFile(path) {
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'))
    // typeof null === 'object':不显式排掉 null 与数组,坏快照会一路混到 Object.values 才炸。
    if (!doc || typeof doc !== 'object' || doc.api !== 1) return null
    if (!doc.items || typeof doc.items !== 'object' || Array.isArray(doc.items)) return null
    return doc
  } catch {
    return null
  }
}
