#!/usr/bin/env node
/**
 * fingerprint —— 插件规则指纹。发版时生成 rules/.fingerprint.json，spec-lint 据此判定
 * 「项目抄了插件」：项目 AGENTS.md / rules/ 出现保留标题，或连续 ≥ 3 行与插件规则逐字相同。
 *
 * 用法:node tools/fingerprint.mjs generate --rules <dir> --out <file> [--reserved "标题1,标题2"]
 *   npm run fingerprint 即 generate --rules rules --out rules/.fingerprint.json。
 *
 * 文件格式:{ api: 1, generatedAt, reservedHeadings: [...], lines: { <sha1(归一化行)>: "<file>:<n>" } }
 * 归一化(本文件的 normalizeLine 是生成与检查两侧共用的单一实现):去 markdown 标记(标题井号、列表符、
 * 引用符、复选框、强调、反引号、表格竖线、链接只留文字),再去掉全部空白(中文文本空白无语义,去掉强调标记
 * 后残留的空格不该影响比对);
 * 只收归一化后 ≥ 12 字的行(短行到处都是,不构成「抄」的证据)。
 *
 * 保留标题默认表(可用 --reserved 覆盖):调度核心、编码约定、宿主差异、协作 / 调度、安全 / 外发、工程
 * ——这些是插件规则的节名,项目文件里出现即报,不看正文。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FINGERPRINT_API = 1
export const MIN_LINE_CHARS = 12
export const MIN_RUN = 3
export const DEFAULT_RESERVED_HEADINGS = ['调度核心', '编码约定', '宿主差异', '协作 / 调度', '安全 / 外发', '工程']

/** 去 markdown 标记与多余空白;返回可比对的纯文本行。 */
export function normalizeLine(line) {
  let s = String(line).replace(/\r$/, '').trim()
  let prev
  do {
    prev = s
    s = s.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/, '')
  } while (s !== prev)
  s = s.replace(/\s+#+\s*$/, '')
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/[*_~`|]/g, ' ')
  // 空白整体去掉而不是合并:中文文本里的空白无语义,去掉强调标记后残留的空格不该影响比对。
  return s.replace(/\s+/g, '')
}

export const hashLine = (normalized) => createHash('sha1').update(normalized, 'utf8').digest('hex')
export const isFingerprintable = (normalized) => [...normalized].length >= MIN_LINE_CHARS

/** 标题比对口径:去空白、去尾部括号补充(「## 调度核心(名册)」仍算命中)。 */
export const normalizeHeading = (h) => String(h).replace(/[（(].*$/, '').replace(/\s+/g, '')

function walkMd(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkMd(p))
    else if (name.endsWith('.md')) out.push(p)
  }
  return out
}

/** 生成指纹对象(不写盘)。文件名记为 <rules 目录名>/<相对路径>,与插件根相对路径一致。 */
export function generateFingerprint({ rulesDir, reservedHeadings = DEFAULT_RESERVED_HEADINGS, now = new Date() }) {
  rulesDir = resolve(rulesDir)
  if (!existsSync(rulesDir) || !statSync(rulesDir).isDirectory()) throw new Error(`规则目录不存在:${rulesDir}`)
  const lines = {}
  for (const file of walkMd(rulesDir)) {
    const label = `${basename(rulesDir)}/${relative(rulesDir, file).split(/[\\/]/).join('/')}`
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, i) => {
      const n = normalizeLine(raw)
      if (!isFingerprintable(n)) return
      const key = hashLine(n)
      if (!(key in lines)) lines[key] = `${label}:${i + 1}`
    })
  }
  return { api: FINGERPRINT_API, generatedAt: now.toISOString(), reservedHeadings: [...reservedHeadings], lines }
}

/** 读指纹文件;不存在返回 null;格式不对抛错(调用方决定报什么)。 */
export function loadFingerprint(path) {
  if (!existsSync(path)) return null
  const data = JSON.parse(readFileSync(path, 'utf8'))
  if (data?.api !== FINGERPRINT_API) throw new Error(`指纹 api=${JSON.stringify(data?.api)} 与支持的 ${FINGERPRINT_API} 不匹配`)
  if (!data.lines || typeof data.lines !== 'object') throw new Error('指纹缺 lines')
  if (!Array.isArray(data.reservedHeadings)) data.reservedHeadings = []
  return data
}

/**
 * 扫一份文本:返回 { headings: [{ line, heading }], runs: [{ start, end, count, source }] }。
 * 空行与短行是中性的(不计数、不打断);非命中的长行打断连续段;连续段 ≥ MIN_RUN 才报。
 */
export function scanText(text, fingerprint) {
  const reserved = new Set(fingerprint.reservedHeadings.map(normalizeHeading))
  const headings = []
  const runs = []
  let run = null
  const flush = () => { if (run && run.count >= MIN_RUN) runs.push(run); run = null }
  text.split(/\r?\n/).forEach((raw, idx) => {
    const n = idx + 1
    const h = raw.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
    if (h && reserved.has(normalizeHeading(h[1]))) headings.push({ line: n, heading: h[1].trim() })
    const norm = normalizeLine(raw)
    if (!isFingerprintable(norm)) return
    const source = fingerprint.lines[hashLine(norm)]
    if (source) {
      if (!run) run = { start: n, end: n, count: 0, source }
      run.end = n
      run.count++
    } else {
      flush()
    }
  })
  flush()
  return { headings, runs }
}

function parseArgs(argv) {
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) opts[a.slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
    else opts._.push(a)
  }
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const cmd = opts._[0]
  if (cmd !== 'generate' || !opts.rules || !opts.out || opts.rules === true || opts.out === true) {
    console.error('用法:node tools/fingerprint.mjs generate --rules <dir> --out <file> [--reserved "标题1,标题2"]')
    process.exit(2)
  }
  const reservedHeadings = typeof opts.reserved === 'string'
    ? opts.reserved.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_RESERVED_HEADINGS
  let fp
  try {
    fp = generateFingerprint({ rulesDir: opts.rules, reservedHeadings })
  } catch (e) {
    console.error(`fingerprint: ${e.message}`)
    process.exit(2)
  }
  const out = resolve(opts.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(fp, null, 2)}\n`)
  console.log(`fingerprint: 写入 ${out}(${Object.keys(fp.lines).length} 行指纹,${fp.reservedHeadings.length} 个保留标题)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
