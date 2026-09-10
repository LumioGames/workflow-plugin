// 规则指纹:生成器输出格式、归一化口径、保留标题与连续命中的判定,以及 core 里指纹项的接线。
//
// 存在的理由:「项目不抄插件任何一段」靠这一项变成机器可判——保留标题一出现就报,
// 连续 ≥ 3 行逐字相同就报行号;两行相同不报(引用一句话不算抄)。

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeLine, hashLine, generateFingerprint, loadFingerprint, scanText, DEFAULT_RESERVED_HEADINGS, FINGERPRINT_API,
} from '../plugin/tools/fingerprint.mjs'
import { runSpecLint, formatReport, PLUGIN_ROOT } from '../plugin/tools/spec-lint/core.mjs'
import { specFixture, writeFiles, makeTemp, cleanup } from './fixtures/w3/spec-fixture.mjs'

const GEN = join(PLUGIN_ROOT, 'tools', 'fingerprint.mjs')
const RULE_LINES = [
  '- **调度取向:快 > 稳 > 好。** 默认并行:文件集互不重叠即并行扇出;能继承上下文的 fork 优先于冷启动 worker。',
  '- **派 worker 三选一:** ① 多个互不依赖任务可并行 ② 改动大到撑爆编排上下文 ③ 需要隔离的干净实现环境。',
  '- **失败处理:** P0 / P1 → 附审查报告退回重做;同一问题三次不过 → 质疑方案。',
]
const RULES_MD = `# 插件调度规程\n\n## 调度核心\n\n${RULE_LINES.join('\n')}\n\n## 工程\n\n- 短行\n`

/** 在临时目录生成 plugin-rules/dispatch.md 与指纹文件,返回 { dir, fpFile }。 */
function rulesFixture(rulesMd = RULES_MD) {
  const dir = makeTemp('fp-')
  mkdirSync(join(dir, 'plugin-rules'))
  writeFileSync(join(dir, 'plugin-rules', 'dispatch.md'), rulesMd)
  const fpFile = join(dir, 'fp.json')
  writeFileSync(fpFile, JSON.stringify(generateFingerprint({ rulesDir: join(dir, 'plugin-rules') })))
  return { dir, fpFile }
}

describe('归一化', () => {
  test('去 markdown 标记与全部空白后相等;短行不入指纹', () => {
    assert.equal(normalizeLine('## 调度核心 ##'), '调度核心')
    assert.equal(normalizeLine('> - **加粗** 与 `代码` 和 [链接](x.md) | 表格'), '加粗与代码和链接表格')
    assert.equal(normalizeLine(RULE_LINES[0]), normalizeLine('调度取向:快 > 稳 > 好。默认并行:文件集互不重叠即并行扇出;能继承上下文的 fork 优先于冷启动 worker。'))
    assert.equal(hashLine('a'), hashLine('a'))
    assert.notEqual(hashLine('a'), hashLine('b'))
    const fp = generateFingerprint({ rulesDir: rulesFixture().dir + '/plugin-rules' })
    assert.equal(Object.keys(fp.lines).length, 3, '只有三条长行入指纹,标题与短行不入')
  })
})

describe('生成器', () => {
  test('CLI generate 写出 { api, reservedHeadings, lines: { sha1: "file:n" } },且只由 rules/ 内容决定', () => {
    const { dir } = rulesFixture()
    const out = join(dir, 'out', '.fingerprint.json')
    const stdout = execFileSync(process.execPath, [GEN, 'generate', '--rules', join(dir, 'plugin-rules'), '--out', out], { encoding: 'utf8' })
    assert.match(stdout, /3 行指纹,5 个保留标题/)
    const first = readFileSync(out, 'utf8')
    const fp = JSON.parse(first)
    assert.equal(fp.api, FINGERPRINT_API)
    // 幂等:规则没变,重跑必须写出同一份字节。带时间戳的字段会让每次重跑都产生 diff,
    // 「生成物只随生成源变」就失效——所以格式里不许有时间戳。
    execFileSync(process.execPath, [GEN, 'generate', '--rules', join(dir, 'plugin-rules'), '--out', out], { encoding: 'utf8' })
    assert.equal(readFileSync(out, 'utf8'), first, '重跑生成器产生了不同字节')
    assert.ok(!('generatedAt' in fp), '指纹不得记生成时间')
    assert.deepEqual(fp.reservedHeadings, DEFAULT_RESERVED_HEADINGS)
    assert.deepEqual(Object.values(fp.lines).sort(), ['plugin-rules/dispatch.md:5', 'plugin-rules/dispatch.md:6', 'plugin-rules/dispatch.md:7'])
    assert.ok(Object.keys(fp.lines).every((k) => /^[0-9a-f]{40}$/.test(k)))
    cleanup(dir)
  })

  test('--reserved 覆盖保留标题表;缺参数退出码 2', () => {
    const { dir } = rulesFixture()
    const out = join(dir, 'fp2.json')
    execFileSync(process.execPath, [GEN, 'generate', '--rules', join(dir, 'plugin-rules'), '--out', out, '--reserved', '甲, 乙'], { encoding: 'utf8' })
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).reservedHeadings, ['甲', '乙'])
    assert.throws(() => execFileSync(process.execPath, [GEN, 'generate', '--rules', join(dir, 'plugin-rules')], { stdio: 'pipe' }), (e) => e.status === 2)
    cleanup(dir)
  })
})

describe('扫描判定', () => {
  const fp = generateFingerprint({ rulesDir: join(rulesFixture().dir, 'plugin-rules') })

  test('保留标题命中(含括号补充、不同层级);非保留标题不报', () => {
    const { headings } = scanText('# 中心\n\n## 项目是什么\n\n### 调度核心(名册)\n\n## 安全/外发\n\n## 工程化实践\n', fp)
    assert.deepEqual(headings, [{ line: 5, heading: '调度核心(名册)' }, { line: 7, heading: '安全/外发' }])
  })

  test('连续 3 行逐字相同报行号范围;空行不打断;两行 + 一行自写不报', () => {
    const three = scanText(`# x\n\n${RULE_LINES[0]}\n\n${RULE_LINES[1]}\n${RULE_LINES[2]}\n`, fp)
    assert.deepEqual(three.runs, [{ start: 3, end: 6, count: 3, source: 'plugin-rules/dispatch.md:5' }])
    const two = scanText(`${RULE_LINES[0]}\n${RULE_LINES[1]}\n- 这一行是项目自己写的,足够长以打断连续段落的计数。\n${RULE_LINES[2]}\n`, fp)
    assert.deepEqual(two.runs, [])
    const stripped = scanText(RULE_LINES.map((l) => l.replace(/\*\*/g, '').replace(/^- /, '* ')).join('\n'), fp)
    assert.equal(stripped.runs.length, 1, '去掉强调标记、换列表符仍算逐字相同')
  })

  test('loadFingerprint:不存在返回 null;api 不匹配抛错', () => {
    assert.equal(loadFingerprint('/nonexistent/.fingerprint.json'), null)
    const dir = makeTemp('fpbad-')
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ api: 99, lines: {} }))
    assert.throws(() => loadFingerprint(join(dir, 'bad.json')), /api=99/)
    cleanup(dir)
  })
})

describe('过滤口径与注入一致', () => {
  // rules/README.md 是维护指南，inject-rules 明确不注入它。指纹若把它算进来，
  // 项目抄了里面的通用建议会被报成「抄了插件规则」，而指纹也不再等于「常驻规则」。
  test('README.md 与点开头文件不进指纹', () => {
    const dir = makeTemp('fp-filter-')
    writeFiles(dir, {
      'rules/system.md': '- 这一行是真规则,长度足够进指纹,应该被收进来。\n',
      'rules/README.md': '- 这一行在维护指南里,长度也足够,但绝不该进指纹。\n',
      'rules/.draft.md': '- 这一行在点开头的文件里,同样不该进指纹。\n',
    })
    const fp = generateFingerprint({ rulesDir: join(dir, 'rules') })
    const files = [...new Set(Object.values(fp.lines).map((v) => v.split(':')[0]))]
    cleanup(dir)
    assert.deepEqual(files, ['rules/system.md'], `只应收 system.md,实得:${files.join(', ')}`)
  })

  test('本仓指纹只覆盖两份常驻规则', () => {
    const fp = loadFingerprint(join(PLUGIN_ROOT, 'rules', '.fingerprint.json'))
    const files = [...new Set(Object.values(fp.lines).map((v) => v.split(':')[0]))].sort()
    assert.deepEqual(files, ['rules/dispatch.md', 'rules/system.md'])
  })
})

describe('core 接线', () => {
  test('临时项目:AGENTS.md 的「## 调度核心」与三行逐字复制各报一次;rules/ 与根 AGENTS.md 也扫', async () => {
    const { dir, fpFile } = rulesFixture()
    const root = specFixture({
      '.spec/AGENTS.md': `# 中心\n\n## 项目是什么\n\n测试。\n\n## 调度核心\n\n${RULE_LINES.join('\n')}\n`,
      '.spec/rules/system.md': `# 规则\n\n## 项目专属\n\n${RULE_LINES[0]}\n${RULE_LINES[1]}\n- 这一行是项目自己写的,足够长以打断连续段落的计数。\n${RULE_LINES[2]}\n`,
      'AGENTS.md': '# 指针\n\n## 宿主差异\n',
    })
    const result = await runSpecLint({ root, fingerprint: fpFile })
    cleanup(root); cleanup(dir)
    const fpFindings = result.findings.filter((f) => f.check === 'fingerprint').map((f) => `${f.file}: ${f.message}`)
    assert.deepEqual(fpFindings.map((s) => s.split(': ')[0]), ['.spec/AGENTS.md:7', '.spec/AGENTS.md:9-11', 'AGENTS.md:3'])
    assert.match(fpFindings[0], /项目抄了插件保留段:标题「调度核心」/)
    assert.match(fpFindings[1], /连续 3 行与插件规则逐字相同\(始于插件 plugin-rules\/dispatch\.md:5\)/)
    assert.match(fpFindings[2], /标题「宿主差异」/)
    assert.equal(result.checks.find((c) => c.id === 'fingerprint').scanned, 4, '扫描面含仓根 CLAUDE.md')
    assert.equal(result.checks.at(-1).id, 'fingerprint', '指纹永远是最后一项')
    assert.match(formatReport(result), /指纹 .*扫描 4 个文件.*3 处命中/)
  })

  test('原样抄进仓根 CLAUDE.md 也要报——它才是 Claude Code 的实际生效入口', async () => {
    // 回归锚点：扫描面原先只有 .spec/AGENTS.md、.spec/rules/、仓根 AGENTS.md。
    // 把整段插件规则抄进 CLAUDE.md 是零命中的，而 Claude Code 读的恰恰是 CLAUDE.md。
    const { dir, fpFile } = rulesFixture()
    const root = specFixture({ 'CLAUDE.md': `# 入口\n\n## 调度核心\n\n${RULE_LINES.join('\n')}\n` })
    const result = await runSpecLint({ root, fingerprint: fpFile })
    cleanup(root); cleanup(dir)

    const hits = result.findings.filter((f) => f.check === 'fingerprint').map((f) => `${f.file}: ${f.message}`)
    assert.ok(hits.some((h) => h.startsWith('CLAUDE.md:3')), `CLAUDE.md 的保留标题应被抓到:${hits.join(' | ')}`)
    assert.ok(hits.some((h) => /CLAUDE\.md:5-7.*连续 3 行/.test(h)), `CLAUDE.md 的逐字复制应被抓到:${hits.join(' | ')}`)
  })

  test('「工程」这类通用标题不在保留表里——项目正当地用同名小节不该被判成抄袭', async () => {
    const { dir, fpFile } = rulesFixture()
    const root = specFixture({ '.spec/rules/system.md': '# 项目规则\n\n## 工程\n\n本项目用 Cargo 构建,提交前跑 cargo clippy 与 cargo test。\n' })
    const result = await runSpecLint({ root, fingerprint: fpFile })
    cleanup(root); cleanup(dir)

    const hits = result.findings.filter((f) => f.check === 'fingerprint')
    assert.deepEqual(hits, [], `与插件无关的「工程」小节不该命中:${hits.map((h) => h.message).join(' | ')}`)
  })

  test('插件未提供指纹文件 → 本项跳过而不是报错;指纹文件坏了 → 报错', async () => {
    const root = specFixture()
    const missing = await runSpecLint({ root, fingerprint: join(root, 'nope.json') })
    assert.equal(missing.checks.at(-1).status, 'skipped')
    assert.equal(missing.ok, true, formatReport(missing))
    writeFileSync(join(root, 'bad.json'), '{"api": 0}')
    const bad = await runSpecLint({ root, fingerprint: join(root, 'bad.json') })
    cleanup(root)
    assert.match(bad.findings.at(-1).message, /指纹文件不可用/)
  })

  test('插件根 rules/.fingerprint.json 若已生成,则对干净项目零命中(默认路径接线)', async () => {
    const root = specFixture()
    const result = await runSpecLint({ root })
    cleanup(root)
    const fp = result.checks.at(-1)
    assert.ok(['skipped', 'ok'].includes(fp.status), formatReport(result))
    assert.match(result.fingerprint.path, /rules[\\/]\.fingerprint\.json$/)
  })
})
