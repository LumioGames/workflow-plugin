import { basename, join } from 'node:path'

/**
 * 文档 frontmatter：config.frontmatterDirs（相对 .spec/）下每个 .md（README.md 除外）
 * 必须有 name / description / metadata.type / metadata.status；status 取 config.statusEnum；
 * description ≤ 120 字符且单行明文（YAML 多行标量 > / | 会绕过长度校验，禁用）。
 */
export default {
  id: 'frontmatter',
  title: '文档 frontmatter',
  run({ spec, config, walk, parseFrontmatter, report }) {
    const statusEnum = new Set(config.statusEnum)
    for (const dir of config.frontmatterDirs) {
      for (const file of walk(join(spec, dir), (p) => p.endsWith('.md') && basename(p) !== 'README.md')) {
        const fm = parseFrontmatter(file)
        if (!fm) { report(file, '缺少 frontmatter'); continue }
        for (const key of ['name', 'description', 'metadata.type', 'metadata.status']) {
          if (!fm[key]) report(file, `frontmatter 缺 ${key}`)
        }
        const status = fm['metadata.status']
        if (status && !statusEnum.has(status)) {
          report(file, `status「${status}」不在枚举(${[...statusEnum].join(' / ')})——历史在 git,不进文档`)
        }
        if (fm.description && /^[>|]/.test(fm.description)) {
          report(file, 'description 必须单行明文——YAML 多行标量会绕过长度校验')
        } else if (fm.description && [...fm.description].length > 120) {
          report(file, `description 超过 120 字符(${[...fm.description].length})——一句话是什么 + 何时查`)
        }
      }
    }
  },
}
