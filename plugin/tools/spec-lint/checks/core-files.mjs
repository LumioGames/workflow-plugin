import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** 核心文件存在：宿主入口（CLAUDE.md 或 AGENTS.md 至少一个）、.spec/AGENTS.md、.spec/knowledge/README.md。 */
export default {
  id: 'core-files',
  title: '核心文件存在',
  run({ root, spec, report }) {
    if (!existsSync(join(root, 'CLAUDE.md')) && !existsSync(join(root, 'AGENTS.md'))) {
      report(join(root, 'CLAUDE.md'), '缺宿主入口:仓根 CLAUDE.md 或 AGENTS.md 至少要有一个(Claude Code 读前者,其它宿主读后者)')
    }
    for (const [rel, label] of [
      ['AGENTS.md', '中心文档(项目是什么 / Room 表 / 收口命令)'],
      ['knowledge/README.md', '知识导航'],
    ]) {
      const file = join(spec, rel)
      if (!existsSync(file)) report(file, `缺核心文件:.spec/${rel}(${label})`)
    }
  },
}
