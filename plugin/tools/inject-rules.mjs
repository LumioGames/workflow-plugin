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
import { cacheIndexPath, findWorkflowMarker, readIndexFile, resolveCredentials } from './lib/workflow-config.mjs'

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
/** 索引一行最多点名几个 Room；其余折成计数。常驻成本按会话计，不能随 Room 数线性涨。 */
const MAX_ROOMS = 5

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
  const path = cacheIndexPath({ env, home, creds })
  if (!existsSync(path)) return `线上单据索引未生成（尚未刷新或刷新失败；/workflow:index 可手动刷新）。`
  const doc = readIndexFile(path)
  if (!doc) return `线上单据索引未生成（${path} 损坏；/workflow:index 可重建）。`

  const perRoom = new Map()
  for (const item of Object.values(doc.items)) {
    const room = item?.room ?? '(无 Room)'
    perRoom.set(room, (perRoom.get(room) ?? 0) + 1)
  }
  const total = Object.keys(doc.items).length
  // 全部 Room 串一行没有上限:100 个 Room 实测 1410 字符、0 换行,而这是每次会话都付的常驻成本。
  // 只列最大的 MAX_ROOMS 个,其余折成一个计数;要看分组自己 grep 那个文件。
  const ranked = [...perRoom.entries()].sort(([a, na], [b, nb]) => nb - na || a.localeCompare(b))
  const shown = ranked.slice(0, MAX_ROOMS)
  const rest = ranked.length - shown.length
  const roomText =
    shown.map(([room, n]) => `${room} ${n}`).join(' / ') +
    (rest > 0 ? ` / 另 ${rest} 个 Room` : '')
  const refreshedMs = Date.parse(doc.refreshedAt)
  const minutes = Number.isFinite(refreshedMs) ? Math.max(0, Math.floor((now() - refreshedMs) / 60_000)) : null
  const when = minutes === null ? '刷新时间未知' : `${minutes} 分钟前刷新`
  let line = `线上单据索引在 ${path}：${total} 张（${roomText || '空'}），${when}；${INDEX_HINT}。`
  // env 优先于 .workflow 是既定口径(connection.md 第一节),但无人值守的 hook 必须说出它覆盖了
  // 目录绑定 —— 否则 B 目录里看到的是 A 项目的摘要,而上下文里没有任何线索。
  if (creds.source === 'env' && findWorkflowMarker(cwd)) {
    line += ` ⚠ 本目录有 .workflow 标记，但环境变量 WORKFLOW_API_BASE / WORKFLOW_TOKEN 覆盖了它——上面这份索引来自环境变量指向的 ${creds.host}，不是标记文件绑定的项目。`
  }
  if (doc.stale?.attemptedAt) {
    const staleMs = Date.parse(doc.stale.attemptedAt)
    const staleMin = Number.isFinite(staleMs) ? Math.max(0, Math.floor((now() - staleMs) / 60_000)) : null
    line += ` 离线沿用：最近一次刷新${staleMin === null ? '' : `（${staleMin} 分钟前）`}失败——${doc.stale.reason ?? '原因未知'}。`
  }
  return line
}

const LEGACY_WARNING = {
  enabled:
    '⚠ 检测到 lumioagentspec 插件仍启用：其功能已并入 workflow 1.0.0，请卸载或禁用，否则两套规则同时在场。',
  installed:
    '提示：本机装有 lumioagentspec 插件（未能确认是否启用）。其功能已并入 workflow 1.0.0——若仍启用，两套规则会同时在场。',
}

/**
 * 旧插件检测。**安装不等于启用**：settings.json 里 enabledPlugins 显式为 true 才算启用；
 * 只在 installed_plugins.json 里出现，只能说"装过",不能据此断言两套规则同时在场。
 * 返回 'enabled' | 'installed' | null；读不到任何文件都按 null 处理(这个 hook 不因外部文件挡住会话)。
 */
export function detectLegacyPlugin({ home = homedir() } = {}) {
  try {
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))
    const enabled = settings?.enabledPlugins
    if (enabled && typeof enabled === 'object') {
      for (const [key, value] of Object.entries(enabled)) {
        if (!key.startsWith('lumio@lumioagentspec')) continue
        // 显式 false 是用户已经关掉了 —— 关掉了还催卸载,就是每次会话都在误报。
        return value === true ? 'enabled' : null
      }
    }
  } catch { /* 静默 */ }
  try {
    const installed = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))
    const plugins = installed?.plugins
    if (plugins && typeof plugins === 'object') {
      for (const key of Object.keys(plugins)) if (key.includes('lumioagentspec')) return 'installed'
    }
  } catch { /* 静默 */ }
  return null
}

/**
 * 组装整段注入文本；rules 为空时也注入索引行与警告（它们不依赖规则文件）。
 *
 * **失败域是分开的**：索引与旧插件检测都是便利功能，它们各自捕获异常——一个坏掉的缓存文件
 * 绝不能让整次注入抛错退出，那等于两份硬红线一起无声消失。规则读取失败则必须说出来，
 * 因为规则缺席本身就是要上报的事实，不能静默降级成"这次没有规则"。
 */
export function buildAdditionalContext({ pluginRoot, env = process.env, cwd = process.cwd(), home = homedir(), now } = {}) {
  let rules = ''
  let rulesError = null
  try {
    rules = buildRulesContext(pluginRoot)
  } catch (e) {
    rulesError = `⚠ 规则文件读取失败（${e?.message ?? e}）——本次会话没有常驻规则，请修复后重开会话。`
  }

  const tail = []
  try {
    tail.push(buildIndexLine({ env, cwd, home, now }))
  } catch (e) {
    tail.push(`线上单据索引读取失败（${e?.message ?? e}）——不影响上面的规则；/workflow:index 可重建。`)
  }
  try {
    const legacy = detectLegacyPlugin({ home })
    if (legacy) tail.push(LEGACY_WARNING[legacy])
  } catch { /* 静默：检测不到就不提 */ }

  if (rulesError) tail.unshift(rulesError)
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
  // 最后一道:上面每个部件都各自兜过异常了,这层只防"没想到的那个"。
  // 宁可注入一行故障说明,也不要 exit 1 —— 那会让规则整段缺席而且没人看得见原因。
  let additionalContext
  try {
    additionalContext = buildAdditionalContext({ pluginRoot })
  } catch (e) {
    additionalContext =
      `<workflow-rules>\n⚠ Workflow 插件规则注入失败（${e?.message ?? e}）——本次会话没有常驻规则。\n</workflow-rules>`
  }
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
