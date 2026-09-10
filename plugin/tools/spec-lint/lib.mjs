/**
 * spec-lint 的文件系统小工具——core 与各检查项共用，也原样暴露给项目扩展（ctx.walk 等）。
 * 这里只有读，没有写：lint 永远不改项目文件。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** 递归列出 dir 下通过 filter 的文件（绝对路径，按名排序）；目录不存在返回 []；悬空软链跳过。 */
export function walk(dir, filter = () => true) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) out.push(...walk(p, filter))
    else if (filter(p)) out.push(p)
  }
  return out
}

/**
 * 解析 markdown 顶部 frontmatter。返回 null 表示没有 frontmatter。
 * 返回对象：顶层键 → 字符串值；`metadata:` 下的嵌套键展开成 `metadata.<key>`；
 * 顶层键下的块列表（`- item`）合并成逗号分隔字符串；`__keys` 是顶层键的出现顺序；`__raw` 是原文。
 */
export function parseFrontmatter(file) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  if (!text.startsWith('---\n')) return null
  let end = text.indexOf('\n---\n', 4)
  if (end === -1 && text.endsWith('\n---')) end = text.length - 4
  if (end === -1) return null
  const body = text.slice(4, end)
  const fm = { __keys: [], __raw: body }
  let inMetadata = false
  let currentKey = null
  for (const line of body.split('\n')) {
    if (!line.trim()) continue
    const m = line.match(/^(\s*)([\w-]+):\s*(.*)$/)
    if (!m) {
      const item = line.match(/^\s+-\s*(.*)$/)
      if (item && currentKey && !inMetadata) {
        const v = item[1].replace(/\s+#.*$/, '').trim()
        fm[currentKey] = fm[currentKey] ? `${fm[currentKey]}, ${v}` : v
      }
      continue
    }
    const [, indent, key, rawValue] = m
    const value = rawValue.replace(/\s+#.*$/, '').trim()
    if (indent === '') {
      inMetadata = key === 'metadata'
      currentKey = key
      fm.__keys.push(key)
      if (!inMetadata) fm[key] = value
    } else if (inMetadata) {
      fm[`metadata.${key}`] = value
    }
  }
  return fm
}

/** 提取 markdown 相对链接目标（剥围栏代码块与行内代码；带 scheme 的外链与 # 锚点跳过；去掉 #片段）。 */
export function mdLinks(file) {
  const text = readFileSync(file, 'utf8')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
  const links = []
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1]
    if (/^([a-zA-Z][a-zA-Z0-9+.-]*:|#)/.test(target)) continue
    let decoded = target.split('#')[0]
    try { decoded = decodeURIComponent(decoded) } catch { /* 保留原样 */ }
    links.push(decoded)
  }
  return links
}

/**
 * git 索引里的文件（相对 root）。非 git 仓库或没装 git 返回 null；其余失败抛出——
 * 调用方必须上报，不能让「禁并行文档根」这类以索引为遍历面的检查静默失效。
 */
export function gitLsFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\0').filter(Boolean)
  } catch (e) {
    if (e.status === 128 || e.code === 'ENOENT') return null
    throw e
  }
}

/** 路径包含判断前的大小写归一（Windows 文件系统不分大小写）。 */
export const normalizeContainmentPath = (path) =>
  process.platform === 'win32' ? path.toLowerCase() : path
