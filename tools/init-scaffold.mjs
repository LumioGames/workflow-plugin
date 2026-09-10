#!/usr/bin/env node
/**
 * /workflow:init 的执行体 —— 把插件 templates/ 释放到目标项目,并补根 CLAUDE.md 的项目专属 @import。
 *
 * 生成的只有「这个项目是什么、定过什么」那一半(插件出方法、项目出事实的分工):.spec/AGENTS.md、rules/system.md(空模板)、
 * knowledge/README.md + features/_TEMPLATE.md、decisions/README.md、tools/lint-extensions.mjs(样例)、根 CLAUDE.md。
 * 不生成 tasks/、plans/(任务真值只有 Workflow),不写 .workflow、不生成 token(项目绑定走 /workflow:setup)。
 *
 * 确定性优先于灵活:默认**不覆盖**任何已存在文件(--force 才覆盖);CLAUDE.md 已存在时只补缺失的 @import 行,
 * 可反复跑(升级插件后再跑一次补齐新增模板)。
 * 用法:node tools/init-scaffold.mjs [--target <dir>] [--force]   (target 省略时取 CLAUDE_PROJECT_DIR 或 cwd)
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 根 CLAUDE.md 必须 @import 的三件项目专属文件(通用规则由插件注入,不在这里登记)。 */
export const IMPORT_LINES = ['@.spec/AGENTS.md', '@.spec/knowledge/README.md', '@.spec/rules/system.md']

export const CLAUDE_MD = `# CLAUDE.md

Claude Code 入口。下面的 \`@import\` 行把**项目专属**文件强制载入每个会话;通用规则(调度、编码、红线)由 Workflow 插件在 SessionStart 注入,不在这里重复。权威源在 \`.spec/\`,本文件只加载、不定义规则。

中心文档(项目是什么 / Room 表 / 收口命令 / 专属技能名册):

${IMPORT_LINES[0]}

知识导航(有哪些知识、在哪):

${IMPORT_LINES[1]}

项目专属红线(只放这个项目独有的,不抄插件):

${IMPORT_LINES[2]}

> 维护:\`.spec/rules/\` 下每个规则文件都要在上面有一行 \`@.spec/rules/<name>.md\`,漏了 = 会话静默不加载(\`/workflow:lint\` 会报)。
`

/** .workflow 只含 profile 名、不含 token;本脚本不写它,由 /workflow:setup 在用户确认后写入。 */
export const WORKFLOW_NOTE =
  '项目绑定:本脚本不写 .workflow、不生成 token。要把这个目录绑到某个 Workflow 项目,跑 /workflow:setup——它只写一行 profile = "<名>"(不含凭据,可入库)。'

function walkFiles(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkFiles(p, base))
    else out.push(relative(base, p))
  }
  return out
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * @param {{pluginRoot: string, target: string, force?: boolean}} options
 * @returns {{target: string, created: string[], overwritten: string[], skipped: string[], imports: string[]}}
 *   imports = 追加进已存在 CLAUDE.md 的 @import 行(新建 CLAUDE.md 时为空,它已包含全部三行)
 */
export function initScaffold({ pluginRoot, target, force = false }) {
  const templateRoot = join(pluginRoot, 'templates')
  if (!existsSync(templateRoot)) throw new Error(`插件缺 templates/ 目录:${templateRoot}`)
  target = resolve(target)
  const created = []
  const overwritten = []
  const skipped = []

  const place = (rel, content) => {
    const dest = join(target, rel)
    const exists = existsSync(dest)
    if (exists && !force) { skipped.push(rel); return }
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, content)
    ;(exists ? overwritten : created).push(rel)
  }

  for (const rel of walkFiles(templateRoot)) {
    if (/(^|[\\/])(tasks|plans)[\\/]/.test(rel)) continue // 任务 / 计划真值只有 Workflow,模板里即使出现也不释放
    place(rel, readFileSync(join(templateRoot, rel), 'utf8'))
  }
  place('CLAUDE.md', CLAUDE_MD)

  // 已存在的 CLAUDE.md 未被覆盖时,只补缺失的 @import 行——幂等,不动用户已有内容。
  const imports = []
  const claudeMd = join(target, 'CLAUDE.md')
  if (skipped.includes('CLAUDE.md')) {
    const text = readFileSync(claudeMd, 'utf8')
    for (const line of IMPORT_LINES) {
      if (!new RegExp(`^${escapeRe(line)}\\s*$`, 'm').test(text)) imports.push(line)
    }
    if (imports.length) {
      writeFileSync(claudeMd, `${text.trimEnd()}\n\n<!-- workflow:init 补齐的项目专属 @import -->\n\n${imports.join('\n\n')}\n`)
    }
  }

  return { target, created, overwritten, skipped, imports }
}

function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const targetFlagIndex = args.indexOf('--target')
  const target =
    (targetFlagIndex !== -1 ? args[targetFlagIndex + 1] : undefined) ??
    process.env.CLAUDE_PROJECT_DIR ??
    process.cwd()
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)))

  const { created, overwritten, skipped, imports } = initScaffold({ pluginRoot, target, force })
  console.log(`目标:${resolve(target)}`)
  console.log(`新建 ${created.length} 个文件${created.length ? ':\n  ' + created.join('\n  ') : ''}`)
  if (overwritten.length) console.log(`覆盖 ${overwritten.length} 个文件(--force):\n  ${overwritten.join('\n  ')}`)
  if (skipped.length) console.log(`跳过 ${skipped.length} 个已存在文件(用 --force 覆盖):\n  ${skipped.join('\n  ')}`)
  if (imports.length) console.log(`CLAUDE.md 已存在,补齐 @import:${imports.join('、')}`)
  console.log('未生成 tasks/、plans/——任务真值只有 Workflow。')
  console.log(WORKFLOW_NOTE)
  console.log('下一步:填 .spec/AGENTS.md 的「项目是什么」「Workflow 指针」「收口命令」,然后跑 /workflow:lint。')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
