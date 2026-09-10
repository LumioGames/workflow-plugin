// init-scaffold:生成项目骨架的确定性——只生成项目专属七件、不覆盖、可反复跑、不写 .workflow,生成物过 lint。
//
// 存在的理由:init 是用户会反复跑的命令(升级插件后再跑),损毁已有内容的代价远高于少写一个文件;
// 而骨架本身必须 lint 绿,否则用户第一次跑 /workflow:lint 就红,分不清是自己的问题还是模板的问题。

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { initScaffold, IMPORT_LINES, WORKFLOW_NOTE } from '../plugin/tools/init-scaffold.mjs'
import { runSpecLint, formatReport } from '../plugin/tools/spec-lint/core.mjs'
import { makeTemp, cleanup, PLUGIN_ROOT } from './fixtures/w3/spec-fixture.mjs'

const SCRIPT = join(PLUGIN_ROOT, 'tools', 'init-scaffold.mjs')
const EXPECTED = [
  '.spec/AGENTS.md',
  '.spec/decisions/README.md',
  '.spec/knowledge/README.md',
  '.spec/knowledge/features/_TEMPLATE.md',
  '.spec/rules/system.md',
  '.spec/tools/lint-extensions.mjs',
  'CLAUDE.md',
]

describe('生成集合', () => {
  test('空目录:恰好生成项目专属七件;不生成 tasks / plans / .workflow', () => {
    const target = makeTemp('init-')
    const r = initScaffold({ pluginRoot: PLUGIN_ROOT, target })
    assert.deepEqual(r.created, EXPECTED)
    assert.deepEqual(r.skipped, [])
    assert.deepEqual(r.imports, [])
    for (const rel of ['.spec/tasks', '.spec/plans', '.workflow', '.spec/knowledge/standards']) {
      assert.equal(existsSync(join(target, rel)), false, `${rel} 不该生成`)
    }
    const claude = readFileSync(join(target, 'CLAUDE.md'), 'utf8')
    for (const line of IMPORT_LINES) assert.match(claude, new RegExp(`^${line}$`, 'm'))
    cleanup(target)
  })

  test('templates/ 下只有 .spec/,且没有 tasks / plans 子目录(模板本身也守分工)', () => {
    assert.deepEqual(readdirSync(join(PLUGIN_ROOT, 'templates')), ['.spec'])
    const spec = readdirSync(join(PLUGIN_ROOT, 'templates', '.spec')).sort()
    assert.deepEqual(spec, ['AGENTS.md', 'decisions', 'knowledge', 'rules', 'tools'])
  })

  test('模板里没有旧制度词汇与插件保留标题', () => {
    const banned = ['契约卡', 'wave', '.spec/tasks', '收口门槛', '铁律', 'in_progress']
    const reserved = ['## 调度核心', '## 编码约定', '## 宿主差异', '## 协作 / 调度', '## 安全 / 外发', '## 工程']
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    for (const file of walk(join(PLUGIN_ROOT, 'templates'))) {
      const text = readFileSync(file, 'utf8')
      for (const w of banned) assert.equal(text.toLowerCase().includes(w.toLowerCase()), false, `${file} 含「${w}」`)
      for (const h of reserved) assert.equal(text.includes(`${h}\n`), false, `${file} 含保留标题「${h}」`)
    }
  })
})

describe('幂等与覆盖', () => {
  test('第二次跑:一个都不新建、全部跳过、内容不变;--force 才覆盖', () => {
    const target = makeTemp('init-')
    initScaffold({ pluginRoot: PLUGIN_ROOT, target })
    writeFileSync(join(target, '.spec/AGENTS.md'), '# 用户改过\n')
    const again = initScaffold({ pluginRoot: PLUGIN_ROOT, target })
    assert.deepEqual(again.created, [])
    assert.deepEqual(again.overwritten, [])
    assert.deepEqual(again.skipped, EXPECTED)
    assert.equal(readFileSync(join(target, '.spec/AGENTS.md'), 'utf8'), '# 用户改过\n')
    const forced = initScaffold({ pluginRoot: PLUGIN_ROOT, target, force: true })
    assert.deepEqual(forced.overwritten, EXPECTED)
    assert.match(readFileSync(join(target, '.spec/AGENTS.md'), 'utf8'), /^# 项目中心文档/)
    cleanup(target)
  })

  test('已有 CLAUDE.md 只补缺失的 @import 行,补一次后不再追加,用户内容原样保留', () => {
    const target = makeTemp('init-')
    writeFileSync(join(target, 'CLAUDE.md'), '# 我的入口\n\n@.spec/AGENTS.md\n\n自己的话。\n')
    const r = initScaffold({ pluginRoot: PLUGIN_ROOT, target })
    assert.ok(r.skipped.includes('CLAUDE.md'))
    assert.deepEqual(r.imports, ['@.spec/knowledge/README.md', '@.spec/rules/system.md'])
    const text = readFileSync(join(target, 'CLAUDE.md'), 'utf8')
    assert.match(text, /^# 我的入口\n\n@\.spec\/AGENTS\.md\n\n自己的话。\n/)
    assert.equal((text.match(/@\.spec\/AGENTS\.md/g) ?? []).length, 1)
    const again = initScaffold({ pluginRoot: PLUGIN_ROOT, target })
    assert.deepEqual(again.imports, [])
    assert.equal(readFileSync(join(target, 'CLAUDE.md'), 'utf8'), text)
    cleanup(target)
  })
})

describe('生成物过 lint', () => {
  test('骨架 + 样例扩展一起过 spec-lint(零错误,扩展加载出两项)', async () => {
    const target = makeTemp('init-')
    initScaffold({ pluginRoot: PLUGIN_ROOT, target })
    const result = await runSpecLint({ root: target, fingerprint: null, strict: true })
    cleanup(target)
    assert.equal(result.ok, true, formatReport(result))
    assert.equal(result.exitCode, 0)
    assert.equal(result.extension.status, 'loaded')
    assert.deepEqual(result.extension.checks, ['docs-adr-mirror', 'adr-draft-backref'])
  })

  test('CLI:打印生成清单与 .workflow 说明,不写 .workflow', () => {
    const target = makeTemp('init-')
    const stdout = execFileSync(process.execPath, [SCRIPT, '--target', target], { encoding: 'utf8' })
    assert.match(stdout, /新建 7 个文件/)
    assert.ok(stdout.includes(WORKFLOW_NOTE))
    assert.match(stdout, /未生成 tasks\/、plans\//)
    assert.equal(existsSync(join(target, '.workflow')), false)
    cleanup(target)
  })
})
