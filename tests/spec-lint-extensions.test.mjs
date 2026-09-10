// spec-lint 扩展契约(api = 1):项目 .spec/tools/lint-extensions.mjs 的加载、拒绝、配置与 disable 语义。
//
// 存在的理由:扩展是项目把自己的结构约束挂进同一份报告的唯一入口;api 不匹配必须报错而不是静默跳过
//(fail-open 会让项目以为扩展在跑),config 的替换语义与 fingerprint 不可关闭都是契约的一部分。

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSpecLint, formatReport } from '../tools/spec-lint/core.mjs'
import { generateFingerprint } from '../tools/fingerprint.mjs'
import { specFixture, withDecisions, writeFiles, cleanup, REPO_ROOT } from './fixtures/w3/spec-fixture.mjs'

const EXT = '.spec/tools/lint-extensions.mjs'
async function lint(root, options = {}) {
  try { return await runSpecLint({ root, fingerprint: null, ...options }) } finally { cleanup(root) }
}
const messages = (result, check) =>
  result.findings.filter((f) => !check || f.check === check).map((f) => `[${f.level}] ${f.file}: ${f.message}`)
const status = (result, id) => result.checks.find((c) => c.id === id)?.status

const ext = (body) => `export const api = 1\n${body}\n`

describe('加载与拒绝', () => {
  test('扩展加载后其检查项在通用项之后执行,报告列出 id 与状态', async () => {
    const result = await lint(specFixture({
      [EXT]: ext(`export const checks = [
        { id: 'my-check', run({ spec, report }) { report(spec + '/AGENTS.md', '扩展报的问题') } },
        { id: 'my-skip', run() { return { skipped: '没有校验面' } } },
      ]`),
    }))
    assert.equal(result.extension.status, 'loaded')
    assert.deepEqual(result.extension.checks, ['my-check', 'my-skip'])
    const ids = result.checks.map((c) => c.id)
    assert.ok(ids.indexOf('my-check') > ids.indexOf('doc-roots'))
    assert.ok(ids.indexOf('my-check') < ids.indexOf('fingerprint'))
    assert.equal(status(result, 'my-check'), 'reported')
    assert.equal(status(result, 'my-skip'), 'skipped')
    assert.deepEqual(messages(result, 'my-check'), ['[error] .spec/AGENTS.md: 扩展报的问题'])
    assert.match(formatReport(result), /已加载 api=1,2 项/)
  })

  test('api 不匹配即报错,扩展不加载(不 fail-open),通用项按默认配置照跑', async () => {
    const result = await lint(specFixture({
      [EXT]: `export const api = 2\nexport const checks = [{ id: 'never', run({ report }) { report('x', 'y') } }]\n`,
    }))
    assert.equal(result.extension.status, 'rejected')
    assert.equal(result.extension.api, 2)
    assert.match(messages(result, 'extension').join('\n'), /api=2 与 core 支持的 api=1 不匹配——扩展未加载/)
    assert.equal(result.ok, false)
    assert.equal(status(result, 'never'), undefined)
    assert.equal(status(result, 'core-files'), 'ok')
    const noApi = await lint(specFixture({ [EXT]: 'export const checks = []\n' }))
    assert.match(messages(noApi, 'extension').join('\n'), /api=null 与 core 支持的 api=1 不匹配/)
  })

  test('扩展文件语法错误 → 报「加载失败」而不是崩栈', async () => {
    const result = await lint(specFixture({ [EXT]: 'export const api = 1\nthis is not js\n' }))
    assert.equal(result.extension.status, 'failed')
    assert.match(messages(result, 'extension').join('\n'), /扩展加载失败/)
  })

  test('扩展项抛异常 → 该项标记 crashed 并报错,其余项继续', async () => {
    const result = await lint(specFixture({
      [EXT]: ext(`export const checks = [
        { id: 'boom', run() { throw new Error('炸了') } },
        { id: 'after', run({ report }) { report('a.md', '后面的还在跑', 'warn') } },
      ]`),
    }))
    assert.equal(status(result, 'boom'), 'crashed')
    assert.match(messages(result, 'boom').join('\n'), /检查项 boom 执行异常:炸了/)
    assert.equal(status(result, 'after'), 'reported')
    assert.equal(result.warnings, 1)
  })

  test('check id 与通用项重名、或形状不对 → 报错并忽略该项', async () => {
    const result = await lint(specFixture({
      [EXT]: ext(`export const checks = [
        { id: 'links', run() {} },
        { id: 'fingerprint', run() {} },
        { id: 'dup', run() {} }, { id: 'dup', run() {} },
        { run() {} },
      ]`),
    }))
    const out = messages(result, 'extension').join('\n')
    assert.match(out, /「links」与通用项或其它扩展项重名/)
    assert.match(out, /「fingerprint」与通用项或其它扩展项重名/)
    assert.match(out, /「dup」与通用项或其它扩展项重名/)
    assert.match(out, /每一项必须是 \{ id: string, run\(ctx\) \}/)
    assert.deepEqual(result.extension.checks, ['dup'])
  })

  test('extensions 参数:字符串指定路径、对象直接当模块、null 不加载', async () => {
    const byPath = await lint(specFixture({ 'custom/ext.mjs': ext(`export const checks = [{ id: 'p', run() {} }]`) }), { extensions: 'custom/ext.mjs' })
    assert.deepEqual(byPath.extension.checks, ['p'])
    const inline = await lint(specFixture(), { extensions: { api: 1, checks: [{ id: 'i', run() {} }] } })
    assert.deepEqual(inline.extension.checks, ['i'])
    assert.equal(inline.extension.path, '(inline)')
    const off = await lint(specFixture({ [EXT]: ext(`export const checks = [{ id: 'x', run() {} }]`) }), { extensions: null })
    assert.equal(off.extension.status, 'off')
    assert.deepEqual(off.extension.checks, [])
  })

  test('ctx 提供 walk / parseFrontmatter / mdLinks / gitLsFiles / config / report(level)', async () => {
    const result = await lint(specFixture({
      [EXT]: ext(`export const checks = [{ id: 'ctx', async run(ctx) {
        const docs = ctx.walk(ctx.spec + '/knowledge', (p) => p.endsWith('.md'))
        const fm = ctx.parseFrontmatter(ctx.spec + '/knowledge/standards/workflow.md')
        const links = ctx.mdLinks(ctx.spec + '/knowledge/README.md')
        const ls = ctx.gitLsFiles()
        ctx.report('ctx.md', [docs.length, fm['metadata.status'], links.length, ls === null ? 'null' : ls.length, ctx.config.statusEnum.length].join('|'), 'info')
      } }]`),
    }))
    assert.deepEqual(messages(result, 'ctx'), ['[info] ctx.md: 3|已交付|2|null|4'])
    assert.equal(result.errors, 0)
  })
})

describe('config', () => {
  test('statusEnum / adrStatusEnum / frontmatterDirs 整体替换默认值', async () => {
    const root = withDecisions(specFixture({
      [EXT]: ext(`export const config = {
        statusEnum: ['草稿'],
        adrStatusEnum: ['生效'],
        frontmatterDirs: ['knowledge/standards'],
      }`),
      '.spec/knowledge/standards/workflow.md': '---\nname: workflow\ndescription: 工作流\nmetadata:\n  type: doc\n  status: 草稿\n---\n',
      '.spec/knowledge/features/_TEMPLATE.md': '# 不再要求 frontmatter\n',
      '.spec/plans/p.md': '# 也不要求\n',
    }), { 'ADR-001-a.md': '# a\n\n状态：Accepted\n', 'ADR-002-b.md': '# b\n\n- 状态:生效\n' })
    const result = await lint(root)
    const out = messages(result).join('\n')
    assert.doesNotMatch(out, /草稿|_TEMPLATE|plans\/p\.md/)
    assert.match(out, /ADR-001-a\.md: ADR 状态「Accepted」不在枚举\(生效\)/)
    assert.doesNotMatch(out, /ADR-002/)
  })

  test('disable 关掉通用项;fingerprint 不可关(提醒并照跑);未知 id 与未知 config 键给提醒', async () => {
    const root = specFixture({
      [EXT]: ext(`export const config = { disable: ['symlinks', 'links', 'fingerprint', 'nope'], bogus: [] }`),
      '.spec/AGENTS.md': '# 中心\n\n## 调度核心\n\n[坏](nowhere.md)\n',
    })
    const fpDir = join(root, 'plugin-rules')
    mkdirSync(fpDir)
    writeFileSync(join(fpDir, 'r.md'), '## 调度核心\n')
    const fpFile = join(root, 'fp.json')
    writeFileSync(fpFile, JSON.stringify(generateFingerprint({ rulesDir: fpDir })))
    const result = await lint(root, { fingerprint: fpFile })
    assert.equal(status(result, 'symlinks'), 'disabled')
    assert.equal(status(result, 'links'), 'disabled')
    assert.doesNotMatch(messages(result, 'links').join('\n'), /nowhere/)
    assert.equal(status(result, 'fingerprint'), 'reported')
    assert.match(messages(result, 'fingerprint').join('\n'), /标题「调度核心」/)
    const warns = messages(result, 'extension').join('\n')
    assert.match(warns, /\[warn\].*fingerprint 不可 disable/)
    assert.match(warns, /\[warn\].*「nope」不是已知检查项/)
    assert.match(warns, /\[warn\].*未知键「bogus」/)
  })

  test('config 值不是字符串数组 → 报错并沿用默认值', async () => {
    const result = await lint(specFixture({ [EXT]: ext(`export const config = { statusEnum: '已交付' }`) }))
    assert.match(messages(result, 'extension').join('\n'), /config\.statusEnum 必须是字符串数组/)
    assert.equal(status(result, 'frontmatter'), 'ok')
  })
})

describe('templates 里的样例扩展', () => {
  const SAMPLE = readFileSync(join(REPO_ROOT, 'templates/.spec/tools/lint-extensions.mjs'), 'utf8')

  test('样例按 api=1 加载出两项,在没有校验面的项目上一项跳过一项通过', async () => {
    const result = await lint(specFixture({ [EXT]: SAMPLE }))
    assert.equal(result.extension.status, 'loaded')
    assert.deepEqual(result.extension.checks, ['docs-adr-mirror', 'adr-draft-backref'])
    assert.equal(result.ok, true, formatReport(result))
    assert.equal(status(result, 'docs-adr-mirror'), 'skipped')
  })

  test('docs-adr-mirror:有 docs/adr/ 时,普通文件副本与缺失镜像被抓,正确软链通过', async () => {
    const root = withDecisions(specFixture({ [EXT]: SAMPLE }), {
      'ADR-001-a.md': '# a\n\n状态：Accepted\n',
      'ADR-002-b.md': '# b\n\n状态：Accepted\n',
      'ADR-003-c.md': '# c\n\n状态：Accepted\n',
    })
    mkdirSync(join(root, 'docs/adr'), { recursive: true })
    symlinkSync('../../.spec/decisions/ADR-001-a.md', join(root, 'docs/adr/ADR-001-a.md'))
    writeFileSync(join(root, 'docs/adr/ADR-002-b.md'), '副本\n')
    const out = messages(await lint(root), 'docs-adr-mirror').join('\n')
    assert.doesNotMatch(out, /ADR-001/)
    assert.match(out, /docs\/adr\/ADR-002-b\.md: 镜像必须是软链/)
    assert.match(out, /docs\/adr\/ADR-003-c\.md: 镜像缺失/)
  })

  test('adr-draft-backref:Draft ADR 兼容影响点名的知识文档未回指被抓;Accepted 不查', async () => {
    const root = withDecisions(specFixture({ [EXT]: SAMPLE }), {
      'ADR-001-a.md': '# a\n\n状态：Draft\n\n## 兼容影响\n\n- `workflow.md` 改口;knowledge/features/_TEMPLATE.md 也改。\n',
      'ADR-002-b.md': '# b\n\n状态：Accepted\n\n## 兼容影响\n\n- `workflow.md`\n',
    })
    writeFiles(root, {
      '.spec/knowledge/features/_TEMPLATE.md': '---\nname: template\ndescription: 模板\nmetadata:\n  type: doc\n  status: 设计中\n---\n\n按 ADR-001 改。\n',
    })
    const out = messages(await lint(root), 'adr-draft-backref').join('\n')
    assert.match(out, /standards\/workflow\.md: 被 ADR-001「兼容影响」点名,但正文未回指 ADR-001/)
    assert.doesNotMatch(out, /_TEMPLATE|ADR-002/)
  })
})
