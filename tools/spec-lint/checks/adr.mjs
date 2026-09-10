import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const isDoc = (p) => p.endsWith('.md') && basename(p) !== 'README.md'
const ID_RE = /^(ADR-\d+|\d{4})-/i

/** ADR 编号唯一：decisions/ 根与每个子目录各自成一套编号，同目录内同号只能有一个文件。 */
export const adrUniqueId = {
  id: 'adr-unique-id',
  title: 'ADR 编号唯一',
  run({ spec, report }) {
    const decisionsDir = join(spec, 'decisions')
    if (!existsSync(decisionsDir)) return { skipped: 'decisions/ 不存在' }
    const dirs = [decisionsDir]
    for (const name of readdirSync(decisionsDir)) {
      const sub = join(decisionsDir, name)
      try { if (statSync(sub).isDirectory()) dirs.push(sub) } catch { /* 悬空软链 */ }
    }
    for (const dir of dirs) {
      const byId = new Map()
      for (const name of readdirSync(dir).sort()) {
        if (!isDoc(name)) continue
        const id = name.match(ID_RE)?.[1]
        if (!id) continue
        const key = id.toUpperCase()
        if (!byId.has(key)) byId.set(key, [])
        byId.get(key).push(name)
      }
      for (const [id, names] of byId) {
        if (names.length > 1) report(join(dir, names[0]), `ADR 编号 ${id} 撞号:${names.join(' / ')}(同一编号只能有一个文件,撞号 = 引用歧义)`)
      }
    }
  },
}

/**
 * ADR 状态行：每条 ADR 前 12 行内必须有 `- **Status**: X` 或 `状态：X`，X 取 config.adrStatusEnum；
 * 另收「(部分)被 [NNN](<file>) 取代」这种带链接的取代写法。括号里的补充说明（日期、裁决人）不参与判定。
 */
export const adrStatus = {
  id: 'adr-status',
  title: 'ADR 状态行',
  run({ spec, config, walk, report }) {
    const decisionsDir = join(spec, 'decisions')
    if (!existsSync(decisionsDir)) return { skipped: 'decisions/ 不存在' }
    const allowed = new Set(config.adrStatusEnum)
    for (const file of walk(decisionsDir, isDoc)) {
      const head = readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 12).join('\n')
      const m = head.match(/^\s*-?\s*\*\*Status\*\*\s*[:：]\s*(.+)$/m) || head.match(/^\s*-?\s*状态\s*[:：]\s*(.+)$/m)
      if (!m) { report(file, 'ADR 前 12 行内缺状态行(`- **Status**: X` 或 `状态：X`)'); continue }
      const value = m[1].trim()
      if (/^(部分)?被\s*\[[^\]]+\]\([^)\s]+\)\s*取代/.test(value)) continue
      const first = value.split(/\s+/)[0].replace(/[（(].*$/, '').replace(/[,，;；]$/, '')
      if (!allowed.has(first)) report(file, `ADR 状态「${first}」不在枚举(${[...allowed].join(' / ')})`)
    }
  },
}
