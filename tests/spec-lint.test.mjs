// spec-lint 通用项:在临时目录搭 fixture 项目,断言各类违规被抓、合法项目全绿、退出码语义正确。
//
// 存在的理由:lint 抓的是「不报错但规则悄悄失效」的坑(@import 漏行、知识文档没进导航、死链接、
// ADR 撞号),这些坑只有机器能稳定抓;每条断言对应一种曾经静默入库过的漂移。
// 指纹检查在这里一律关闭(fingerprint: null / --no-fingerprint),单独在 spec-lint-fingerprint.test.mjs 测。

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSpecLint, formatReport, DEFAULT_CONFIG } from '../plugin/tools/spec-lint/core.mjs'
import { CORE_CHECKS } from '../plugin/tools/spec-lint/checks/index.mjs'
import { specFixture, withDecisions, writeFiles, gitInit, cleanup, makeTemp, PLUGIN_ROOT } from './fixtures/w3/spec-fixture.mjs'

const BIN = join(PLUGIN_ROOT, 'bin', 'spec-lint.mjs')

async function lint(root, options = {}) {
  try {
    return await runSpecLint({ root, fingerprint: null, ...options })
  } finally {
    cleanup(root)
  }
}
const messages = (result, check) =>
  result.findings.filter((f) => !check || f.check === check).map((f) => `${f.file}: ${f.message}`)
const status = (result, id) => result.checks.find((c) => c.id === id)?.status

function cli(root, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, root, '--no-fingerprint', ...args], { encoding: 'utf8' })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  } finally {
    cleanup(root)
  }
}

describe('基线', () => {
  test('最小合法项目全绿,通用项固定顺序全部执行', async () => {
    const result = await lint(specFixture())
    assert.equal(result.ok, true, formatReport(result))
    assert.equal(result.errors, 0)
    assert.deepEqual(result.checks.filter((c) => c.source === 'core').map((c) => c.id), CORE_CHECKS.map((c) => c.id))
    assert.match(formatReport(result), /spec-lint: OK/)
  })

  test('没有 .spec/ 时给一条可读报错,不崩栈,其余通用项不执行', async () => {
    const root = makeTemp('nospec-')
    const result = await lint(root)
    assert.equal(result.ok, false)
    assert.match(messages(result)[0], /缺 \.spec\/ 目录/)
    assert.deepEqual(result.checks.map((c) => c.id), ['core-files', 'fingerprint'])
  })

  test('核心文件:仓根 CLAUDE.md 与 AGENTS.md 缺一即报;无 CLAUDE.md 时 @import 项跳过', async () => {
    const none = await lint(specFixture({ 'CLAUDE.md': null, 'AGENTS.md': null }))
    const noneMsgs = messages(none, 'core-files').join('\n')
    assert.match(noneMsgs, /仓根须有 CLAUDE\.md/)
    assert.match(noneMsgs, /仓根须有 AGENTS\.md/)
    const noClaude = await lint(specFixture({ 'CLAUDE.md': null }))
    assert.match(messages(noClaude, 'core-files').join('\n'), /仓根须有 CLAUDE\.md/)
    assert.equal(status(noClaude, 'imports'), 'skipped')
    const noAgents = await lint(specFixture({ 'AGENTS.md': null }))
    assert.match(messages(noAgents, 'core-files').join('\n'), /仓根须有 AGENTS\.md/)
    const missingNav = await lint(specFixture({ '.spec/knowledge/README.md': null }))
    assert.match(messages(missingNav, 'core-files').join('\n'), /缺核心文件:\.spec\/knowledge\/README\.md/)
    assert.equal(status(missingNav, 'nav-coverage'), 'skipped')
  })
})

describe('frontmatter', () => {
  test('缺 frontmatter / 缺字段 / status 非枚举 / 多行 description / 超长 description 各被抓', async () => {
    const fm = (status, description = '一句话') =>
      `---\nname: x\ndescription: ${description}\nmetadata:\n  type: doc\n  status: ${status}\n---\n\n# x\n`
    const result = await lint(specFixture({
      '.spec/knowledge/standards/bare.md': '# 裸文档\n',
      '.spec/knowledge/standards/nofield.md': '---\nname: nofield\n---\n\n# x\n',
      '.spec/knowledge/standards/bad-status.md': fm('草稿'),
      '.spec/knowledge/standards/multiline.md': '---\nname: m\ndescription: >-\n  很长\nmetadata:\n  type: doc\n  status: 已交付\n---\n',
      '.spec/knowledge/standards/long.md': fm('已交付', '长'.repeat(121)),
    }))
    const out = messages(result, 'frontmatter').join('\n')
    assert.match(out, /bare\.md: 缺少 frontmatter/)
    assert.match(out, /nofield\.md: frontmatter 缺 description/)
    assert.match(out, /nofield\.md: frontmatter 缺 metadata\.status/)
    assert.match(out, /status「草稿」不在枚举/)
    assert.match(out, /multiline\.md: description 必须单行明文/)
    assert.match(out, /long\.md: description 超过 120 字符\(121\)/)
  })

  test('plans / reviews 默认在 frontmatter 目录里,但不要求进知识导航;README.md 不校验', async () => {
    const result = await lint(specFixture({
      '.spec/plans/2026-01-01-p.md': '# 计划,无 frontmatter\n',
      '.spec/plans/README.md': '# 目录说明\n',
      '.spec/reviews/2026-01-01-r.md': '---\nname: r\ndescription: 审查\nmetadata:\n  type: doc\n  status: 已交付\n---\n',
    }))
    const out = messages(result).join('\n')
    assert.match(out, /plans\/2026-01-01-p\.md: 缺少 frontmatter/)
    assert.doesNotMatch(out, /README\.md: 缺少 frontmatter/)
    assert.doesNotMatch(out, /reviews/)
    assert.doesNotMatch(out, /未登记进 knowledge\/README\.md/)
  })

  test('默认配置对「plans 带完整 frontmatter + ADR 用 Accepted」的项目风格不误报', async () => {
    const root = specFixture({
      '.spec/plans/2026-09-10-x.md': '---\nname: 2026-09-10-x\ndescription: 派活提示词\nmetadata:\n  type: doc\n  status: 设计中\n---\n\n# x\n',
    })
    withDecisions(root, { 'ADR-088-x.md': '# ADR-088:x\n\n状态：Accepted（2026-09-10 Owner 裁决）\n' })
    const result = await lint(root)
    assert.equal(result.ok, true, formatReport(result))
  })
})

describe('导航与索引覆盖', () => {
  test('knowledge 根、features、standards 未登记导航被抓', async () => {
    const doc = '---\nname: h\ndescription: 隐身\nmetadata:\n  type: doc\n  status: 设计中\n---\n'
    const result = await lint(specFixture({
      '.spec/knowledge/standards/hidden.md': doc,
      '.spec/knowledge/features/deep/hidden.md': doc,
      '.spec/knowledge/lessons.md': doc,
    }))
    const out = messages(result, 'nav-coverage').join('\n')
    assert.match(out, /standards\/hidden\.md: 未登记进 knowledge\/README\.md 导航/)
    assert.match(out, /features\/deep\/hidden\.md: 未登记/)
    assert.match(out, /lessons\.md: 未登记/)
  })

  test('导航链接到目录时,视为登记了该目录的 index.md', async () => {
    const nav = `${specFixtureNav()}| [\`features/pkg/\`](features/pkg/) | 包 |\n`
    const result = await lint(specFixture({
      '.spec/knowledge/README.md': nav,
      '.spec/knowledge/features/pkg/index.md': '---\nname: pkg\ndescription: 包\nmetadata:\n  type: index\n  status: 已交付\n---\n',
    }))
    assert.equal(result.ok, true, formatReport(result))
  })

  test('ADR 未登记进 decisions/README.md 被抓;缺索引文件也报', async () => {
    const root = withDecisions(specFixture(), { 'ADR-001-a.md': '# a\n\n状态：Accepted\n' })
    writeFileSync(join(root, '.spec/decisions/ADR-002-b.md'), '# b\n\n状态：Draft\n')
    const result = await lint(root)
    assert.match(messages(result, 'adr-index').join('\n'), /ADR-002-b\.md: 未登记进 decisions\/README\.md 索引/)
    const noIndex = specFixture()
    mkdirSync(join(noIndex, '.spec/decisions'))
    writeFileSync(join(noIndex, '.spec/decisions/ADR-001-a.md'), '# a\n\n状态：Accepted\n')
    assert.match(messages(await lint(noIndex), 'adr-index').join('\n'), /缺 decisions\/README\.md 索引/)
  })
})

function specFixtureNav() {
  return [
    '---', 'name: knowledge', 'description: 导航', 'metadata:', '  type: index', '---', '',
    '| 文档 | 一句话 |', '|------|--------|',
    '| [`standards/workflow.md`](standards/workflow.md) | 工作流 |',
    '| [`features/_TEMPLATE.md`](features/_TEMPLATE.md) | 模板 |', '',
  ].join('\n')
}

describe('链接与 @import', () => {
  test('悬空链接被抓;围栏 / 行内代码里的不算;指向仓外的跳过;根 README / AGENTS 也扫', async () => {
    const result = await lint(specFixture({
      '.spec/AGENTS.md': '# 中心\n\n[坏](nowhere.md) [外](../../sibling-repo/x.md)\n\n```\n[代码](fake.md)\n```\n`[行内](fake2.md)`\n',
      'README.md': '# R\n\n[坏](missing.md)\n',
    }))
    const out = messages(result, 'links').join('\n')
    assert.match(out, /\.spec\/AGENTS\.md: 悬空链接:nowhere\.md/)
    assert.match(out, /README\.md: 悬空链接:missing\.md/)
    assert.doesNotMatch(out, /sibling-repo|fake\.md|fake2\.md/)
  })

  test('rules/ 新文件与 knowledge 导航缺 @import 行被抓;只查项目里存在的文件', async () => {
    const result = await lint(specFixture({
      '.spec/rules/extra.md': '# 另一份\n',
      'CLAUDE.md': '# C\n\n@.spec/AGENTS.md\n\n@.spec/rules/system.md\n',
    }))
    const out = messages(result, 'imports').join('\n')
    assert.match(out, /缺 @import 行:@\.spec\/rules\/extra\.md/)
    assert.match(out, /缺 @import 行:@\.spec\/knowledge\/README\.md/)
    assert.doesNotMatch(out, /@\.spec\/rules\/system\.md/)
    const noRules = await lint(specFixture({ '.spec/rules/system.md': null, 'CLAUDE.md': '@.spec/AGENTS.md\n@.spec/knowledge/README.md\n' }))
    assert.equal(status(noRules, 'imports'), 'ok', formatReport(noRules))
  })
})

describe('agents / skills / 软链', () => {
  test('agents 允许 tools / disallowedTools(行内或块列表),多出其它键或 name 不一致被抓', async () => {
    const ok = await lint(specFixture({
      '.spec/agents/reviewer.agent.md': '---\nname: reviewer\ndescription: 审\ntools: ["Read", "Grep"]\ndisallowedTools:\n  - Bash\n---\n',
      '.spec/agents/plain.md': '---\nname: plain\ndescription: 平\ndisallowedTools: [Bash]\n---\n',
    }))
    assert.equal(status(ok, 'agents-frontmatter'), 'ok', formatReport(ok))
    // tools 是宿主官方字段（工具白名单），不再算规范外；反例换成真正不被宿主据以调度的键。
    const bad = await lint(specFixture({
      '.spec/agents/coder.agent.md': '---\nname: other\ndescription: 写\nrole: implementer\n---\n',
    }))
    const out = messages(bad, 'agents-frontmatter').join('\n')
    assert.match(out, /多出:role/)
    assert.match(out, /name「other」与文件名「coder」不一致/)
  })

  test('skills 只允许 name + description,name 须与目录名一致', async () => {
    const result = await lint(specFixture({
      '.spec/skills/demo/SKILL.md': '---\nname: demo2\ndescription: 演示\nversion: 1\n---\n',
    }))
    const out = messages(result, 'skills-frontmatter').join('\n')
    assert.match(out, /多出:version/)
    assert.match(out, /name「demo2」与目录名「demo」不一致/)
  })

  test('软链不存在不报;是软链才查:悬空、指向 .spec 之外各被抓;普通目录不报', async () => {
    const absent = await lint(specFixture({}, { links: false }))
    assert.equal(status(absent, 'symlinks'), 'ok', formatReport(absent))
    const outside = await lint(specFixture({ '.spec-evil/skills/x.md': '# x\n' }, { linkOverrides: { '.claude/skills': '../.spec-evil/skills' } }))
    assert.match(messages(outside, 'symlinks').join('\n'), /\.claude\/skills: 软链接未解析进 \.spec\//)
    const dangling = specFixture({}, { linkOverrides: { '.agents/skills': null } })
    symlinkSync('../nowhere', join(dangling, '.agents/skills'))
    assert.match(messages(await lint(dangling), 'symlinks').join('\n'), /\.agents\/skills: 软链接悬空/)
    const realDir = specFixture({}, { linkOverrides: { '.claude/skills': null } })
    mkdirSync(join(realDir, '.claude/skills/local'), { recursive: true })
    const rd = await lint(realDir)
    assert.equal(status(rd, 'symlinks'), 'ok', formatReport(rd))
  })
})

describe('ADR', () => {
  test('同目录撞号被抓;子目录自成一套编号,与根同号不算撞', async () => {
    const root = withDecisions(specFixture(), {
      'ADR-050-x.md': '# x\n\n状态：Draft\n',
      'ADR-050-y.md': '# y\n\n状态：Draft\n',
      'nativecore/0050-a.md': '# a\n\n- 状态:生效\n',
      'nativecore/0001-b.md': '# b\n\n- 状态:生效\n',
      'nativecore/0001-c.md': '# c\n\n- 状态:生效\n',
    })
    const out = messages(await lint(root), 'adr-unique-id').join('\n')
    assert.match(out, /ADR 编号 ADR-050 撞号:ADR-050-x\.md \/ ADR-050-y\.md/)
    assert.match(out, /ADR 编号 0001 撞号:0001-b\.md \/ 0001-c\.md/)
    assert.doesNotMatch(out, /0050/)
  })

  test('状态行:两种写法、括号补充、Historical 前缀、「被 [x](y) 取代」都合法;缺行与非枚举被抓', async () => {
    const ok = await lint(withDecisions(specFixture(), {
      'ADR-001-a.md': '# a\n\n状态：Accepted（2026-09-10 Owner 裁决）\n',
      'ADR-002-b.md': '# b\n\n- **Status**: Historical · Accepted (旧基线)\n',
      'ADR-003-c.md': '# c\n\n- 状态:生效\n',
      'ADR-004-d.md': '# d\n\n- 状态:部分被 [ADR-001](ADR-001-a.md) 取代\n',
    }))
    assert.equal(status(ok, 'adr-status'), 'ok', formatReport(ok))
    const bad = await lint(withDecisions(specFixture(), {
      'ADR-001-a.md': '# a\n\n没有状态行。\n',
      'ADR-002-b.md': '# b\n\n- **Status**: Cooking\n',
    }))
    const out = messages(bad, 'adr-status').join('\n')
    assert.match(out, /ADR-001-a\.md: ADR 前 12 行内缺状态行/)
    assert.match(out, /ADR 状态「Cooking」不在枚举/)
  })
})

describe('禁并行文档根', () => {
  test('git 索引里的 docs/specs、docs/plans、嵌套 .sdd 与第二个 .spec 被抓;templates/.spec 与 .workflow-drafts 不报', async () => {
    const root = gitInit(specFixture({
      'docs/specs/x.md': '# x\n',
      'docs/plans/y.md': '# y\n',
      'engine/.sdd/z.md': '# z\n',
      'engine/native/.spec/AGENTS.md': '# 第二套\n',
      'templates/.spec/AGENTS.md': '# 模板\n',
      '.workflow-drafts/b1/manifest.json': '{}\n',
    }))
    const result = await lint(root)
    const out = messages(result, 'doc-roots').join('\n')
    assert.match(out, /docs\/specs: 并行文档根/)
    assert.match(out, /docs\/plans: 并行文档根/)
    assert.match(out, /engine\/\.sdd: 并行文档根/)
    assert.match(out, /engine\/native\/\.spec: 仓根之外出现第二个 \.spec\//)
    const files = result.findings.filter((f) => f.check === 'doc-roots').map((f) => f.file)
    assert.deepEqual(files, ['docs/specs', 'docs/plans', 'engine/.sdd', 'engine/native/.spec'])
  })

  test('非 git 仓库只查仓根:根层 .sdd/ 仍被抓,本项标记跳过', async () => {
    const root = specFixture()
    mkdirSync(join(root, '.sdd'))
    const result = await lint(root)
    assert.equal(status(result, 'doc-roots'), 'skipped')
    assert.match(messages(result, 'doc-roots').join('\n'), /\.sdd: 并行文档根/)
  })
})

describe('CLI 与退出码', () => {
  test('默认退出码恒 0(有错误也是);--strict 才 1;全绿 --strict 也是 0', () => {
    const red = cli(specFixture({ '.spec/AGENTS.md': '[坏](nowhere.md)\n' }))
    assert.equal(red.code, 0)
    assert.match(red.stdout, /1 处不一致\(只报告不阻断/)
    const strictRed = cli(specFixture({ '.spec/AGENTS.md': '[坏](nowhere.md)\n' }), ['--strict'])
    assert.equal(strictRed.code, 1)
    const strictGreen = cli(specFixture(), ['--strict'])
    assert.equal(strictGreen.code, 0, strictGreen.stdout)
    assert.match(strictGreen.stdout, /spec-lint: OK/)
  })

  test('--json 输出可解析的完整结果;未知参数退出码 2', () => {
    const { code, stdout } = cli(specFixture(), ['--json'])
    assert.equal(code, 0)
    const parsed = JSON.parse(stdout)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.api, 1)
    assert.ok(Array.isArray(parsed.checks) && parsed.checks.length === CORE_CHECKS.length + 1)
    assert.equal(parsed.fingerprint.path, null)
    const bad = cli(specFixture(), ['--bogus'])
    assert.equal(bad.code, 2)
    assert.match(bad.stderr, /未知参数/)
  })

  test('DEFAULT_CONFIG 同时接受 Accepted 与 生效 两套 ADR 状态', () => {
    for (const s of ['Historical', 'Draft', 'Accepted', 'Reserved', 'Superseded', '生效', '废止']) {
      assert.ok(DEFAULT_CONFIG.adrStatusEnum.includes(s), s)
    }
  })
})
