import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/** 把导航里的链接解析成绝对路径集合；链接指向目录时视为登记了该目录的 index.md / README.md。 */
function linkTargets(base, links) {
  const set = new Set()
  for (const link of links) {
    const target = resolve(base, link)
    set.add(target)
    try {
      if (statSync(target).isDirectory()) {
        set.add(join(target, 'index.md'))
        set.add(join(target, 'README.md'))
      }
    } catch { /* 悬空链接由 links 项报 */ }
  }
  return set
}

const isDoc = (p) => p.endsWith('.md') && basename(p) !== 'README.md'

/** 导航覆盖：features/、standards/ 与 knowledge 根下的 .md 必须被 knowledge/README.md 链接到（索引漂移 = 知识隐身）。 */
export const navCoverage = {
  id: 'nav-coverage',
  title: '知识导航覆盖',
  run({ spec, walk, mdLinks, report }) {
    const knowledgeDir = join(spec, 'knowledge')
    const nav = join(knowledgeDir, 'README.md')
    if (!existsSync(nav)) return { skipped: 'knowledge/README.md 不存在(core-files 已报)' }
    const covered = linkTargets(knowledgeDir, mdLinks(nav))
    const rootDocs = readdirSync(knowledgeDir)
      .filter((n) => n.endsWith('.md') && n !== 'README.md')
      .map((n) => join(knowledgeDir, n))
    const docs = [
      ...walk(join(knowledgeDir, 'features'), isDoc),
      ...walk(join(knowledgeDir, 'standards'), isDoc),
      ...rootDocs,
    ]
    for (const file of docs) {
      if (!covered.has(file)) report(file, '未登记进 knowledge/README.md 导航(索引漂移 = 知识隐身)')
    }
  },
}

/** ADR 索引覆盖：decisions/ 下每条 ADR（含子目录）必须登记进 decisions/README.md。 */
export const adrIndex = {
  id: 'adr-index',
  title: 'ADR 索引覆盖',
  run({ spec, walk, mdLinks, report }) {
    const decisionsDir = join(spec, 'decisions')
    if (!existsSync(decisionsDir)) return { skipped: 'decisions/ 不存在' }
    const index = join(decisionsDir, 'README.md')
    if (!existsSync(index)) { report(index, '缺 decisions/README.md 索引'); return }
    const covered = linkTargets(decisionsDir, mdLinks(index))
    for (const file of walk(decisionsDir, isDoc)) {
      if (!covered.has(file)) report(file, '未登记进 decisions/README.md 索引')
    }
  },
}
