#!/usr/bin/env node
/**
 * inject-rules —— SessionStart hook：把插件 rules/ 下的规则全量注入会话上下文。
 *
 * 用 glob 而不用登记表：登记表漏一行就是静默不加载，遍历目录无处可漏——新规则文件放进
 * rules/ 即生效。排除 README.md 与以点开头的文件（如发版脚本生成的 .fingerprint.json）。
 *
 * 除规则正文外只追加两行：
 *   (a) 线上单据索引的一行计数（路径 / 条数 / 各 Room 计数 / 多久前刷新）——正文不注入，
 *       Agent 需要时自己 grep 那个文件；索引只用来找单号和 Room，状态以线上为准。
 *   (b) 检测到 lumioagentspec 插件仍启用时的一行警告（其功能已并入 workflow 1.0.0）。
 * 读不到 settings / installed_plugins / 索引文件一律静默——这个 hook 不能因为外部文件挡住会话。
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { cacheIndexPath, readIndexFile, resolveCredentials } from './lib/workflow-config.mjs'

/** 读 <pluginRoot>/rules/*.md，按文件名排序拼接。无规则时返回空串。 */
export function buildRulesContext(pluginRoot) {
  const rulesDir = join(pluginRoot, 'rules')
  if (!existsSync(rulesDir)) return ''
  const files = readdirSync(rulesDir)
    .filter((n) => n.endsWith('.md') && n !== 'README.md' && !n.startsWith('.'))
    .sort() // 顺序稳定，同样的规则每次会话产生同样的上下文
  if (files.length === 0) return ''
  return files.map((n) => readFileSync(join(rulesDir, n), 'utf8').trim()).join('\n\n---\n\n')
}

const INDEX_HINT = '只用来找单号和 Room，状态以线上为准'

/** 索引一行：有文件就报计数，没有就说一句原因。 */
export function buildIndexLine({ env = process.env, cwd = process.cwd(), home = homedir(), now = () => Date.now() } = {}) {
  const creds = resolveCredentials({ env, cwd, home })
  if (!creds.ok) {
    const why = {
      'no-marker': '当前目录没有 .workflow 标记',
      'marker-unparseable': '.workflow 解析不出 profile',
      'config-missing': '~/.config/workflow/config.toml 不存在',
      'profile-missing': 'config.toml 里没有对应 profile',
      'profile-incomplete': 'profile 缺 base_url 或 token',
      'bad-base-url': 'base_url 不合法',
    }[creds.reason] ?? creds.reason
    return `线上单据索引未生成（${why}）。`
  }
  const path = cacheIndexPath({ env, home, host: creds.host })
  if (!existsSync(path)) return `线上单据索引未生成（尚未刷新或刷新失败；/workflow:index 可手动刷新）。`
  const doc = readIndexFile(path)
  if (!doc) return `线上单据索引未生成（${path} 损坏；/workflow:index 可重建）。`

  const perRoom = new Map()
  for (const item of Object.values(doc.items)) {
    const room = item?.room ?? '(无 Room)'
    perRoom.set(room, (perRoom.get(room) ?? 0) + 1)
  }
  const total = Object.keys(doc.items).length
  const roomText = [...perRoom.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([room, n]) => `${room} ${n}`)
    .join(' / ')
  const refreshedMs = Date.parse(doc.refreshedAt)
  const minutes = Number.isFinite(refreshedMs) ? Math.max(0, Math.floor((now() - refreshedMs) / 60_000)) : null
  const when = minutes === null ? '刷新时间未知' : `${minutes} 分钟前刷新`
  let line = `线上单据索引在 ${path}：${total} 张（${roomText || '空'}），${when}；${INDEX_HINT}。`
  if (doc.stale?.attemptedAt) {
    const staleMs = Date.parse(doc.stale.attemptedAt)
    const staleMin = Number.isFinite(staleMs) ? Math.max(0, Math.floor((now() - staleMs) / 60_000)) : null
    line += ` 离线沿用：最近一次刷新${staleMin === null ? '' : `（${staleMin} 分钟前）`}失败——${doc.stale.reason ?? '原因未知'}。`
  }
  return line
}

const LEGACY_WARNING =
  '⚠ 检测到 lumioagentspec 插件仍启用：其功能已并入 workflow 1.0.0，请卸载或禁用，否则两套规则同时在场。'

/** 是否仍启用旧插件；读不到任何文件都按「未检测到」处理。 */
export function detectLegacyPlugin({ home = homedir() } = {}) {
  try {
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))
    const enabled = settings?.enabledPlugins
    if (enabled && typeof enabled === 'object') {
      for (const [key, value] of Object.entries(enabled)) {
        if (key.startsWith('lumio@lumioagentspec') && value === true) return true
      }
    }
  } catch { /* 静默 */ }
  try {
    const installed = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))
    const plugins = installed?.plugins
    if (plugins && typeof plugins === 'object') {
      for (const key of Object.keys(plugins)) if (key.includes('lumioagentspec')) return true
    }
  } catch { /* 静默 */ }
  return false
}

/** 组装整段注入文本；rules 为空时也注入索引行与警告（它们不依赖规则文件）。 */
export function buildAdditionalContext({ pluginRoot, env = process.env, cwd = process.cwd(), home = homedir(), now } = {}) {
  const rules = buildRulesContext(pluginRoot)
  const tail = [buildIndexLine({ env, cwd, home, now })]
  if (detectLegacyPlugin({ home })) tail.push(LEGACY_WARNING)
  return (
    `<workflow-rules>\n` +
    `以下是 Workflow 插件的常驻规则，每次会话强制在场；插件根目录 ${pluginRoot}（下文出现的 agents/、skills/、tools/ 等路径均相对于它）。\n\n` +
    (rules ? `${rules}\n\n` : '') +
    `${tail.join('\n')}\n` +
    `</workflow-rules>`
  )
}

function main() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)))
  const additionalContext = buildAdditionalContext({ pluginRoot })
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
    }),
  )
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
