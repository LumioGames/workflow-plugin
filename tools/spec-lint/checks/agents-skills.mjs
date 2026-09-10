import { basename, dirname, join } from 'node:path'

const isDoc = (p) => p.endsWith('.md') && basename(p) !== 'README.md'

/** 项目 agents frontmatter：只允许 name + description + disallowedTools；name 与文件名（去 .agent.md / .md）一致。 */
export const agentsFrontmatter = {
  id: 'agents-frontmatter',
  title: '项目 agents frontmatter',
  run({ spec, walk, parseFrontmatter, report }) {
    const allowed = new Set(['name', 'description', 'disallowedTools'])
    for (const file of walk(join(spec, 'agents'), isDoc)) {
      const fm = parseFrontmatter(file)
      const base = basename(file).replace(/\.agent\.md$|\.md$/, '')
      if (!fm) { report(file, '缺少 frontmatter'); continue }
      for (const key of ['name', 'description']) if (!fm[key]) report(file, `frontmatter 缺 ${key}`)
      const unknown = fm.__keys.filter((k) => !allowed.has(k))
      if (unknown.length) report(file, `frontmatter 只允许 name + description + disallowedTools,多出:${unknown.join(', ')}(其余写进正文,宿主不据以调度)`)
      if (fm.name && fm.name !== base) report(file, `frontmatter name「${fm.name}」与文件名「${base}」不一致`)
    }
  },
}

/** 项目 skills frontmatter：只允许 name + description；name 与目录名一致。 */
export const skillsFrontmatter = {
  id: 'skills-frontmatter',
  title: '项目 skills frontmatter',
  run({ spec, walk, parseFrontmatter, report }) {
    for (const file of walk(join(spec, 'skills'), (p) => basename(p) === 'SKILL.md')) {
      const fm = parseFrontmatter(file)
      const dir = basename(dirname(file))
      if (!fm) { report(file, '缺少 frontmatter'); continue }
      for (const key of ['name', 'description']) if (!fm[key]) report(file, `frontmatter 缺 ${key}`)
      const unknown = fm.__keys.filter((k) => k !== 'name' && k !== 'description')
      if (unknown.length) report(file, `frontmatter 只允许 name + description,多出:${unknown.join(', ')}`)
      if (fm.name && fm.name !== dir) report(file, `frontmatter name「${fm.name}」与目录名「${dir}」不一致`)
    }
  },
}
