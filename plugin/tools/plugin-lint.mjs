#!/usr/bin/env node
/**
 * plugin-lint —— **插件自身**的结构一致性校验。只在 workflow-plugin 仓内跑(npm run lint:plugin / CI / /workflow:lint)。
 * 用法:node plugin/tools/plugin-lint.mjs [插件根目录]   (省略参数时取本脚本上级目录,即 plugin/)
 *
 * 边界:项目 .spec/ 由 bin/spec-lint.mjs 校验;Agent Plugins 1.0.0 的清单合规由 tests/agent-plugins-conformance.test.mjs 负责。
 * 两者分开,是为了让装了插件的下游项目不被插件自身的结构校验项误伤。
 * 各部件(skills / agents / commands / hooks / rules)不存在时跳过对应项,不报错——插件分几路并行吸收,谁先合入都能跑。
 *
 * 校验项清单(本注释是插件侧「lint 能力清单」的单一权威):
 *  1. 核心文件存在:plugin.json、.claude-plugin/plugin.json。
 *  1b. 发布面隔离:插件根下不得出现 tests / .github / package.json / .gitignore / .claude ——
 *     发布面是「装进用户机器的全部内容」,开发过程文件混进来会被原样下发。
 *  2. skills:skills/ 每个直接子目录都有 SKILL.md,frontmatter name 与目录名一致、description 非空;
 *     其余键限于 Agent Skills 标准的可选字段(license / allowed-tools / metadata / version)。
 *  3. agents:agents/*.md 的 frontmatter 只允许 name + description + disallowedTools,name 与文件名一致;
 *     reviewer.md 若存在,disallowedTools 必须含 Bash(reviewer 只读、只出报告,不跑命令)。
 *  4. commands:commands/*.md 必须有 frontmatter 且 description 非空(宿主据此列出 / 命令)。
 *  5. hooks:hooks/hooks.json 可解析;不得注册 PreToolUse(commit 阻断钩子已移除);
 *     SessionStart 命令里 ${CLAUDE_PLUGIN_ROOT}/<script> 指向的脚本必须存在(写错不报错,只会让规则静默缺席)。
 *  6. rules:rules/*.md 不得出现旧制度词汇(契约卡 / wave / .spec/tasks / 收口门槛 / 铁律 / in_progress)——
 *     这些是被替换掉的旧制度语汇,插件规则里一个不留。
 *  7. 链接可达:rules / agents / commands / templates / skills 下 .md 的相对链接必须指向存在的文件。
 *  8. 模板隔离:templates/ 内 .md 的相对链接不得解析到 templates/ 之外(如 ../../skills/x)——
 *     模板会被原样复制进用户项目,插件资产在那边不存在;模板树内部的相对链接(tools/、rules/)不受限。
 * 退出码:有不一致时 1(这是插件仓自己的 CI 门,不是项目侧 lint)。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, basename, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk, parseFrontmatter, mdLinks } from './spec-lint/lib.mjs'

export const BANNED_RULE_WORDS = ['契约卡', 'wave', '.spec/tasks', '收口门槛', '铁律', 'in_progress']
const SKILL_ALLOWED_KEYS = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata', 'version'])
const AGENT_ALLOWED_KEYS = new Set(['name', 'description', 'disallowedTools'])

/** 跑全部校验,返回错误列表(相对 root 的 `file: msg`)。 */
export function pluginLint(root) {
  root = resolve(root)
  const errors = []
  const err = (file, msg) => errors.push(`${relative(root, file) || '.'}: ${msg}`)

  // ── 1. 核心文件存在 ─────────────────────────────────────────────────
  for (const rel of ['plugin.json', '.claude-plugin/plugin.json']) {
    if (!existsSync(join(root, rel))) err(join(root, rel), `缺核心文件:${rel}`)
  }

  // ── 1b. 发布面隔离 ──────────────────────────────────────────────────
  // 插件根 = 装进用户机器的全部内容。开发过程文件混进来会被原样下发:
  // 本仓的 tests/ 与 package.json 对用户毫无意义,而 .claude/ 会把本仓自己的
  // 项目配置带进别人的项目。靠自觉守不住,所以在这儿变成机器拦截。
  for (const leaked of ['tests', '.github', 'package.json', '.gitignore', '.claude']) {
    if (existsSync(join(root, leaked))) {
      err(join(root, leaked), `发布面混入开发过程文件:${leaked}(会被原样装进用户机器)`)
    }
  }

  // ── 2. skills ───────────────────────────────────────────────────────
  const skillsDir = join(root, 'skills')
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = join(skillsDir, entry.name, 'SKILL.md')
      if (!existsSync(file)) { err(file, `skills/${entry.name} 缺少 SKILL.md`); continue }
      const fm = parseFrontmatter(file)
      if (!fm) { err(file, '缺少 frontmatter'); continue }
      if (fm.name !== entry.name) err(file, `frontmatter name「${fm.name ?? ''}」与目录名「${entry.name}」不一致`)
      if (!fm.description) err(file, 'frontmatter 缺 description')
      const unknown = fm.__keys.filter((k) => !SKILL_ALLOWED_KEYS.has(k))
      if (unknown.length) err(file, `frontmatter 含规范外字段:${unknown.join(', ')}`)
    }
  }

  // ── 3. agents ───────────────────────────────────────────────────────
  const agentsDir = join(root, 'agents')
  if (existsSync(agentsDir)) {
    for (const name of readdirSync(agentsDir).filter((n) => n.endsWith('.md')).sort()) {
      const file = join(agentsDir, name)
      const fm = parseFrontmatter(file)
      const base = basename(name, '.md')
      if (!fm) { err(file, '缺少 frontmatter'); continue }
      for (const key of ['name', 'description']) if (!fm[key]) err(file, `frontmatter 缺 ${key}`)
      const unknown = fm.__keys.filter((k) => !AGENT_ALLOWED_KEYS.has(k))
      if (unknown.length) err(file, `frontmatter 只允许 name + description + disallowedTools,多出:${unknown.join(', ')}`)
      if (fm.name && fm.name !== base) err(file, `frontmatter name「${fm.name}」与文件名「${base}」不一致`)
      if (base === 'reviewer' && !/\bBash\b/.test(fm.disallowedTools ?? '')) {
        err(file, 'reviewer 的 frontmatter 必须含 disallowedTools: Bash(只读、只出报告,不跑命令)')
      }
    }
  }

  // ── 4. commands ─────────────────────────────────────────────────────
  const commandsDir = join(root, 'commands')
  if (existsSync(commandsDir)) {
    for (const name of readdirSync(commandsDir).filter((n) => n.endsWith('.md')).sort()) {
      const file = join(commandsDir, name)
      const fm = parseFrontmatter(file)
      if (!fm) { err(file, '缺少 frontmatter(宿主据 description 列出 / 命令)'); continue }
      if (!fm.description) err(file, 'frontmatter 缺 description')
    }
  }

  // ── 5. hooks ────────────────────────────────────────────────────────
  const hooksFile = join(root, 'hooks', 'hooks.json')
  if (existsSync(hooksFile)) {
    let hooks = null
    try {
      hooks = JSON.parse(readFileSync(hooksFile, 'utf8')).hooks
    } catch {
      err(hooksFile, 'hooks.json 不是合法 JSON')
    }
    if (hooks && typeof hooks === 'object') {
      if ('PreToolUse' in hooks) err(hooksFile, '注册了 PreToolUse——commit 阻断钩子已移除,插件只留 SessionStart')
      const sessionStart = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : []
      const commands = sessionStart.flatMap((entry) => (entry.hooks ?? []).map((h) => h.command ?? ''))
      for (const command of commands) {
        for (const m of command.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/g)) {
          if (!existsSync(join(root, m[1]))) err(hooksFile, `SessionStart 指向的脚本不存在:${m[1]}`)
        }
      }
    }
  }

  // ── 6. rules 禁用词 ─────────────────────────────────────────────────
  for (const file of walk(join(root, 'rules'), (p) => p.endsWith('.md'))) {
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const lower = line.toLowerCase()
      for (const word of BANNED_RULE_WORDS) {
        if (lower.includes(word.toLowerCase())) err(file, `第 ${i + 1} 行出现旧制度词汇「${word}」——插件规则一律 Workflow 语汇`)
      }
    })
  }

  // ── 7. 链接可达 ─────────────────────────────────────────────────────
  for (const dir of ['rules', 'agents', 'commands', 'templates', 'skills']) {
    for (const file of walk(join(root, dir), (p) => p.endsWith('.md'))) {
      for (const link of mdLinks(file)) {
        if (!existsSync(resolve(dirname(file), link))) err(file, `悬空链接:${link}`)
      }
    }
  }

  // ── 8. 模板隔离 ─────────────────────────────────────────────────────
  const templatesDir = join(root, 'templates')
  for (const file of walk(templatesDir, (p) => p.endsWith('.md'))) {
    for (const link of mdLinks(file)) {
      const target = resolve(dirname(file), link)
      if (!target.startsWith(templatesDir + sep)) {
        err(file, `模板不得引用模板树之外的路径(复制进用户项目后会悬空):${link}`)
      }
    }
  }

  return errors
}

function main() {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`plugin-lint: 目录不存在:${root}`)
    process.exit(2)
  }
  const errors = pluginLint(root)
  if (errors.length > 0) {
    console.error(`plugin-lint: ${errors.length} 处不一致\n`)
    for (const e of errors) console.error(`  ✗ ${e}`)
    process.exit(1)
  }
  console.log('plugin-lint: OK')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
