import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @import 完整：仓根有 CLAUDE.md 时，.spec/AGENTS.md、.spec/knowledge/README.md 与 .spec/rules/*.md
 * 必须各有一行 `@.spec/<path>`（漏一行 = 会话静默不加载）。只查项目里真实存在的文件——
 * 通用规则由插件注入，不在这里登记。没有 CLAUDE.md 的宿主（只用 AGENTS.md）跳过本项。
 */
export default {
  id: 'imports',
  title: 'CLAUDE.md @import 完整',
  run({ root, spec, report }) {
    const claudeMd = join(root, 'CLAUDE.md')
    if (!existsSync(claudeMd)) return { skipped: '仓根无 CLAUDE.md(非 Claude Code 宿主)' }
    const imports = new Set([...readFileSync(claudeMd, 'utf8').matchAll(/^@(\.spec\/\S+)\s*$/gm)].map((m) => m[1]))
    const rulesDir = join(spec, 'rules')
    const mustImport = [
      '.spec/AGENTS.md',
      '.spec/knowledge/README.md',
      ...(existsSync(rulesDir)
        ? readdirSync(rulesDir).filter((n) => n.endsWith('.md') && n !== 'README.md').sort().map((n) => `.spec/rules/${n}`)
        : []),
    ].filter((rel) => existsSync(join(root, rel)))
    for (const rel of mustImport) {
      if (!imports.has(rel)) report(claudeMd, `缺 @import 行:@${rel}(漏了 = 会话静默不加载)`)
    }
  },
}
