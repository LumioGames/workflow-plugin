// workflow-install：官网装完不能用的缺口。隔离 HOME / XDG / CODEX_HOME，不碰本机 Codex。
//
// 锁死：--from-dir 首装与重装幂等、.bak-* 迁出扫描目录、哈希失败不落盘、
// 换根失败回滚、用户 AGENTS.md / 外来 agent / .agents/rules 自有文件保留、
// --doctor 能报 skills-only、官网 1.2.0 files.json 不能当 full。

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
  lstatSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyFromSource,
  assertFullRuntimeAvailable,
  doctor,
  isSkillsOnlyManifest,
  runInstall,
  stageFromManifest,
} from '../plugin/tools/workflow-install.mjs'
import { MANAGED_BEGIN, resolveLayout } from '../plugin/tools/lib/runtime-layout.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoot = join(repoRoot, 'plugin')
const installSh = join(pluginRoot, 'bin', 'install.sh')
const officialFixture = JSON.parse(
  readFileSync(join(repoRoot, 'tests/fixtures/official-1.2.0-files.json'), 'utf8'),
)

let sandbox
let layout

function isolatedEnv(home) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_DATA_HOME: join(home, 'xdg-data'),
    XDG_CACHE_HOME: join(home, 'xdg-cache'),
    CODEX_HOME: join(home, '.codex'),
  }
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'workflow-install-'))
  const home = join(sandbox, 'home')
  mkdirSync(home, { recursive: true })
  const env = isolatedEnv(home)
  layout = resolveLayout({ env, home })
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

function readState() {
  return JSON.parse(readFileSync(layout.statePath, 'utf8'))
}

describe('--from-dir 首装 / 重装', () => {
  test('full 首装：运行时换根、技能是 symlink、写出 state / 哨兵块 / reviewer', () => {
    const result = applyFromSource({ source: pluginRoot, layout, mode: 'full', channel: 'local' })
    assert.equal(result.mode, 'full')
    assert.ok(existsSync(join(layout.pluginDir, 'rules/system.md')))
    assert.ok(existsSync(join(layout.pluginDir, 'tools/workflow-install.mjs')))
    assert.ok(existsSync(join(layout.pluginDir, 'hosts/codex/workflow_reviewer.toml')))
    const skillLink = join(layout.skillsTarget, 'workflow-update')
    assert.ok(lstatSync(skillLink).isSymbolicLink())
    assert.equal(
      resolve(dirname(skillLink), readlinkSync(skillLink)),
      join(layout.pluginDir, 'skills/workflow-update'),
    )
    const state = readState()
    assert.equal(state.channel, 'local')
    assert.equal(state.mode, 'full')
    assert.equal(state.version, JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8')).version)
    assert.ok(Array.isArray(state.files) && state.files.length > 0)
    assert.match(readFileSync(layout.agentsMd, 'utf8'), new RegExp(MANAGED_BEGIN))
    assert.match(readFileSync(layout.reviewerToml, 'utf8'), /managed-by: workflow-plugin/)
    assert.equal(existsSync(join(layout.agentsDir, 'reviewer.md')), false, '不做 reviewer.md 伴生 symlink')
    const ruleLink = join(layout.home, '.agents', 'rules', 'system.md')
    assert.ok(lstatSync(ruleLink).isSymbolicLink(), '规则应是指向运行时的 symlink')
    assert.equal(
      resolve(dirname(ruleLink), readlinkSync(ruleLink)),
      join(layout.pluginDir, 'rules', 'system.md'),
    )
    assert.ok(lstatSync(join(layout.home, '.agents', 'rules', 'dispatch.md')).isSymbolicLink())
    assert.equal(existsSync(join(layout.home, '.agents', 'rules', 'README.md')), false, '不链 README.md')
    assert.ok(result.installedRules.some((r) => r.name === 'system.md'))
    assert.ok(result.installedRules.every((r) => !String(r.dir).includes(`${sep}.spec${sep}`)))
  })

  test('full 不覆盖 .agents/rules 里用户自有文件', () => {
    const destDir = join(layout.home, '.agents', 'rules')
    mkdirSync(destDir, { recursive: true })
    const userFile = join(destDir, 'system.md')
    writeFileSync(userFile, '# 我的规则\n')
    applyFromSource({ source: pluginRoot, layout, mode: 'full' })
    assert.equal(readFileSync(userFile, 'utf8'), '# 我的规则\n')
    assert.equal(lstatSync(userFile).isSymbolicLink(), false)
    const dispatch = join(destDir, 'dispatch.md')
    assert.ok(lstatSync(dispatch).isSymbolicLink())
    assert.equal(
      resolve(dirname(dispatch), readlinkSync(dispatch)),
      join(layout.pluginDir, 'rules', 'dispatch.md'),
    )
    assert.equal(existsSync(join(destDir, 'README.md')), false)
    assert.equal(readdirSync(destDir).some((n) => n.includes('.bak-')), false, '备份不得进 .agents/rules')
  })

  test('适配项目时写入 <repo>/.agents/rules，不写 .spec/rules，不覆盖用户文件', () => {
    const project = join(sandbox, 'repo')
    mkdirSync(join(project, '.spec', 'rules'), { recursive: true })
    mkdirSync(join(project, '.agents', 'rules'), { recursive: true })
    writeFileSync(join(project, '.spec', 'rules', 'system.md'), '# 项目专属红线\n')
    writeFileSync(join(project, '.agents', 'rules', 'custom.md'), '# 用户的\n')
    const projectLayout = resolveLayout({
      env: isolatedEnv(layout.home),
      home: layout.home,
      skillsTarget: join(project, '.agents', 'skills'),
    })
    applyFromSource({ source: pluginRoot, layout: projectLayout, mode: 'full' })
    const linked = join(project, '.agents', 'rules', 'system.md')
    assert.ok(lstatSync(linked).isSymbolicLink())
    assert.equal(
      resolve(dirname(linked), readlinkSync(linked)),
      join(projectLayout.pluginDir, 'rules', 'system.md'),
    )
    assert.equal(readFileSync(join(project, '.spec', 'rules', 'system.md'), 'utf8'), '# 项目专属红线\n')
    assert.equal(lstatSync(join(project, '.spec', 'rules', 'system.md')).isSymbolicLink(), false)
    assert.equal(readFileSync(join(project, '.agents', 'rules', 'custom.md'), 'utf8'), '# 用户的\n')
    assert.ok(lstatSync(join(layout.home, '.agents', 'rules', 'system.md')).isSymbolicLink())
  })

  test('重装幂等：用户 AGENTS.md 正文保留，不重复哨兵块', () => {
    mkdirSync(layout.codexHome, { recursive: true })
    writeFileSync(layout.agentsMd, '# 用户自己的说明\n\n不要删我。\n')
    applyFromSource({ source: pluginRoot, layout, mode: 'full' })
    applyFromSource({ source: pluginRoot, layout, mode: 'full' })
    const text = readFileSync(layout.agentsMd, 'utf8')
    assert.match(text, /不要删我/)
    assert.equal(text.split(MANAGED_BEGIN).length - 1, 1)
    assert.ok(lstatSync(join(layout.skillsTarget, 'workflow-update')).isSymbolicLink())
    assert.ok(existsSync(layout.pluginDir))
  })
})

describe('备份与回滚', () => {
  test('.bak-* 迁出技能扫描目录', () => {
    mkdirSync(join(layout.skillsTarget, 'workflow-update.bak-1.2.0'), { recursive: true })
    writeFileSync(join(layout.skillsTarget, 'workflow-update.bak-1.2.0', 'SKILL.md'), '# old\n')
    applyFromSource({ source: pluginRoot, layout, mode: 'full' })
    assert.equal(existsSync(join(layout.skillsTarget, 'workflow-update.bak-1.2.0')), false)
    const walk = (dir) => {
      if (!existsSync(dir)) return []
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
        e.isDirectory() ? [e.name, ...walk(join(dir, e.name))] : [e.name]
      ))
    }
    assert.ok(walk(layout.backupsDir).includes('workflow-update.bak-1.2.0'), '备份应落在 backups/ 而非 skills/')
  })

  test('换根失败：旧树 rename 回来，不留下半截运行时', () => {
    applyFromSource({ source: pluginRoot, layout, mode: 'full' })
    writeFileSync(join(layout.pluginDir, 'CANARY'), 'keep-me\n')
    assert.throws(
      () => applyFromSource({
        source: pluginRoot,
        layout,
        mode: 'full',
        rename: (from, to) => {
          if (String(from).includes('.staging')) throw new Error('simulated swap failure')
          return renameSync(from, to)
        },
      }),
      /simulated swap failure/,
    )
    assert.equal(readFileSync(join(layout.pluginDir, 'CANARY'), 'utf8'), 'keep-me\n')
    assert.ok(existsSync(join(layout.pluginDir, 'rules/system.md')))
  })
})

describe('哈希与官网旧包', () => {
  test('sha256 不符：中止且不落盘', async () => {
    const dest = join(sandbox, 'stage-bad-hash')
    await assert.rejects(
      () => stageFromManifest({
        manifest: {
          baseUrl: 'https://workflow.games/plugin/codex/skills',
          files: [{ path: 'workflow-update/VERSION', sha256: '0'.repeat(64) }],
        },
        dest,
        fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('1.2.0\n') }),
      }),
      /sha256 校验不符/,
    )
    assert.equal(existsSync(dest), false)
    assert.equal(existsSync(layout.pluginDir), false)
  })

  test('录制的官网 1.2.0 files.json 是技能包，full 必须拒绝', async () => {
    assert.equal(isSkillsOnlyManifest(officialFixture), true)
    assert.throws(() => assertFullRuntimeAvailable(officialFixture), /缺运行时|技能包/)
    const logs = []
    const errs = []
    const result = await runInstall(['--mode', 'full'], {
      env: isolatedEnv(layout.home),
      stdout: (line) => logs.push(String(line)),
      stderr: (line) => errs.push(String(line)),
      fetchImpl: async (url) => {
        const href = String(url)
        if (href.includes('version.json')) {
          return { ok: true, json: async () => ({ version: '1.2.0', files: '/plugin/codex/files.json' }) }
        }
        if (href.includes('files.json')) {
          return { ok: true, json: async () => officialFixture }
        }
        return { ok: false, status: 404 }
      },
    })
    assert.equal(result.ok, false)
    assert.match(errs.join('\n'), /缺运行时|技能包|完整运行时/)
    assert.equal(existsSync(layout.pluginDir), false, '拒绝 full 时不得写出运行时')
  })

  test('线上 files.json（若可达）同样不能当 full', async () => {
    let live
    try {
      const res = await fetch(`https://workflow.games/plugin/codex/files.json?cb=${Date.now()}`)
      if (!res.ok) return
      live = await res.json()
    } catch {
      return
    }
    assert.equal(isSkillsOnlyManifest(live), true)
    assert.throws(() => assertFullRuntimeAvailable(live), /缺运行时|技能包/)
  })
})

describe('用户资产与 doctor', () => {
  test('外来 agent 与无标记 reviewer 不覆盖；override 不改', () => {
    mkdirSync(layout.agentsDir, { recursive: true })
    writeFileSync(join(layout.agentsDir, 'other.toml'), 'name = "other"\n')
    writeFileSync(layout.reviewerToml, 'name = "workflow_reviewer"\n# user owned\n')
    writeFileSync(layout.agentsOverrideMd, '# override，别动\n')
    applyFromSource({ source: pluginRoot, layout, mode: 'full' })
    assert.equal(readFileSync(join(layout.agentsDir, 'other.toml'), 'utf8'), 'name = "other"\n')
    assert.equal(readFileSync(layout.reviewerToml, 'utf8'), 'name = "workflow_reviewer"\n# user owned\n')
    assert.equal(readFileSync(layout.agentsOverrideMd, 'utf8'), '# override，别动\n')
    const report = doctor({ layout })
    assert.ok(report.findings.some((f) => f.id === 'reviewer-user-owned'))
    assert.ok(report.findings.some((f) => f.id === 'agents-override'))
  })

  test('--doctor 能报 skills-only', () => {
    applyFromSource({ source: pluginRoot, layout, mode: 'skills', channel: 'local' })
    const report = doctor({ layout })
    assert.equal(report.mode, 'skills')
    assert.ok(report.findings.some((f) => f.id === 'skills-only'))
    assert.equal(existsSync(join(layout.pluginDir, 'rules/system.md')), false)
    assert.equal(existsSync(join(layout.home, '.agents', 'rules', 'system.md')), false)
  })

  test('install.sh 转调 --doctor，隔离环境不碰本机', () => {
    const r = spawnSync('sh', [installSh, '--doctor', '--json'], {
      encoding: 'utf8',
      env: isolatedEnv(layout.home),
    })
    assert.ok(r.status === 0 || r.status === 1)
    const report = JSON.parse(r.stdout)
    assert.equal(report.mode === 'absent' || report.mode === 'skills', true)
    assert.ok(Array.isArray(report.findings))
  })
})
