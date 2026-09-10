import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 禁并行文档根：docs/specs/、docs/plans/、.sdd/ 不得出现（仓根按文件系统查，任意层级按 git 索引查）；
 * 仓根之外不得有第二个 .spec/（templates/.spec/ 模板骨架豁免）。.workflow-drafts/ 是插件自己的草稿目录，不禁。
 * 非 git 仓库或没装 git 时只查仓根；其余 git 失败上报，不静默失效。
 */
export default {
  id: 'doc-roots',
  title: '禁并行文档根',
  run({ root, gitLsFiles, report }) {
    for (const rel of ['docs/specs', 'docs/plans', '.sdd']) {
      if (existsSync(join(root, rel))) report(join(root, rel), `并行文档根:${rel}/ 不得出现(设计 → .spec/knowledge/、决策 → .spec/decisions/、任务 → Workflow)`)
    }
    let indexed
    try { indexed = gitLsFiles() } catch (e) {
      report(root, `git ls-files 失败,任意层级的并行文档根校验未执行:${e.code ?? e.status ?? e.message}`)
      return
    }
    if (indexed === null) return { skipped: '非 git 仓库,只查了仓根' }
    const seen = new Set()
    for (const rel of indexed) {
      const hit = rel.match(/(^|.*?\/)(docs\/(?:specs|plans)|\.sdd)\//)
      if (hit && hit[1] !== '') {
        const dir = hit[1] + hit[2]
        if (!seen.has(dir)) { seen.add(dir); report(join(root, dir), `并行文档根:${dir}/ 不得在仓内任何层级出现`) }
      }
      const second = rel.match(/^(.*?\/)\.spec\//)
      if (second && !/(^|\/)templates\/$/.test(second[1])) {
        const dir = `${second[1]}.spec`
        if (!seen.has(dir)) { seen.add(dir); report(join(root, dir), '仓根之外出现第二个 .spec/(模板骨架 templates/.spec/ 豁免)') }
      }
    }
  },
}
