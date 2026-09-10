// plugin-lint:插件自身结构校验——对本仓必须全绿;对造出来的坏插件逐项抓错;部件不存在时跳过不报。
//
// 存在的理由:插件分几路并行吸收(rules / hooks、skills / agents、tools),任何一路先合入都得能跑 lint;
// 而 reviewer 无 Bash、hooks 无 PreToolUse、rules 无旧制度词汇是写死的失败语义,必须机器判。

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pluginLint, BANNED_RULE_WORDS } from '../tools/plugin-lint.mjs'
import { makeTemp, writeFiles, cleanup, REPO_ROOT } from './fixtures/w3/spec-fixture.mjs'

const SCRIPT = join(REPO_ROOT, 'tools', 'plugin-lint.mjs')
const BASE = { 'plugin.json': '{}\n', '.claude-plugin/plugin.json': '{}\n' }

function lintFixture(files) {
  const root = makeTemp('plugin-lint-')
  writeFiles(root, { ...BASE, ...files })
  try { return pluginLint(root) } finally { cleanup(root) }
}

describe('本仓', () => {
  test('对当前插件仓全绿(W1 / W2 的部件缺席时对应项跳过)', () => {
    assert.deepEqual(pluginLint(REPO_ROOT), [])
    assert.match(execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' }), /plugin-lint: OK/)
  })

  test('只有清单、没有任何部件 → 零错误', () => {
    assert.deepEqual(lintFixture({}), [])
  })
})

describe('逐项', () => {
  test('核心文件缺失被抓', () => {
    const root = makeTemp('plugin-lint-')
    const errors = pluginLint(root)
    cleanup(root)
    assert.deepEqual(errors, ['plugin.json: 缺核心文件:plugin.json', '.claude-plugin/plugin.json: 缺核心文件:.claude-plugin/plugin.json'])
  })

  test('skills:缺 SKILL.md、name 与目录不一致、规范外字段', () => {
    const errors = lintFixture({
      'skills/a/README.md': '# 没有 SKILL.md\n',
      'skills/b/SKILL.md': '---\nname: bb\ndescription: 够长的描述\nextra: 1\n---\n',
      'skills/c/SKILL.md': '---\nname: c\ndescription: 够长的描述\nallowed-tools: Bash\n---\n',
    })
    assert.deepEqual(errors, [
      'skills/a/SKILL.md: skills/a 缺少 SKILL.md',
      'skills/b/SKILL.md: frontmatter name「bb」与目录名「b」不一致',
      'skills/b/SKILL.md: frontmatter 含规范外字段:extra',
    ])
  })

  test('agents:允许 disallowedTools(行内 / 块列表);reviewer 缺 Bash、多余键、name 不一致被抓', () => {
    const ok = lintFixture({
      'agents/reviewer.md': '---\nname: reviewer\ndescription: 审\ndisallowedTools:\n  - Bash\n  - Write\n---\n',
      'agents/other.md': '---\nname: other\ndescription: 其它\ndisallowedTools: [Bash]\n---\n',
    })
    assert.deepEqual(ok, [])
    const bad = lintFixture({
      'agents/reviewer.md': '---\nname: reviewer\ndescription: 审\ntools: Read\n---\n',
      'agents/x.md': '---\nname: y\ndescription: 审\n---\n',
    })
    assert.deepEqual(bad, [
      'agents/reviewer.md: frontmatter 只允许 name + description + disallowedTools,多出:tools',
      'agents/reviewer.md: reviewer 的 frontmatter 必须含 disallowedTools: Bash(只读、只出报告,不跑命令)',
      'agents/x.md: frontmatter name「y」与文件名「x」不一致',
    ])
  })

  test('commands:缺 frontmatter 或缺 description 被抓', () => {
    assert.deepEqual(lintFixture({
      'commands/a.md': '正文\n',
      'commands/b.md': '---\nargument-hint: x\n---\n',
      'commands/c.md': '---\ndescription: 好\n---\n',
    }), [
      'commands/a.md: 缺少 frontmatter(宿主据 description 列出 / 命令)',
      'commands/b.md: frontmatter 缺 description',
    ])
  })

  test('hooks:非法 JSON、PreToolUse、SessionStart 脚本不存在', () => {
    assert.deepEqual(lintFixture({ 'hooks/hooks.json': '{\n' }), ['hooks/hooks.json: hooks.json 不是合法 JSON'])
    const errors = lintFixture({
      'hooks/hooks.json': JSON.stringify({ hooks: {
        SessionStart: [{ hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/tools/inject-rules.mjs"' }, { command: 'node "${CLAUDE_PLUGIN_ROOT}/tools/ok.mjs"' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [] }],
      } }),
      'tools/ok.mjs': '',
    })
    assert.deepEqual(errors, [
      'hooks/hooks.json: 注册了 PreToolUse——commit 阻断钩子已移除,插件只留 SessionStart',
      'hooks/hooks.json: SessionStart 指向的脚本不存在:tools/inject-rules.mjs',
    ])
  })

  test('rules:旧制度词汇逐行报,大小写不敏感', () => {
    const errors = lintFixture({ 'rules/dispatch.md': '# 规程\n\n先做 Wave 0 的契约卡\n任务真值在 .spec/tasks/\n' })
    assert.deepEqual(errors, [
      'rules/dispatch.md: 第 3 行出现旧制度词汇「契约卡」——插件规则一律 Workflow 语汇',
      'rules/dispatch.md: 第 3 行出现旧制度词汇「wave」——插件规则一律 Workflow 语汇',
      'rules/dispatch.md: 第 4 行出现旧制度词汇「.spec/tasks」——插件规则一律 Workflow 语汇',
    ])
    assert.deepEqual(BANNED_RULE_WORDS, ['契约卡', 'wave', '.spec/tasks', '收口门槛', '铁律', 'in_progress'])
  })

  test('链接可达与模板隔离', () => {
    assert.deepEqual(lintFixture({
      'rules/system.md': '[坏](nowhere.md)\n',
      'templates/.spec/AGENTS.md': '[插件资产](../../skills/x/SKILL.md)\n',
      'skills/x/SKILL.md': '---\nname: x\ndescription: 够长的描述\n---\n',
    }), [
      'rules/system.md: 悬空链接:nowhere.md',
      'templates/.spec/AGENTS.md: 模板不得引用模板树之外的路径(复制进用户项目后会悬空):../../skills/x/SKILL.md',
    ])
    // 模板树内部的相对链接(哪怕目录名叫 rules / tools)不受限
    assert.deepEqual(lintFixture({
      'templates/.spec/AGENTS.md': '[项目规则](rules/system.md) [扩展](tools/lint-extensions.mjs)\n',
      'templates/.spec/rules/system.md': '',
      'templates/.spec/tools/lint-extensions.mjs': '',
    }), [])
  })
})
