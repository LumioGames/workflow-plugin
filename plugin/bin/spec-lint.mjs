#!/usr/bin/env node
/**
 * spec-lint CLI —— 项目 .spec/ 结构体检。只报告不阻断:默认退出码恒 0,--strict 时有错误才 1。
 * 用法:spec-lint [root] [--strict] [--json] [--fingerprint <file> | --no-fingerprint]
 *   root 省略时取 CLAUDE_PROJECT_DIR 或 cwd。本地与 CI 同一写法:npx github:LumioGames/workflow-plugin spec-lint .
 * 检查项清单与扩展契约见 tools/spec-lint/core.mjs 头注释。
 */
import { runSpecLint, formatReport } from '../tools/spec-lint/core.mjs'

const USAGE = '用法:spec-lint [root] [--strict] [--json] [--fingerprint <file> | --no-fingerprint]'
const args = process.argv.slice(2)
let root
let strict = false
let json = false
let fingerprint
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--strict') strict = true
  else if (a === '--json') json = true
  else if (a === '--no-fingerprint') fingerprint = null
  else if (a === '--fingerprint') {
    fingerprint = args[++i]
    if (!fingerprint) { console.error(USAGE); process.exit(2) }
  } else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0) }
  else if (a.startsWith('-')) { console.error(`未知参数:${a}\n${USAGE}`); process.exit(2) }
  else if (root === undefined) root = a
  else { console.error(`多余参数:${a}\n${USAGE}`); process.exit(2) }
}
root ??= process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

const result = await runSpecLint({ root, strict, fingerprint })
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else process.stdout.write(formatReport(result))
process.exit(result.exitCode)
