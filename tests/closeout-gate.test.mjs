// closeout-gate 定级:在临时 git 仓库里造各类 diff,断言三态与命中理由;退出码恒 0。
//
// 存在的理由:头注释是判定规则的单一权威,这里每条断言对应一条规则——红线面永不豁免、
// 语义红线(wire / abi / *.schema.json)按路径判、阈值 <50 豁免 / ≥500 深审、未跟踪代码不可定级。

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeTemp, writeFiles, gitInit, git, cleanup, PLUGIN_ROOT } from './fixtures/w3/spec-fixture.mjs'

const GATE = join(PLUGIN_ROOT, 'tools', 'closeout-gate.mjs')

function repo() {
  const root = makeTemp('gate-')
  writeFiles(root, { 'README.md': '# r\n', 'src/app.js': 'export const a = 1\n', 'data.json': '{}\n' })
  return gitInit(root)
}

function gate(root, base) {
  try {
    const stdout = execFileSync(process.execPath, [GATE, ...(base ? [base] : [])], { cwd: root, encoding: 'utf8' })
    return { code: 0, stdout }
  } catch (e) {
    return { code: e.status, stdout: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  } finally {
    cleanup(root)
  }
}
const lines = (n, prefix = 'const') => Array.from({ length: n }, (_, i) => `${prefix} v${i} = ${i}`).join('\n') + '\n'

describe('三态判定', () => {
  test('空 diff → 快速豁免', () => {
    const { code, stdout } = gate(repo())
    assert.equal(code, 0)
    assert.match(stdout, /closeout-gate: 快速豁免\n\s+- 空 diff/)
  })

  test('纯文档 / 配置数据改动 → 快速豁免(不限行数)', () => {
    const root = repo()
    appendFileSync(join(root, 'README.md'), lines(600, '-'))
    appendFileSync(join(root, 'data.json'), '\n')
    assert.match(gate(root).stdout, /快速豁免\n\s+- 全部文件为纯文档 \/ 配置数据/)
  })

  test('有效行 < 50 → 快速豁免;50–499 → 快审;≥ 500 → 深审(注释与空行不计)', () => {
    const small = repo()
    appendFileSync(join(small, 'src/app.js'), `${lines(10)}// 注释不计\n\n/* 也不计 */\n`)
    assert.match(gate(small).stdout, /快速豁免\n\s+- 有效行 10 < 50/)
    const mid = repo()
    appendFileSync(join(mid, 'src/app.js'), lines(60))
    assert.match(gate(mid).stdout, /快审\n\s+- 默认——白名单未命中\(有效行 60\)/)
    const big = repo()
    appendFileSync(join(big, 'src/app.js'), lines(500))
    assert.match(gate(big).stdout, /深审\n\s+- 有效行 500 ≥ 500/)
  })

  test('纯注释 / 纯删除的代码改动 → 快速豁免', () => {
    const root = repo()
    writeFileSync(join(root, 'src/app.js'), '// 只剩注释\n')
    assert.match(gate(root).stdout, /快速豁免\n\s+- 全部文件为纯文档 \/ 配置数据 \/ 纯注释或纯删除改动\(有效行 0\)/)
  })
})

describe('红线面', () => {
  test('rules/ 被触碰 → 快审,永不豁免;有效行 ≥ 100 → 深审', () => {
    const root = repo()
    writeFiles(root, { 'rules/system.md': '# 红线\n' })
    git(root, 'add', '-A')
    assert.match(gate(root).stdout, /快审\n\s+- 红线面被触碰\(rules\/system\.md\)——一票取消豁免/)
    const deep = repo()
    writeFiles(deep, { 'rules/system.md': '# 红线\n', 'src/app.js': lines(120) })
    git(deep, 'add', '-A')
    assert.match(gate(deep).stdout, /深审\n[\s\S]*红线面 \+ 有效行 121 ≥ 100/) // 120 行代码 + rules/system.md 的 1 行
  })

  test('语义红线:wire / abi 路径段、*.schema.json、*snapshot* 等文件名(哪怕是 json 数据)', () => {
    for (const rel of ['engine/wire/msg.json', 'abi/x.txt', 'contracts/entity.schema.json', 'save/Snapshot.md', 'db/Migration_01.sql']) {
      const root = repo()
      writeFiles(root, { [rel]: 'x\n' })
      git(root, 'add', '-A')
      assert.match(gate(root).stdout, new RegExp(`红线面被触碰\\(${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`), rel)
    }
  })

  test('hooks.json、.github/workflows/、.claude/ 嵌套目录也算红线;package.json 不算', () => {
    for (const rel of ['plugin/hooks/hooks.json', '.github/workflows/ci.yml', 'sub/.claude/settings.json']) {
      const root = repo()
      writeFiles(root, { [rel]: '{}\n' })
      git(root, 'add', '-A')
      assert.match(gate(root).stdout, /红线面被触碰/, rel)
    }
    const pkg = repo()
    writeFiles(pkg, { 'package.json': '{"scripts":{}}\n' })
    git(pkg, 'add', '-A')
    assert.match(gate(pkg).stdout, /快速豁免/)
  })
})

describe('未跟踪、二进制、revert', () => {
  test('未跟踪的代码文件 → 快审(内容不可定级);未跟踪的纯文档只提示,不拦豁免;未跟踪的红线文档拦', () => {
    const code = repo()
    writeFiles(code, { 'src/new.js': 'x\n' })
    assert.match(gate(code).stdout, /快审\n\s+- 存在未跟踪的非文档类或红线面文件\(src\/new\.js\)/)
    const doc = repo()
    writeFiles(doc, { 'notes.md': 'x\n' })
    assert.match(gate(doc).stdout, /快速豁免[\s\S]*提示:未跟踪的文档\/数据文件未计入定级\(notes\.md\)/)
    const redDoc = repo()
    writeFiles(redDoc, { 'rules/x.md': 'x\n' })
    assert.match(gate(redDoc).stdout, /快审\n\s+- 存在未跟踪的非文档类或红线面文件\(rules\/x\.md\)/)
  })

  test('二进制改动 → 快审', () => {
    const root = repo()
    writeFileSync(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))
    git(root, 'add', '-A')
    assert.match(gate(root).stdout, /快审\n\s+- 含二进制文件改动/)
  })

  test('BASE..HEAD 全是 revert 提交 → 快速豁免(哪怕改的是代码)', () => {
    const root = repo()
    const base = git(root, 'rev-parse', 'HEAD').trim()
    appendFileSync(join(root, 'src/app.js'), lines(80))
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'revert: 回滚上次改动')
    assert.match(gate(root, base).stdout, /快速豁免\n\s+- BASE\.\.HEAD 全部为 revert 提交/)
  })
})

describe('退出码恒 0', () => {
  test('不在 git 仓库、BASE 不可解析、以 - 开头的参数 → 输出「无法定级」且退出码 0', () => {
    const notGit = gate(makeTemp('nogit-'))
    assert.equal(notGit.code, 0)
    assert.match(notGit.stdout, /closeout-gate: 无法定级\n\s+- 环境错误/)
    const badBase = gate(repo(), 'no-such-ref')
    assert.equal(badBase.code, 0)
    assert.match(badBase.stdout, /无法定级\n\s+- BASE 不可解析\(no-such-ref\)/)
    const dash = gate(repo(), '--help')
    assert.equal(dash.code, 0)
    assert.match(dash.stdout, /无法定级/)
  })
})
