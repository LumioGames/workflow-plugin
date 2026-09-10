/**
 * 手动安装渠道的路径、清单与版本布局。workflow-install.mjs 的数据面。
 *
 * 两种档：skills = 只装技能 Markdown + VERSION；full = 整份 plugin/ 运行时。
 * 备份永远在 dataDir/backups/，不进技能扫描目录。
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const HOST_ADAPTER_VERSION = '1'
export const STATE_API = 1
export const MANAGED_BEGIN = '<!-- workflow-plugin:codex-entry:start -->'
export const MANAGED_END = '<!-- workflow-plugin:codex-entry:end -->'
export const REVIEWER_MANAGED_MARK = 'managed-by: workflow-plugin'
export const ALLOWED_DOWNLOAD_PREFIX = 'https://workflow.games/'
export const VERSION_URL = 'https://workflow.games/plugin/version.json'
export const SKILLS_MANIFEST_URL = 'https://workflow.games/plugin/codex/files.json'
export const RUNTIME_MANIFEST_URL = 'https://workflow.games/plugin/runtime/files.json'
export const BACKUP_DIR_RE = /\.bak-/
export const OUR_SKILL_PREFIXES = [
  'workflow-',
  'brainstorming',
  'receiving-code-review',
  'spec-steward',
  'systematic-debugging',
  'test-driven-development',
]
export const PROXY_ENV_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']

export function defaultDataDir({ env = process.env, home = homedir() } = {}) {
  const xdg = env.XDG_DATA_HOME?.trim()
  return join(xdg || join(home, '.local', 'share'), 'workflow')
}

export function defaultCodexHome({ env = process.env, home = homedir() } = {}) {
  return env.CODEX_HOME?.trim() || join(home, '.codex')
}

export function resolveLayout({
  env = process.env,
  home = homedir(),
  dataDir,
  codexHome,
  skillsTarget,
} = {}) {
  const data = resolve(dataDir || defaultDataDir({ env, home }))
  const codex = resolve(codexHome || defaultCodexHome({ env, home }))
  return {
    home: resolve(home),
    dataDir: data,
    pluginDir: join(data, 'plugin'),
    backupsDir: join(data, 'backups'),
    statePath: join(data, 'state.json'),
    stagingDir: join(data, '.staging'),
    codexHome: codex,
    skillsTarget: resolve(skillsTarget || join(codex, 'skills')),
    agentsDir: join(codex, 'agents'),
    agentsMd: join(codex, 'AGENTS.md'),
    agentsOverrideMd: join(codex, 'AGENTS.override.md'),
    reviewerToml: join(codex, 'agents', 'workflow_reviewer.toml'),
    configToml: join(home, '.config', 'workflow', 'config.toml'),
    policyToml: join(home, '.config', 'workflow', 'policy.toml'),
  }
}

export function loadRuntimeManifest(pluginRoot) {
  const path = join(pluginRoot, 'runtime-manifest.json')
  const fallback = {
    api: 1,
    hostAdapterVersion: HOST_ADAPTER_VERSION,
    excludeDirNames: ['.git', 'node_modules', 'tests', '.github', '.claude', '.DS_Store'],
    excludeFiles: ['package.json', '.gitignore'],
    textExtensions: ['.md', '.json', '.toml', '.txt'],
    textBasenames: ['LICENSE', 'VERSION'],
    executableGlobs: ['bin/*.mjs', 'bin/*.sh', 'tools/**/*.mjs', 'templates/**/*.mjs'],
    modes: {
      skills: { includes: ['skills/**'] },
      full: { includes: ['**'] },
    },
  }
  if (!existsSync(path)) return fallback
  const doc = JSON.parse(readFileSync(path, 'utf8'))
  return {
    ...fallback,
    ...doc,
    excludeDirNames: doc.excludeDirNames ?? fallback.excludeDirNames,
    excludeFiles: doc.excludeFiles ?? fallback.excludeFiles,
    textExtensions: doc.textExtensions ?? fallback.textExtensions,
    textBasenames: doc.textBasenames ?? fallback.textBasenames,
    executableGlobs: doc.executableGlobs ?? fallback.executableGlobs,
    modes: doc.modes ?? fallback.modes,
  }
}

function shouldSkip(name, excludeDirNames, excludeFiles) {
  if (name === '.' || name === '..') return true
  if (excludeDirNames.includes(name) || excludeFiles.includes(name)) return true
  if (name.startsWith('.staging') || name === 'backups') return true
  return false
}

/** glob：精确名、一层星号、双星子孙、以及 tools 下的 mjs。 */
export function matchGlob(rel, glob) {
  const g = String(glob).replace(/\\/g, '/')
  const n = String(rel).replace(/\\/g, '/')
  if (g === n) return true
  if (g.endsWith('/**')) {
    const prefix = g.slice(0, -3)
    return n === prefix || n.startsWith(`${prefix}/`)
  }
  const escaped = g
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/\*\*\//g, '§SLASHDOUBLE§')
    .replace(/\*\*/g, '§DOUBLE§')
    .replace(/\*/g, '[^/]*')
    .replace(/§SLASHDOUBLE§/g, '(?:/.*)?/')
    .replace(/§DOUBLE§/g, '.*')
  return new RegExp(`^${escaped}$`).test(n)
}

export function isSkillsTextFile(rel) {
  const base = String(rel).split('/').pop()
  return base === 'VERSION' || String(rel).endsWith('.md')
}

export function fileKind(rel, manifest) {
  const globs = manifest.executableGlobs ?? []
  if (globs.some((g) => matchGlob(rel, g))) return 'executable'
  return 'text'
}

export function isTextAllowed(rel, manifest) {
  const base = String(rel).split('/').pop()
  if ((manifest.textBasenames ?? []).includes(base)) return true
  const ext = base.includes('.') ? `.${base.split('.').pop()}` : ''
  return (manifest.textExtensions ?? ['.md', '.json', '.toml', '.txt']).includes(ext)
}

/** 列出发布面文件（相对 pluginRoot）。按 runtime-manifest 的 includes 过滤。 */
export function listRuntimeFiles(pluginRoot, { mode = 'full' } = {}) {
  pluginRoot = resolve(pluginRoot)
  const manifest = loadRuntimeManifest(pluginRoot)
  const includes = manifest.modes?.[mode]?.includes
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (shouldSkip(entry.name, manifest.excludeDirNames, manifest.excludeFiles)) continue
      const abs = join(dir, entry.name)
      const rel = relative(pluginRoot, abs).split(sep).join('/')
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) out.push(rel)
    }
  }
  if (mode === 'skills') walk(join(pluginRoot, 'skills'))
  else walk(pluginRoot)
  return out.filter((rel) => {
    if (Array.isArray(includes) && includes.length && !includes.some((g) => matchGlob(rel, g))) return false
    if (mode === 'skills') return isSkillsTextFile(rel)
    return true
  }).sort()
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function hashTree(pluginRoot, files) {
  return files.map((rel) => ({
    path: rel,
    sha256: sha256File(join(pluginRoot, rel)),
  }))
}

export function compareSemver(a, b) {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

export function isOurSkillDir(name) {
  return OUR_SKILL_PREFIXES.some((p) => (p.endsWith('-') ? name.startsWith(p) : name === p || name.startsWith(`${p}.`)))
}

export function isBackupSkillName(name) {
  return BACKUP_DIR_RE.test(name)
}

export function skillBaseName(name) {
  return name.replace(/\.bak-.*$/, '')
}

export function readVersion(pluginRoot) {
  const fromSkill = join(pluginRoot, 'skills', 'workflow-update', 'VERSION')
  if (existsSync(fromSkill)) return readFileSync(fromSkill, 'utf8').trim()
  const manifest = join(pluginRoot, 'plugin.json')
  if (existsSync(manifest)) {
    try { return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null } catch { return null }
  }
  return null
}

export function readCommit(pluginRoot) {
  const gitHead = join(pluginRoot, '.git', 'HEAD')
  const parentGit = join(pluginRoot, '..', '.git', 'HEAD')
  for (const head of [gitHead, parentGit]) {
    if (!existsSync(head)) continue
    try {
      const text = readFileSync(head, 'utf8').trim()
      if (text.startsWith('ref:')) {
        const ref = join(dirname(head), text.slice(4).trim())
        if (existsSync(ref)) return readFileSync(ref, 'utf8').trim()
      } else if (/^[0-9a-f]{7,40}$/i.test(text)) return text
    } catch { /* 源码态以外没有 git */ }
  }
  return null
}

export function readState(path) {
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'))
    if (!doc || doc.api !== STATE_API) return null
    return doc
  } catch {
    return null
  }
}

export function detectMode(pluginRoot) {
  const rules = existsSync(join(pluginRoot, 'rules', 'system.md'))
  const tools = existsSync(join(pluginRoot, 'tools', 'refresh-index.mjs'))
  const reviewer = existsSync(join(pluginRoot, 'agents', 'reviewer.md'))
  if (rules && tools && reviewer) return 'full'
  if (existsSync(join(pluginRoot, 'skills'))) return 'skills'
  return 'unknown'
}

export function requiredFullFiles() {
  return [
    'plugin.json',
    'runtime-manifest.json',
    'rules/system.md',
    'rules/dispatch.md',
    'tools/refresh-index.mjs',
    'tools/inject-rules.mjs',
    'tools/workflow-install.mjs',
    'bin/spec-lint.mjs',
    'bin/install.sh',
    'agents/reviewer.md',
    'hosts/codex/workflow_reviewer.toml',
    'skills/workflow-update/SKILL.md',
    'skills/workflow-update/VERSION',
  ]
}

/** 官网旧 files.json（技能 Markdown only）不能当完整运行时。 */
export function isSkillsOnlyManifest(filesDoc) {
  if (!filesDoc || typeof filesDoc !== 'object') return true
  if (filesDoc.mode === 'full') return false
  if (filesDoc.mode === 'skills') return true
  const paths = (Array.isArray(filesDoc.files) ? filesDoc.files : []).map((f) => String(f?.path ?? '').replace(/\\/g, '/'))
  return !paths.some((p) => (
    p === 'rules/system.md'
    || p === 'runtime-manifest.json'
    || p.startsWith('tools/')
    || p.startsWith('rules/')
  ))
}

export function hostKindFromSkillsTarget(skillsTarget) {
  const n = skillsTarget.split(sep).join('/')
  if (n.includes('/.codex/') || n.endsWith('/.codex/skills') || n.includes('/.codex/skills')) return 'codex'
  if (n.includes('/.claude/')) return 'claude'
  return 'generic'
}

export function renderAgentsFragment({ pluginRoot, skillsTarget, codexHome, dataDir }) {
  return `${MANAGED_BEGIN}
# Workflow Runtime Entry

Plugin root: \`${pluginRoot}\`. Before acting in a Workflow workspace, read:

- \`${pluginRoot}/rules/system.md\`
- \`${pluginRoot}/rules/dispatch.md\`

Skill discovery in \`${skillsTarget}\` does **not** load these rules. Also read the
project's \`.spec/AGENTS.md\` when it exists — it is not loaded by skill discovery.

If \`refresh-index.mjs\` writes \`stale\`, that is **not** a successful sync; keep
the old snapshot. For independent review use \`workflow_reviewer\`
(\`${codexHome}/agents/workflow_reviewer.toml\`). \`sandbox_mode = "read-only"\` is
a default, not an unoverridable boundary. Adapter ${HOST_ADAPTER_VERSION}.
State: \`${dataDir}/state.json\`.
${MANAGED_END}
`
}

export function patchManagedBlock(existing, fragment) {
  const text = existing ?? ''
  const begin = text.indexOf(MANAGED_BEGIN)
  const end = text.indexOf(MANAGED_END)
  if (begin !== -1 && end !== -1 && end > begin) {
    const after = end + MANAGED_END.length
    const before = text.slice(0, begin)
    const rest = text.slice(after).replace(/^\n/, '')
    return `${before}${fragment}${rest ? `\n${rest}` : rest}`.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '')
  }
  if (!text.trim()) return `${fragment}\n`
  return `${text.replace(/\s*$/, '')}\n\n${fragment}\n`
}

export function renderReviewerToml(pluginRoot, template) {
  return String(template).replaceAll('{{PLUGIN_ROOT}}', pluginRoot)
}

export function isManagedReviewerToml(text) {
  return typeof text === 'string' && text.includes(REVIEWER_MANAGED_MARK)
}

export function readLink(path) {
  try { return readlinkSync(path) } catch { return null }
}

export function isSymlinkTo(path, expectedTarget) {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false
    return resolve(dirname(path), readlinkSync(path)) === resolve(expectedTarget)
  } catch {
    return false
  }
}

export function urlAllowed(url) {
  return typeof url === 'string' && url.startsWith(ALLOWED_DOWNLOAD_PREFIX)
}

export function proxyNamesSet(env = process.env) {
  return PROXY_ENV_NAMES.filter((name) => env[name])
}

export function reviewerTemplatePath(pluginRoot) {
  const hosted = join(pluginRoot, 'hosts', 'codex', 'workflow_reviewer.toml')
  if (existsSync(hosted)) return hosted
  return join(pluginRoot, 'agents', 'workflow_reviewer.toml')
}
