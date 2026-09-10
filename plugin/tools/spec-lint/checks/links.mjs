import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { normalizeContainmentPath } from '../lib.mjs'

/** 链接可达：.spec 下全部 .md 与仓根 README.md / AGENTS.md 的相对链接必须指向存在的文件；指向仓外（兄弟仓）的不查。 */
export default {
  id: 'links',
  title: '链接可达',
  run({ root, spec, walk, mdLinks, report }) {
    const files = [
      ...walk(spec, (p) => p.endsWith('.md')),
      join(root, 'README.md'),
      join(root, 'AGENTS.md'),
    ].filter(existsSync)
    const rootCmp = normalizeContainmentPath(root)
    for (const file of files) {
      for (const link of mdLinks(file)) {
        const target = resolve(dirname(file), link)
        const cmp = normalizeContainmentPath(target)
        if (cmp !== rootCmp && !cmp.startsWith(rootCmp + sep)) continue
        if (!existsSync(target)) report(file, `悬空链接:${link}`)
      }
    }
  },
}
