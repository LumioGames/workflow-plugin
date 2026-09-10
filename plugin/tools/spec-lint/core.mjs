/**
 * spec-lint core —— 项目 `.spec/` 结构体检的运行器。定位是「改完 .spec/ 后一秒钟的结构体检」,
 * 抓「不报错但规则悄悄失效」的坑;**只报告不阻断**:退出码默认恒 0,`--strict` 时有错误才 1。
 *
 * 顺序:通用项(checks/index.mjs 固定顺序)→ 项目扩展(.spec/tools/lint-extensions.mjs)→ 指纹检查,一份报告。
 *
 * 通用项清单(本注释是「通用 lint 能力清单」的单一权威;各项细节见 checks/ 内对应文件头注释):
 *   core-files          仓根 CLAUDE.md 或 AGENTS.md、.spec/AGENTS.md、.spec/knowledge/README.md 存在(缺失可读报错)
 *   frontmatter         config.frontmatterDirs 下文档的 name / description / metadata.type / metadata.status;
 *                       status ∈ config.statusEnum;description ≤ 120 字单行
 *   nav-coverage        features / standards / knowledge 根 .md 须被 knowledge/README.md 链接
 *   adr-index           decisions/ 每条 ADR 须登记进 decisions/README.md
 *   links               .spec 下与仓根 README / AGENTS 的相对链接可达(剥围栏与行内代码;指向仓外跳过)
 *   imports             有 CLAUDE.md 时,.spec/AGENTS.md、knowledge/README.md、rules/*.md 各有一行 @import(只查项目里存在的)
 *   agents-frontmatter  .spec/agents:name + description + disallowedTools,name 与文件名一致
 *   skills-frontmatter  .spec/skills:只 name + description,name 与目录名一致
 *   symlinks            .claude/agents、.claude/skills、.agents/skills 是软链时须解析进 .spec/
 *   adr-unique-id       同目录 ADR-NNN 只能一个
 *   adr-status          ADR 前 12 行有状态行,取值 ∈ config.adrStatusEnum(或「被 [x](y) 取代」)
 *   doc-roots           禁 docs/specs、docs/plans、.sdd/ 与第二个 .spec/(不再禁 .workflow-drafts/)
 *   fingerprint         (最后,永不 disable)项目 AGENTS.md / rules/ 出现插件保留标题或连续 ≥ 3 行命中指纹
 *
 * 扩展契约(api = 1):项目文件 .spec/tools/lint-extensions.mjs 导出
 *   api      必须 === 1,否则报错且扩展不加载(不 fail-open)
 *   config   { frontmatterDirs, adrStatusEnum, statusEnum, disable: [check-id] }(每项可省;给出即整体替换默认值)
 *   checks   [{ id, run(ctx) }],run 可 async,可返回 { skipped: '原因' };id 不得与通用项重名
 *   ctx = { root, spec, config, walk, parseFrontmatter, mdLinks, gitLsFiles, report(file, msg, level) }
 *          level ∈ error(默认)/ warn / info;只有 error 计入 --strict 的退出码
 *
 * 指纹文件在插件根 rules/.fingerprint.json(相对本文件定位,发版脚本 npm run fingerprint 生成);
 * 不存在则本项标记跳过——项目侧不会因插件未发指纹而报错。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { walk, parseFrontmatter, mdLinks, gitLsFiles } from './lib.mjs'
import { CORE_CHECKS } from './checks/index.mjs'
import { loadFingerprint, scanText } from '../fingerprint.mjs'

export const LINT_API = 1
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DEFAULT_FINGERPRINT = join(PLUGIN_ROOT, 'rules', '.fingerprint.json')
export const EXTENSION_REL = '.spec/tools/lint-extensions.mjs'
export const DEFAULT_CONFIG = Object.freeze({
  frontmatterDirs: ['knowledge/features', 'knowledge/standards', 'plans', 'reviews'],
  statusEnum: ['设计中', '实施中', '已交付', '历史归档'],
  adrStatusEnum: ['Historical', 'Draft', 'Accepted', 'Reserved', 'Superseded', '生效', '废止'],
  disable: [],
})
const LEVELS = new Set(['error', 'warn', 'info'])
const CONFIG_KEYS = new Set(Object.keys(DEFAULT_CONFIG))

/**
 * 指纹检查:项目 .spec/AGENTS.md、.spec/rules/*.md 与仓根 CLAUDE.md / AGENTS.md。
 * **CLAUDE.md 必须扫**:它才是 Claude Code 的实际生效入口(见 checks/imports.mjs)。
 * 只扫 AGENTS.md 时,把整段插件规则原样抄进 CLAUDE.md 是零命中的——检查面漏了真正的入口。
 */
const fingerprintCheck = {
  id: 'fingerprint',
  title: '项目抄插件(保留标题 / 连续命中)',
  run({ root, spec, walk: walkFn, report, fingerprintPath }) {
    if (fingerprintPath === null) return { skipped: '已按参数关闭' }
    let fp
    try { fp = loadFingerprint(fingerprintPath) } catch (e) {
      report(fingerprintPath, `指纹文件不可用:${e.message}`)
      return
    }
    if (!fp) return { skipped: `插件未提供指纹文件(${fingerprintPath})` }
    const files = [
      join(spec, 'AGENTS.md'),
      ...walkFn(join(spec, 'rules'), (p) => p.endsWith('.md')),
      join(root, 'AGENTS.md'),
      join(root, 'CLAUDE.md'),
    ].filter(existsSync)
    for (const file of files) {
      const { headings, runs } = scanText(readFileSync(file, 'utf8'), fp)
      for (const { line, heading } of headings) {
        report(`${relative(root, file)}:${line}`, `项目抄了插件保留段:标题「${heading}」是插件规则的节名,项目文件只写项目专属内容`)
      }
      for (const { start, end, count, source } of runs) {
        report(`${relative(root, file)}:${start}-${end}`, `连续 ${count} 行与插件规则逐字相同(始于插件 ${source})——项目不抄插件任何一段`)
      }
    }
    return { scanned: files.length }
  },
}

function validateConfig(raw, report, file) {
  const out = { ...DEFAULT_CONFIG }
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw)) {
    if (!CONFIG_KEYS.has(key)) { report(file, `config 含未知键「${key}」(可用:${[...CONFIG_KEYS].join(' / ')})`, 'warn'); continue }
    if (value === undefined) continue
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      report(file, `config.${key} 必须是字符串数组,已忽略`)
      continue
    }
    out[key] = [...value]
  }
  return out
}

async function loadExtension({ root, spec, extensions, report }) {
  const result = { path: EXTENSION_REL, status: 'absent', api: null, config: {}, checks: [] }
  if (extensions === false || extensions === null) { result.status = 'off'; return result }
  let mod
  if (extensions && typeof extensions === 'object') {
    mod = extensions
    result.path = '(inline)'
  } else {
    const path = typeof extensions === 'string' ? resolve(root, extensions) : join(spec, 'tools', 'lint-extensions.mjs')
    result.path = relative(root, path) || path
    if (!existsSync(path)) return result
    try {
      mod = await import(`${pathToFileURL(path).href}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`)
    } catch (e) {
      report(path, `扩展加载失败:${e.message}`)
      result.status = 'failed'
      return result
    }
  }
  if (mod.api !== LINT_API) {
    result.status = 'rejected'
    result.api = mod.api ?? null
    report(result.path, `扩展 api=${JSON.stringify(mod.api ?? null)} 与 core 支持的 api=${LINT_API} 不匹配——扩展未加载(不 fail-open,按默认配置继续)`)
    return result
  }
  result.status = 'loaded'
  result.api = mod.api
  result.config = mod.config
  const coreIds = new Set([...CORE_CHECKS.map((c) => c.id), fingerprintCheck.id])
  const seen = new Set()
  for (const check of Array.isArray(mod.checks) ? mod.checks : []) {
    if (!check || typeof check.id !== 'string' || !check.id || typeof check.run !== 'function') {
      report(result.path, '扩展 checks 的每一项必须是 { id: string, run(ctx) }')
      continue
    }
    if (coreIds.has(check.id) || seen.has(check.id)) {
      report(result.path, `扩展 check id「${check.id}」与通用项或其它扩展项重名,已忽略`)
      continue
    }
    seen.add(check.id)
    result.checks.push(check)
  }
  return result
}

/**
 * @param {{ root?: string, extensions?: string|object|null|false, strict?: boolean, fingerprint?: string|null }} options
 *   extensions:省略 = 读 .spec/tools/lint-extensions.mjs;字符串 = 指定路径;对象 = 直接当模块;null/false = 不加载
 *   fingerprint:省略 = 插件根 rules/.fingerprint.json;字符串 = 指定路径;null = 关闭指纹检查
 * @returns {Promise<LintResult>} { root, ok, exitCode, errors, warnings, checks, findings, extension, fingerprint }
 */
export async function runSpecLint({ root = process.cwd(), extensions, strict = false, fingerprint } = {}) {
  root = resolve(root)
  const spec = join(root, '.spec')
  const findings = []
  const checks = []
  const rel = (file) => (isAbsolute(file) ? relative(root, file) || '.' : file)
  // 仓外路径(插件根的指纹文件)显示绝对路径,仓内才显示相对路径。
  const displayPath = (file) => (file.startsWith(root + sep) ? relative(root, file) : file)
  const reporterFor = (checkId) => (file, message, level = 'error') => {
    findings.push({ check: checkId, file: rel(String(file)), message: String(message), level: LEVELS.has(level) ? level : 'error' })
  }
  const fingerprintPath = fingerprint === null ? null : fingerprint ? resolve(root, fingerprint) : DEFAULT_FINGERPRINT

  const extension = await loadExtension({ root, spec, extensions, report: reporterFor('extension') })
  const config = validateConfig(extension.config, reporterFor('extension'), extension.path)
  if (config.disable.includes(fingerprintCheck.id)) {
    reporterFor('extension')(extension.path, 'fingerprint 不可 disable(「项目不抄插件」是机器判定项),已忽略', 'warn')
    config.disable = config.disable.filter((id) => id !== fingerprintCheck.id)
  }
  const knownIds = new Set([...CORE_CHECKS.map((c) => c.id), ...extension.checks.map((c) => c.id)])
  for (const id of config.disable) {
    if (!knownIds.has(id)) reporterFor('extension')(extension.path, `disable 里的「${id}」不是已知检查项`, 'warn')
  }

  const baseCtx = {
    root, spec, config, walk, parseFrontmatter, mdLinks,
    gitLsFiles: () => gitLsFiles(root),
    fingerprintPath,
  }
  const runCheck = async (check, source) => {
    const entry = { id: check.id, title: check.title ?? check.id, source, status: 'ok', findings: 0 }
    checks.push(entry)
    if (config.disable.includes(check.id)) { entry.status = 'disabled'; return }
    const before = findings.length
    const report = reporterFor(check.id)
    try {
      const r = await check.run({ ...baseCtx, report })
      if (r && typeof r === 'object') {
        if (r.skipped) { entry.status = 'skipped'; entry.note = String(r.skipped) }
        if (r.scanned !== undefined) entry.scanned = r.scanned
      }
    } catch (e) {
      report(source === 'extension' ? extension.path : spec, `检查项 ${check.id} 执行异常:${e?.message ?? e}`)
      entry.status = 'crashed'
    }
    entry.findings = findings.length - before
    if (entry.findings > 0 && entry.status === 'ok') entry.status = 'reported'
  }

  if (!existsSync(spec)) {
    checks.push({ id: 'core-files', title: '核心文件存在', source: 'core', status: 'reported', findings: 1 })
    findings.push({ check: 'core-files', file: '.spec', message: '缺 .spec/ 目录——本项目未接入(/workflow:init 可生成骨架);其余通用项与扩展未执行', level: 'error' })
  } else {
    for (const check of CORE_CHECKS) await runCheck(check, 'core')
    for (const check of extension.checks) await runCheck(check, 'extension')
  }
  await runCheck(fingerprintCheck, 'fingerprint')

  const errors = findings.filter((f) => f.level === 'error').length
  const warnings = findings.filter((f) => f.level === 'warn').length
  return {
    root,
    api: LINT_API,
    ok: errors === 0,
    strict,
    exitCode: strict && errors > 0 ? 1 : 0,
    errors,
    warnings,
    checks,
    findings,
    extension: { path: extension.path, status: extension.status, api: extension.api, checks: extension.checks.map((c) => c.id) },
    fingerprint: { path: fingerprintPath === null ? null : displayPath(fingerprintPath), status: checks.at(-1)?.status ?? 'skipped' },
  }
}

const EXT_STATUS_TEXT = {
  absent: '未提供(可选)',
  off: '已按参数关闭',
  loaded: '已加载 api=1',
  rejected: 'api 不匹配,未加载',
  failed: '加载失败',
}

/** 人读报告。 */
export function formatReport(result) {
  const lines = [`spec-lint: ${result.root}`]
  const core = result.checks.filter((c) => c.source === 'core')
  const summarize = (list) => `${list.length} 项:${list.filter((c) => c.status === 'ok').length} 通过、${list.filter((c) => c.status === 'reported' || c.status === 'crashed').length} 有报告、${list.filter((c) => c.status === 'skipped').length} 跳过、${list.filter((c) => c.status === 'disabled').length} 禁用`
  lines.push(`  通用项 ${summarize(core)}`)
  const extChecks = result.checks.filter((c) => c.source === 'extension')
  lines.push(`  扩展 ${result.extension.path}:${EXT_STATUS_TEXT[result.extension.status] ?? result.extension.status}${extChecks.length ? `,${summarize(extChecks)}(${extChecks.map((c) => c.id).join(', ')})` : ''}`)
  const fp = result.checks.find((c) => c.source === 'fingerprint')
  if (fp?.status === 'skipped') lines.push(`  指纹 跳过:${fp.note}`)
  else if (fp) lines.push(`  指纹 ${result.fingerprint.path}:扫描 ${fp.scanned ?? 0} 个文件,${fp.findings} 处命中`)
  for (const c of result.checks) {
    if (c.status === 'skipped' && c.source !== 'fingerprint') lines.push(`  · ${c.id} 跳过:${c.note}`)
  }
  if (result.findings.length) {
    lines.push('')
    for (const f of result.findings) {
      const mark = f.level === 'error' ? '✗' : f.level === 'warn' ? '!' : 'i'
      lines.push(`  ${mark} [${f.check}] ${f.file}: ${f.message}`)
    }
    lines.push('')
    lines.push(`spec-lint: ${result.errors} 处不一致${result.warnings ? `、${result.warnings} 处提醒` : ''}(只报告不阻断;--strict 时退出码 1)`)
  } else {
    lines.push('spec-lint: OK')
  }
  return `${lines.join('\n')}\n`
}
