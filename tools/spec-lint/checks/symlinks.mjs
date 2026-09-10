import { lstatSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { normalizeContainmentPath } from '../lib.mjs'

/**
 * 软链存活：.claude/agents、.claude/skills、.agents/skills 若是软链，必须解析进 .spec/（悬空或指向别处 = 宿主自动发现失效）。
 * 不存在不报（项目可以不自建 agents / skills）；是普通目录也不报（那是项目自己的落点，不归本项）。
 */
export default {
  id: 'symlinks',
  title: '软链存活',
  run({ root, spec, report }) {
    let specReal
    try { specReal = normalizeContainmentPath(realpathSync(spec)) } catch { return { skipped: '.spec/ 不可解析' } }
    for (const rel of ['.claude/agents', '.claude/skills', '.agents/skills']) {
      const link = join(root, rel)
      let st
      try { st = lstatSync(link) } catch { continue }
      if (!st.isSymbolicLink()) continue
      let real
      try { real = normalizeContainmentPath(realpathSync(link)) } catch { report(link, '软链接悬空(目标不存在)'); continue }
      if (real !== specReal && !real.startsWith(specReal + sep)) {
        report(link, `软链接未解析进 .spec/(实际指向 ${real})`)
      }
    }
  },
}
