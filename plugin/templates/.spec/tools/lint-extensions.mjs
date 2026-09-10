/**
 * 项目侧 lint 扩展(样例)。通用项在 Workflow 插件里(npx github:LumioGames/workflow-plugin spec-lint .),
 * 这里只放**本项目独有**的结构约束。没有扩展需求时留着也无妨——下面两条样例在对应目录不存在时自动跳过。
 *
 * 契约(api = 1):
 *   export const api = 1                      // 与插件 core 不匹配即报错,扩展不加载
 *   export const config = { ... }             // 可选:frontmatterDirs / adrStatusEnum / statusEnum / disable(整体替换默认值)
 *   export const checks = [{ id, run(ctx) }]  // run 可 async;返回 { skipped: '原因' } 表示无校验面
 *   ctx = { root, spec, config, walk, parseFrontmatter, mdLinks, gitLsFiles, report(file, msg, level) }
 *   level ∈ error(默认)/ warn / info;只有 error 计入 --strict 的退出码
 */
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

export const api = 1

export const config = {
  // frontmatterDirs: ['knowledge/features', 'knowledge/standards'],   // 例:不再要求 plans / reviews 有 frontmatter
  // adrStatusEnum: ['Draft', 'Accepted', 'Superseded'],               // 例:收紧 ADR 状态枚举
  // statusEnum: ['设计中', '实施中', '已交付', '历史归档'],
  // disable: [],                                                      // 例:['symlinks'];fingerprint 不可关
}

const isAdr = (name) => /^ADR-\d+-.+\.md$/i.test(name)

export const checks = [
  {
    /**
     * 样例 1:docs/adr/ 软链镜像。项目若为兼容旧读者保留 docs/adr/,里面每条根 ADR 都必须是
     * 指向 .spec/decisions/<同名> 的软链(git mode 120000),不得是普通文件副本(副本会漂)。
     * 没有 docs/adr/ 的项目跳过。
     */
    id: 'docs-adr-mirror',
    run({ root, spec, report }) {
      const mirror = join(root, 'docs', 'adr')
      const decisions = join(spec, 'decisions')
      if (!existsSync(mirror) || !existsSync(decisions)) return { skipped: 'docs/adr/ 不存在' }
      const rootAdrs = readdirSync(decisions).filter(isAdr)
      for (const name of rootAdrs) {
        const link = join(mirror, name)
        let st
        try { st = lstatSync(link) } catch { report(link, `镜像缺失:docs/adr/${name} 应是指向 .spec/decisions/${name} 的软链`); continue }
        if (!st.isSymbolicLink()) { report(link, '镜像必须是软链(git mode 120000),不得是普通文件副本'); continue }
        const target = resolve(dirname(link), readlinkSync(link))
        if (target !== join(decisions, name)) report(link, `镜像应指向 .spec/decisions/${name},实际 ${relative(root, target)}`)
      }
      for (const name of readdirSync(mirror)) {
        const p = join(mirror, name)
        if (!lstatSync(p).isSymbolicLink() && isAdr(name)) report(p, '镜像目录里出现普通文件副本——只能是软链')
      }
    },
  },
  {
    /**
     * 样例 2:Draft ADR 的「## 兼容影响」点名的知识文档必须回指该 ADR 编号——
     * 否则 = ADR 落了、文档没改,执行者拿到的还是旧规矩。写法约定:兼容影响只点名**改了**的文档;
     * 全路径(knowledge/features/x.md)严格校验,反引号裸名(`x.md`)按 features → standards → knowledge 根解析。
     */
    id: 'adr-draft-backref',
    run({ spec, walk, report }) {
      const decisions = join(spec, 'decisions')
      const knowledge = join(spec, 'knowledge')
      if (!existsSync(decisions)) return { skipped: 'decisions/ 不存在' }
      for (const file of walk(decisions, (p) => isAdr(basename(p)))) {
        if (relative(decisions, file).includes(sep)) continue // 子命名空间不校验
        const adrId = basename(file).match(/^(ADR-\d+)/i)?.[1]
        const text = readFileSync(file, 'utf8')
        const head = text.split(/\r?\n/).slice(0, 12).join('\n')
        if (!/^\s*-?\s*(\*\*Status\*\*|状态)\s*[:：]\s*Draft/m.test(head)) continue
        const section = text.match(/^## 兼容影响[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1]
        if (!section) continue
        const targets = new Map()
        for (const m of section.matchAll(/knowledge\/(?:features|standards)\/[\w.-]+\.md/g)) {
          targets.set(m[0], { target: join(spec, m[0]), strict: true })
        }
        for (const m of section.matchAll(/`([\w-]+\.md)`/g)) {
          if (m[1] === 'README.md') continue
          const hit = ['features', 'standards', ''].map((d) => join(knowledge, d, m[1])).find((p) => existsSync(p))
          if (hit && !targets.has(relative(spec, hit))) targets.set(relative(spec, hit), { target: hit, strict: false })
        }
        for (const [rel, { target, strict }] of targets) {
          if (!existsSync(target)) { if (strict) report(file, `兼容影响点名的文档不存在:${rel}`); continue }
          if (!readFileSync(target, 'utf8').includes(adrId)) {
            report(target, `被 ${adrId}「兼容影响」点名,但正文未回指 ${adrId}(ADR 落了、文档没改)`)
          }
        }
      }
    },
  },
]
