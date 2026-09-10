#!/usr/bin/env node
/**
 * workflow-install —— 手动安装渠道的完整运行时安装 / 升级 / 回滚 / --doctor。
 *
 * 用法:
 *   node tools/workflow-install.mjs [--from-dir <plugin 根>] [--mode full|skills]
 *   node tools/workflow-install.mjs --doctor [--json] [--project <dir>]
 *   node tools/workflow-install.mjs --rollback [--id <备份 id>]
 *
 * 默认 --mode full。可执行文件只接受 runtime-manifest.json 的 executableGlobs，且必须 sha256 一致。
 * 备份落在 $XDG_DATA_HOME/workflow/backups/，不在技能扫描目录改名。
 * 不碰凭证、用户 hooks、项目策略、未完成草稿。
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk, mdLinks } from './spec-lint/lib.mjs'
import {
  ALLOWED_DOWNLOAD_PREFIX,
  HOST_ADAPTER_VERSION,
  STATE_API,
  VERSION_URL,
  compareSemver,
  detectMode,
  fileKind,
  hashTree,
  hostKindFromSkillsTarget,
  isBackupSkillName,
  isManagedReviewerToml,
  isOurSkillDir,
  isSkillsOnlyManifest,
  isSkillsTextFile,
  isSymlinkTo,
  isTextAllowed,
  listPluginRuleFiles,
  listRuntimeFiles,
  loadRuntimeManifest,
  matchGlob,
  patchManagedBlock,
  readCommit,
  readState,
  readVersion,
  renderAgentsFragment,
  renderReviewerToml,
  requiredFullFiles,
  resolveLayout,
  reviewerTemplatePath,
  sha256File,
  skillBaseName,
  urlAllowed,
} from './lib/runtime-layout.mjs'

export {
  resolveLayout,
  compareSemver,
  HOST_ADAPTER_VERSION,
  isSkillsOnlyManifest,
}

const SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_BOUNDARY = '技能渠道：只装了 Markdown 与 VERSION。规则、工具、模板、reviewer 都不会就位。完整运行时请用 --mode full（需运行时清单，不是官网旧 files.json）。'

class InstallError extends Error {}
export { InstallError }

function fail(message) {
  throw new InstallError(message)
}

function nowStamp(now = () => new Date()) {
  return now().toISOString().replace(/[:.]/g, '-').replace(/T/, 'T').slice(0, 19)
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}

function rmrf(path) {
  rmSync(path, { recursive: true, force: true })
}

function copyTreeFile(src, dest) {
  ensureDir(dirname(dest))
  copyFileSync(src, dest)
}

function listDirs(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
}

function assertSafeRel(rel) {
  if (!rel || rel.startsWith('/') || rel.includes('..') || rel.split(sep).includes('..')) {
    fail(`清单路径非法：${rel}`)
  }
}

function writeJson(path, value) {
  ensureDir(dirname(path))
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function copyDirContents(src, dest) {
  if (!existsSync(src)) return
  ensureDir(dest)
  for (const name of readdirSync(src)) {
    const from = join(src, name)
    const to = join(dest, name)
    const st = lstatSync(from)
    if (st.isDirectory()) copyDirContents(from, to)
    else if (st.isSymbolicLink()) continue
    else copyTreeFile(from, to)
  }
}

function moveDir(from, to, renameFn = renameSync) {
  ensureDir(dirname(to))
  try {
    renameFn(from, to)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    copyDirContents(from, to)
    rmrf(from)
  }
}

function backupId({ version, now }) {
  return `${version || 'unknown'}-${nowStamp(now)}`
}

function assertFilesAllowed(files, manifest, mode) {
  for (const rel of files) {
    assertSafeRel(rel)
    if (mode === 'skills') {
      if (!isSkillsTextFile(rel)) fail(`技能渠道不允许：${rel}（只装 .md 与 VERSION）`)
      continue
    }
    if (fileKind(rel, manifest) === 'executable') continue
    if (!isTextAllowed(rel, manifest)) fail(`非文本且未声明为可执行：${rel}`)
  }
}

function normalizeManifestPath(path, filesDoc) {
  const rel = String(path).replace(/\\/g, '/')
  if (!isSkillsOnlyManifest(filesDoc) || rel.startsWith('skills/')) return rel
  return `skills/${rel}`
}

function writeCodexAdapter(layout, pluginRoot) {
  const fragment = renderAgentsFragment({
    pluginRoot,
    skillsTarget: layout.skillsTarget,
    codexHome: layout.codexHome,
    dataDir: layout.dataDir,
  })
  const existing = existsSync(layout.agentsMd) ? readFileSync(layout.agentsMd, 'utf8') : ''
  ensureDir(dirname(layout.agentsMd))
  writeFileSync(layout.agentsMd, patchManagedBlock(existing, fragment))

  ensureDir(layout.agentsDir)
  const templatePath = reviewerTemplatePath(pluginRoot)
  if (!existsSync(templatePath)) return { reviewerSkipped: true }
  const rendered = renderReviewerToml(pluginRoot, readFileSync(templatePath, 'utf8'))
  if (existsSync(layout.reviewerToml)) {
    const current = readFileSync(layout.reviewerToml, 'utf8')
    if (!isManagedReviewerToml(current)) return { reviewerSkipped: true }
  }
  writeFileSync(layout.reviewerToml, rendered)
  return { reviewerSkipped: false }
}

/** 已是指向 target 的受管 symlink 则保留；用户自有普通文件不覆盖；其余（错链 / 目录）换成 symlink。 */
function linkManaged(dest, target) {
  if (existsSync(dest)) {
    if (isSymlinkTo(dest, target)) return 'kept'
    const st = lstatSync(dest)
    if (!st.isSymbolicLink() && !st.isDirectory()) return 'skipped'
    rmrf(dest)
  }
  ensureDir(dirname(dest))
  symlinkSync(target, dest)
  return 'linked'
}

function linkSkills(pluginRoot, skillsTarget) {
  const srcSkills = join(pluginRoot, 'skills')
  if (!existsSync(srcSkills)) fail('源里没有 skills/')
  ensureDir(skillsTarget)
  const installed = []
  for (const name of listDirs(srcSkills)) {
    if (!isOurSkillDir(name)) continue
    const dest = join(skillsTarget, name)
    const target = join(srcSkills, name)
    if (linkManaged(dest, target) === 'skipped') continue
    installed.push(name)
  }
  return installed
}

function ruleLinkDirs(layout) {
  const dirs = []
  const seen = new Set()
  const fallback = layout.home ? join(layout.home, '.agents', 'rules') : null
  for (const dir of [layout.rulesTarget || fallback, layout.projectRulesTarget]) {
    if (!dir) continue
    const key = resolve(dir)
    if (seen.has(key)) continue
    seen.add(key)
    dirs.push(dir)
  }
  return dirs
}

function linkRules(pluginRoot, rulesTarget) {
  const names = listPluginRuleFiles(pluginRoot)
  if (!names.length) return []
  ensureDir(rulesTarget)
  const installed = []
  for (const name of names) {
    const dest = join(rulesTarget, name)
    const target = join(pluginRoot, 'rules', name)
    if (linkManaged(dest, target) === 'skipped') continue
    installed.push(name)
  }
  return installed
}

function linkRuleTargets(pluginRoot, layout) {
  const installed = []
  for (const dir of ruleLinkDirs(layout)) {
    for (const name of linkRules(pluginRoot, dir)) {
      installed.push({ dir, name })
    }
  }
  return installed
}

export function migrateDiscoveryBackups(layout, { now } = {}) {
  const moved = []
  if (!existsSync(layout.skillsTarget)) return { moved }
  const stamp = nowStamp(now)
  for (const name of listDirs(layout.skillsTarget)) {
    if (!isBackupSkillName(name)) continue
    const destRoot = join(layout.backupsDir, `migrated-${stamp}`)
    const dest = join(destRoot, name)
    ensureDir(destRoot)
    renameSync(join(layout.skillsTarget, name), dest)
    moved.push({ from: name, to: dest })
  }
  return { moved }
}

export function applyFromSource({
  source,
  layout,
  mode = 'full',
  channel = 'local',
  commit = null,
  now = () => new Date(),
  rename = renameSync,
  expectedHashes = null,
} = {}) {
  source = resolve(source)
  if (!existsSync(join(source, 'skills'))) fail(`源不是插件根（缺 skills/）：${source}`)
  if (mode === 'full') {
    for (const rel of requiredFullFiles()) {
      if (!existsSync(join(source, rel))) fail(`完整运行时缺 ${rel}。官网若仍只发技能包，这是渠道缺口，不得标已完整安装。`)
    }
  }

  const manifest = loadRuntimeManifest(source)
  const files = listRuntimeFiles(source, { mode })
  assertFilesAllowed(files, manifest, mode)
  if (expectedHashes) {
    for (const rel of files) {
      const want = expectedHashes[rel]
      if (want && sha256File(join(source, rel)) !== want) fail(`sha256 校验不符：${rel}`)
    }
  }
  const hashes = hashTree(source, files)
  const version = readVersion(source)

  rmrf(layout.stagingDir)
  const staging = join(layout.stagingDir, `apply-${process.pid}`)
  rmrf(staging)
  for (const rel of files) {
    copyTreeFile(join(source, rel), join(staging, rel))
  }

  ensureDir(dirname(layout.pluginDir))
  ensureDir(layout.backupsDir)
  const previous = existsSync(layout.pluginDir) ? join(layout.backupsDir, backupId({ version: readVersion(layout.pluginDir), now })) : null
  if (previous) moveDir(layout.pluginDir, previous, rename)
  try {
    moveDir(staging, layout.pluginDir, rename)
  } catch (error) {
    if (previous && existsSync(previous)) {
      rmrf(layout.pluginDir)
      moveDir(previous, layout.pluginDir, renameSync)
    }
    rmrf(layout.stagingDir)
    throw error
  }
  rmrf(layout.stagingDir)

  const installedSkills = linkSkills(layout.pluginDir, layout.skillsTarget)
  const installedRules = mode === 'full' ? linkRuleTargets(layout.pluginDir, layout) : []
  const { moved } = migrateDiscoveryBackups(layout, { now })
  let adapter = { reviewerSkipped: true }
  if (mode === 'full' && hostKindFromSkillsTarget(layout.skillsTarget) === 'codex') {
    adapter = writeCodexAdapter(layout, layout.pluginDir)
  }

  const state = {
    api: STATE_API,
    channel,
    mode,
    version,
    commit: commit ?? readCommit(source),
    hostAdapterVersion: HOST_ADAPTER_VERSION,
    installedAt: now().toISOString(),
    pluginDir: layout.pluginDir,
    skillsTarget: layout.skillsTarget,
    rulesTarget: layout.rulesTarget || (layout.home ? join(layout.home, '.agents', 'rules') : null),
    files: hashes,
    backupId: previous ? previous.split(/[\\/]/).pop() : null,
    reviewerSkipped: adapter.reviewerSkipped,
  }
  writeJson(layout.statePath, state)
  return { ...state, installedSkills, installedRules, backup: previous ? { id: state.backupId, dir: previous } : null, migratedBackups: moved }
}

export async function stageFromManifest({
  manifest,
  dest,
  fetchImpl = globalThis.fetch,
  cacheBust = Date.now(),
} = {}) {
  if (!urlAllowed(manifest.baseUrl)) fail(`清单 baseUrl 不在 ${ALLOWED_DOWNLOAD_PREFIX}：${manifest.baseUrl}`)
  const runtimeManifest = manifest.runtimeManifest ?? loadRuntimeManifest(SELF_ROOT)
  rmrf(dest)
  ensureDir(dest)
  try {
    for (const entry of manifest.files ?? []) {
      const rel = normalizeManifestPath(entry.path, manifest)
      assertSafeRel(rel)
      const kind = entry.kind || (fileKind(rel, runtimeManifest))
      if (kind === 'executable') {
        const globs = runtimeManifest.executableGlobs ?? []
        if (!globs.some((g) => matchGlob(rel, g))) fail(`可执行文件不在清单允许的 glob 内：${rel}`)
      } else if (!isTextAllowed(rel, runtimeManifest) && !isSkillsTextFile(rel)) {
        fail(`非文本且未声明为可执行：${rel}`)
      }
      const url = `${String(manifest.baseUrl).replace(/\/$/, '')}/${entry.path}?cb=${cacheBust}`
      if (!urlAllowed(url)) fail(`下载地址不在允许域：${url}`)
      const response = await fetchImpl(url)
      if (!response.ok) fail(`下载失败 HTTP ${response.status}：${rel}`)
      const buf = Buffer.from(await response.arrayBuffer())
      const actual = createHash('sha256').update(buf).digest('hex')
      if (actual !== entry.sha256) fail(`sha256 校验不符：${rel}`)
      const out = join(dest, rel)
      ensureDir(dirname(out))
      writeFileSync(out, buf)
      if (kind === 'executable' && out.endsWith('.sh')) chmodSync(out, 0o755)
    }
  } catch (error) {
    rmrf(dest)
    throw error
  }
  return dest
}

export function assertFullRuntimeAvailable(filesDoc) {
  if (isSkillsOnlyManifest(filesDoc)) {
    fail('完整运行时清单不可用：当前 files.json 仍是技能包（只有 Markdown + VERSION），缺 rules/tools/reviewer。不得标已完整安装。请用 --from-dir 指向本仓 plugin/，或等待官网发布 full 包；--mode skills 仍可只装技能。')
  }
}

export async function fetchOnline({
  fetchImpl = globalThis.fetch,
  mode = 'full',
  cacheBust = Date.now(),
} = {}) {
  const versionUrl = `${VERSION_URL}?cb=${cacheBust}`
  if (!urlAllowed(versionUrl)) fail(`清单地址不在允许域：${versionUrl}`)
  const versionRes = await fetchImpl(versionUrl)
  if (!versionRes.ok) fail(`下载 version.json 失败 HTTP ${versionRes.status}`)
  const versionDoc = await versionRes.json()
  const filesField = mode === 'full'
    ? (versionDoc.runtimeFiles || versionDoc.files)
    : (versionDoc.skillsFiles || versionDoc.files)
  let filesUrl = filesField
  if (typeof filesUrl === 'string' && filesUrl.startsWith('/')) filesUrl = `https://workflow.games${filesUrl}`
  if (!urlAllowed(filesUrl)) fail(`文件清单地址不在允许域：${filesUrl}`)
  const filesRes = await fetchImpl(`${filesUrl}${filesUrl.includes('?') ? '&' : '?'}cb=${cacheBust}`)
  if (!filesRes.ok) {
    if (mode === 'full') fail(`完整运行时清单不可用 HTTP ${filesRes.status}（官网若仍只发技能包，这是渠道缺口，不是把 skills 当 full）`)
    fail(`下载文件清单失败 HTTP ${filesRes.status}`)
  }
  const filesDoc = await filesRes.json()
  if (mode === 'full') assertFullRuntimeAvailable(filesDoc)
  return { versionDoc, filesDoc, filesUrl }
}

function brokenLinks(pluginRoot) {
  const broken = []
  for (const dir of ['rules', 'agents', 'commands', 'templates', 'skills', 'references', 'hosts']) {
    for (const file of walk(join(pluginRoot, dir), (p) => p.endsWith('.md'))) {
      for (const link of mdLinks(file)) {
        const target = resolve(dirname(file), link)
        if (!existsSync(target)) broken.push({ file: relative(pluginRoot, file), link })
      }
    }
  }
  return broken
}

function duplicateSkills(skillsTarget) {
  const groups = new Map()
  for (const name of listDirs(skillsTarget)) {
    if (!isOurSkillDir(name) && !isBackupSkillName(name)) continue
    const base = skillBaseName(name)
    if (!groups.has(base)) groups.set(base, [])
    groups.get(base).push(name)
  }
  return [...groups.entries()].filter(([, names]) => names.length > 1)
}

export function doctor({ layout, projectRoot = null, marketplaceVersion = null } = {}) {
  const findings = []
  const note = (id, level, message, { kind = 'plugin', fix = null } = {}) => {
    findings.push({ id, level, kind, message, fix })
  }
  const pluginRoot = existsSync(layout.pluginDir) ? layout.pluginDir : null
  const state = readState(layout.statePath)
  const mode = pluginRoot ? detectMode(pluginRoot) : (existsSync(layout.skillsTarget) ? 'skills' : 'absent')

  if (!pluginRoot) {
    note('runtime-missing', 'error', `完整运行时不在 ${layout.pluginDir}。技能若已装，仍缺 rules/tools/agents。`, {
      fix: 'node tools/workflow-install.mjs --from-dir <plugin 根> --mode full',
    })
  } else {
    const missing = requiredFullFiles().filter((rel) => !existsSync(join(pluginRoot, rel)))
    if (mode === 'skills' || missing.length) {
      note('skills-only', mode === 'skills' ? 'error' : 'error', `当前是 skills-only，不是完整运行时。缺：${missing.join(', ') || '规则/工具/reviewer'}`, {
        fix: 'node tools/workflow-install.mjs --from-dir <plugin 根> --mode full',
      })
    }
    for (const { file, link } of brokenLinks(pluginRoot)) {
      note('broken-link', 'error', `${file} → ${link}`, { fix: '补齐被引用文件或改链接' })
    }
  }

  const dups = duplicateSkills(layout.skillsTarget)
  for (const [base, names] of dups) {
    const backups = names.filter(isBackupSkillName)
    note('duplicate-skill', 'error', `技能 ${base} 在扫描目录出现多次：${names.join(', ')}`, {
      fix: backups.length
        ? 'node tools/workflow-install.mjs --from-dir <plugin 根>（会把 .bak-* 迁出扫描目录）'
        : '留下一份，其余移出 ~/.codex/skills',
    })
  }
  for (const name of listDirs(layout.skillsTarget).filter(isBackupSkillName)) {
    if (dups.some(([, names]) => names.includes(name))) continue
    note('backup-in-scan', 'warn', `备份目录仍在技能扫描路径：${name}`, {
      fix: '重跑安装器，备份会迁到 $XDG_DATA_HOME/workflow/backups/',
    })
  }

  const localVersion = pluginRoot ? readVersion(pluginRoot) : null
  if (state?.version && localVersion && state.version !== localVersion) {
    note('state-drift', 'warn', `state.json 版本 ${state.version} 与运行时 ${localVersion} 不一致`)
  }
  if (marketplaceVersion && localVersion && compareSemver(marketplaceVersion, localVersion) !== 0) {
    note('channel-skew', 'info', `官网/本地 ${localVersion}，marketplace 对照 ${marketplaceVersion}——两条渠道可以脱节，不要混装或反向降级`, {
      kind: 'channel',
    })
  }

  const fragmentPresent = existsSync(layout.agentsMd)
    && readFileSync(layout.agentsMd, 'utf8').includes('workflow-plugin:codex-entry:start')
  if (mode === 'full' && !fragmentPresent) {
    note('codex-entry-missing', 'error', `${layout.agentsMd} 没有插件管理的规则入口。技能发现不会加载 rules/。`, {
      fix: '重跑 --mode full（只改管理块，保留用户正文）',
    })
  }
  if (existsSync(layout.agentsOverrideMd)) {
    note('agents-override', 'warn', `${layout.agentsOverrideMd} 存在；安装器不改 override。Codex 可能优先读它，入口哨兵块不一定生效。`, {
      kind: 'user',
    })
  }

  const tomlExists = existsSync(layout.reviewerToml)
  if (mode === 'full' && !tomlExists) {
    note('reviewer-undiscoverable', 'error', `Codex 发现不了 ${layout.reviewerToml}`, {
      fix: '重跑 --mode full',
    })
  } else if (tomlExists && !isManagedReviewerToml(readFileSync(layout.reviewerToml, 'utf8'))) {
    note('reviewer-user-owned', 'warn', `${layout.reviewerToml} 不是插件管理的文件，安装器未覆盖`, {
      kind: 'user',
    })
  }

  if (projectRoot) {
    const ext = join(projectRoot, '.spec', 'tools', 'lint-extensions.mjs')
    if (existsSync(ext)) {
      const text = readFileSync(ext, 'utf8')
      const api = /export\s+const\s+api\s*=\s*(\d+)/.exec(text)
      if (!api || api[1] !== '1') {
        note('lint-extension-api', 'error', `项目 ${relative(projectRoot, ext) || ext} 的 api 不是 1（现为 ${api?.[1] ?? '无'}）。这是项目迁移问题，不是插件缺陷。`, {
          kind: 'project',
          fix: '把扩展改成 export const api = 1，或暂时移走该文件；不要改 Accepted ADR / 历史计划',
        })
      }
    }
  }

  note('preserve-user', 'info', '诊断只打印：缺资源、断链、同名技能、入口/reviewer 缺失、lint 扩展 api≠1。不删除历史计划、不改写 Accepted ADR、不碰凭证与 hooks。', { kind: 'policy' })

  const errors = findings.filter((f) => f.level === 'error').length
  return {
    ok: errors === 0,
    mode,
    version: localVersion,
    hostAdapterVersion: HOST_ADAPTER_VERSION,
    pluginDir: pluginRoot,
    skillsTarget: layout.skillsTarget,
    state,
    findings,
  }
}

export function rollback(layout, { id } = {}) {
  const backups = existsSync(layout.backupsDir)
    ? readdirSync(layout.backupsDir).filter((n) => existsSync(join(layout.backupsDir, n, 'plugin.json')) || existsSync(join(layout.backupsDir, n, 'skills'))).sort()
    : []
  const targetId = id && id !== 'latest' ? id : backups.at(-1)
  if (!targetId) fail('没有可回滚的备份')
  const dir = join(layout.backupsDir, targetId)
  const currentId = backupId({ version: readVersion(layout.pluginDir), now: () => new Date() })
  if (existsSync(layout.pluginDir)) moveDir(layout.pluginDir, join(layout.backupsDir, `pre-rollback-${currentId}`))
  moveDir(dir, layout.pluginDir)
  linkSkills(layout.pluginDir, layout.skillsTarget)
  const mode = detectMode(layout.pluginDir)
  if (mode === 'full') linkRuleTargets(layout.pluginDir, layout)
  if (mode === 'full' && hostKindFromSkillsTarget(layout.skillsTarget) === 'codex') {
    writeCodexAdapter(layout, layout.pluginDir)
  }
  return { id: targetId, version: readVersion(layout.pluginDir) }
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (key === 'doctor' || key === 'rollback' || key === 'json' || key === 'help') {
        args[key] = true
        continue
      }
      if (next && !next.startsWith('--')) { args[key] = next; i += 1 }
      else args[key] = true
    } else args._.push(a)
  }
  return args
}

function layoutFromArgs(args, env = process.env) {
  return resolveLayout({
    env,
    home: args.home || env.HOME || homedir(),
    dataDir: args['data-dir'],
    codexHome: args['codex-home'],
    skillsTarget: args.target || args['skills-target'],
    rulesTarget: args['rules-target'],
    projectRoot: args.project,
  })
}

export async function runInstall(argv = process.argv.slice(2), {
  env = process.env,
  stdout = console.log,
  stderr = console.error,
  fetchImpl = globalThis.fetch,
} = {}) {
  const args = parseArgs(argv)
  if (args.help) {
    stdout('用法: workflow-install.mjs [--from-dir <plugin 根>] [--mode full|skills] [--doctor] [--rollback]')
    return { ok: true }
  }
  const layout = layoutFromArgs(args, env)
  const mode = args.mode === 'skills' ? 'skills' : 'full'
  try {
    if (args.doctor) {
      const report = doctor({ layout, projectRoot: args.project || null })
      if (args.json) stdout(JSON.stringify(report, null, 2))
      else {
        stdout(`doctor: ${report.ok ? 'OK' : '有问题'}  mode=${report.mode} version=${report.version ?? '-'}`)
        for (const f of report.findings) {
          if (f.id === 'preserve-user') continue
          stdout(`  [${f.level}] (${f.kind}) ${f.message}${f.fix ? `  → ${f.fix}` : ''}`)
        }
      }
      return { ok: report.ok, report, exitCode: report.ok ? 0 : 1 }
    }
    if (args.rollback) {
      const result = rollback(layout, { id: args.id })
      stdout(`已回滚到 ${result.id}（${result.version ?? '未知版本'}）`)
      return { ok: true, result }
    }

    let source = args['from-dir'] || args.source
    let channel = args.channel || (source ? 'local' : 'website')
    let commit = null
    let cleanup = null
    if (!source) {
      const { versionDoc, filesDoc } = await fetchOnline({ fetchImpl, mode })
      const dest = mkdtempSync(join(tmpdir(), 'workflow-install-'))
      cleanup = dest
      await stageFromManifest({ manifest: filesDoc, dest, fetchImpl })
      source = dest
      commit = versionDoc.commit ?? null
      channel = 'website'
    }
    try {
      const result = applyFromSource({
        source,
        layout,
        mode,
        channel,
        commit,
      })
      stdout(`已安装 ${result.mode} ${result.version} → ${result.pluginDir}`)
      if (result.backup) stdout(`备份 ${result.backup.id}（不在技能扫描目录）`)
      if (mode === 'skills') stdout(SKILLS_BOUNDARY)
      return { ok: true, result }
    } finally {
      if (cleanup) rmrf(cleanup)
    }
  } catch (error) {
    const message = error instanceof InstallError ? error.message : (error?.message ?? error)
    stderr(`workflow-install: ${message}`)
    return { ok: false, error, exitCode: 1 }
  }
}

async function main(argv = process.argv.slice(2)) {
  const result = await runInstall(argv)
  if (result.exitCode) process.exitCode = result.exitCode
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
